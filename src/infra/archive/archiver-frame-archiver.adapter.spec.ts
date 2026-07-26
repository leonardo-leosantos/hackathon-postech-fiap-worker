/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mock method references is safe; they are never invoked with a rebound `this`. */
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { ArchiverFrameArchiverAdapter } from './archiver-frame-archiver.adapter';

type Handlers = Record<string, (arg?: unknown) => void>;

/**
 * Por padrão o spec usa a lib `archiver` e o filesystem REAIS (zip de verdade em
 * diretório temporário). Só os cenários que precisam controlar a ordem dos
 * eventos trocam a factory e o `createWriteStream` por dublês — é a única forma
 * de provar que o adapter espera o `close` do output, e não o `finalize()`.
 */
const realArchiver =
  jest.requireActual<(...args: unknown[]) => unknown>('archiver');
let archiverFactory: (...args: unknown[]) => unknown;
let createWriteStreamImpl: (...args: unknown[]) => unknown;

jest.mock('archiver', () => ({
  __esModule: true,
  default: (...args: unknown[]) => archiverFactory(...args),
}));

jest.mock('node:fs', () => {
  const actual = jest.requireActual<Record<string, unknown>>('node:fs');
  return {
    ...actual,
    createWriteStream: (...args: unknown[]) => createWriteStreamImpl(...args),
  };
});

/** Dublê da dupla archive/output: expõe os handlers para dispará-los à mão. */
function useFakeArchiver(): {
  archiveHandlers: Handlers;
  outputHandlers: Handlers;
  finalize: jest.Mock;
  pointer: jest.Mock;
} {
  const archiveHandlers: Handlers = {};
  const outputHandlers: Handlers = {};
  const finalize = jest.fn().mockResolvedValue(undefined);
  const pointer = jest.fn().mockReturnValue(2048);

  const archive = {
    on: (event: string, handler: (arg?: unknown) => void) => {
      archiveHandlers[event] = handler;
      return archive;
    },
    pipe: () => archive,
    directory: () => archive,
    finalize,
    pointer,
  };
  const output = {
    on: (event: string, handler: (arg?: unknown) => void) => {
      outputHandlers[event] = handler;
      return output;
    },
  };

  archiverFactory = () => archive;
  createWriteStreamImpl = () => output;

  return { archiveHandlers, outputHandlers, finalize, pointer };
}

/** Cede o event loop uma vez, sem resolver nada por conta própria. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Cede o event loop até `condition` valer. O adapter faz um `mkdir` real antes de
 * chamar o archiver, e esse I/O não termina em um único tick garantido.
 */
async function waitUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) {
    await tick();
  }
  if (!condition()) throw new Error('condição não atingida a tempo');
}

describe('ArchiverFrameArchiverAdapter', () => {
  let logger: jest.Mocked<LoggerPort>;
  let adapter: ArchiverFrameArchiverAdapter;
  let workDir: string;
  let sourceDir: string;
  let zipPath: string;

  beforeEach(async () => {
    archiverFactory = (...args: unknown[]) => realArchiver(...args);
    createWriteStreamImpl = (...args: unknown[]) =>
      jest
        .requireActual<{
          createWriteStream: (...a: unknown[]) => unknown;
        }>('node:fs')
        .createWriteStream(...args);

    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    adapter = new ArchiverFrameArchiverAdapter(logger);

    workDir = await mkdtemp(path.join(tmpdir(), 'archiver-adapter-spec-'));
    sourceDir = path.join(workDir, 'frames');
    zipPath = path.join(workDir, 'zips', 'video-1.zip');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /** Cria `sourceDir` com `count` frames fake. */
  const givenFrames = async (count: number): Promise<void> => {
    await mkdir(sourceDir, { recursive: true });
    for (let i = 1; i <= count; i++) {
      await writeFile(
        path.join(sourceDir, `frame-000${i}.jpg`),
        `jpeg-payload-${i}`.repeat(64),
      );
    }
  };

  it('sucesso: gera o .zip com o conteúdo do diretório em zipPath', async () => {
    await givenFrames(3);

    await expect(adapter.archiveDirectory(sourceDir, zipPath)).resolves.toBe(
      undefined,
    );

    const { size } = await stat(zipPath);
    expect(size).toBeGreaterThan(0);
    // Assinatura local do formato zip: prova que não é um arquivo vazio/truncado.
    const head = await readFile(zipPath);
    expect(head.subarray(0, 2).toString()).toBe('PK');
  });

  it('cria o diretório pai do zipPath quando ele não existe', async () => {
    await givenFrames(1);
    const nested = path.join(workDir, 'a', 'b', 'c', 'video-1.zip');

    await adapter.archiveDirectory(sourceDir, nested);

    await expect(stat(nested)).resolves.toBeDefined();
  });

  it('loga bytes gravados via LoggerPort (não console)', async () => {
    await givenFrames(2);

    await adapter.archiveDirectory(sourceDir, zipPath);

    expect(logger.log).toHaveBeenCalledWith(
      'Directory archived',
      expect.objectContaining({ sourceDir, zipPath }),
    );
    const [, context] = logger.log.mock.calls[0] as [string, { bytes: number }];
    expect(context.bytes).toBeGreaterThan(0);
  });

  it('resolve só no evento `close` do output, nunca no retorno de finalize()', async () => {
    const { outputHandlers, finalize } = useFakeArchiver();

    let settled: 'resolved' | 'rejected' | null = null;
    const promise = adapter.archiveDirectory(sourceDir, zipPath).then(
      () => {
        settled = 'resolved';
      },
      () => {
        settled = 'rejected';
      },
    );

    await waitUntil(() => finalize.mock.calls.length > 0);
    await tick();
    // finalize() já resolveu; o zip ainda NÃO está inteiro em disco. Resolver
    // aqui liberaria o upload de um arquivo truncado.
    expect(settled).toBeNull();

    outputHandlers.close();
    await promise;
    expect(settled).toBe('resolved');
  });

  it('erro do archiver é repropagado como está (infra => retry/DLQ, não erro de negócio)', async () => {
    const { archiveHandlers } = useFakeArchiver();
    const failure = new Error('ENOSPC: no space left on device');

    const promise = adapter.archiveDirectory(sourceDir, zipPath);
    await waitUntil(() => typeof archiveHandlers.error === 'function');
    archiveHandlers.error(failure);

    const error: unknown = await promise.catch((err: unknown) => err);
    expect(error).toBe(failure);
    expect(error).not.toBeInstanceOf(MediaProcessingException);
  });

  it('erro da write stream é repropagado como está', async () => {
    const { outputHandlers } = useFakeArchiver();
    const failure = new Error('EACCES: permission denied, open zipPath');

    const promise = adapter.archiveDirectory(sourceDir, zipPath);
    await waitUntil(() => typeof outputHandlers.error === 'function');
    outputHandlers.error(failure);

    const error: unknown = await promise.catch((err: unknown) => err);
    expect(error).toBe(failure);
    expect(error).not.toBeInstanceOf(MediaProcessingException);
  });

  it('não loga sucesso quando a compactação falha', async () => {
    const { archiveHandlers } = useFakeArchiver();

    const promise = adapter.archiveDirectory(sourceDir, zipPath);
    await waitUntil(() => typeof archiveHandlers.error === 'function');
    archiveHandlers.error(new Error('archive corrupted'));
    await promise.catch(() => undefined);

    expect(logger.log).not.toHaveBeenCalled();
  });
});
