/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mock method references is safe; they are never invoked with a rebound `this`. */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { LocalTempWorkspaceAdapter } from './local-temp-workspace.adapter';

/**
 * O adapter é ancorado em `/tmp` por contrato (paths efêmeros do container), então
 * o teste usa um `videoId` exclusivo e limpa o que criou.
 */
const videoId = 'spec-workspace-8f2c1a';

/**
 * `rm` real por padrão; os testes de falha de remoção trocam a implementação para
 * simular um erro de filesystem que só se reproduz com o disco em estado ruim.
 */
const realRm =
  jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises').rm;
let rmImpl: typeof realRm;

jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    rm: (...args: Parameters<typeof actual.rm>) => rmImpl(...args),
  };
});

describe('LocalTempWorkspaceAdapter', () => {
  let logger: jest.Mocked<LoggerPort>;
  let adapter: LocalTempWorkspaceAdapter;

  beforeEach(() => {
    rmImpl = realRm;
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    adapter = new LocalTempWorkspaceAdapter(logger);
  });

  afterEach(async () => {
    rmImpl = realRm;
    await rm(path.join('/tmp/videos', `${videoId}.mp4`), { force: true });
    await rm(path.join('/tmp/frames', videoId), {
      recursive: true,
      force: true,
    });
    await rm(path.join('/tmp/zips', `${videoId}.zip`), { force: true });
  });

  it('cria os três caminhos do job', async () => {
    const ws = await adapter.create(videoId);

    expect(ws).toEqual({
      videoPath: `/tmp/videos/${videoId}.mp4`,
      framesDir: `/tmp/frames/${videoId}`,
      zipPath: `/tmp/zips/${videoId}.zip`,
    });
    await expect(stat(ws.framesDir)).resolves.toBeDefined();
  });

  it('descarta artefatos de uma execução anterior do MESMO job (worker morto por OOM)', async () => {
    const ws = await adapter.create(videoId);
    // Simula o container morto no meio do job: frames velhos, vídeo e zip ficaram.
    await writeFile(path.join(ws.framesDir, 'frame-0001.jpg'), 'stale');
    await writeFile(ws.videoPath, 'stale-video');
    await writeFile(ws.zipPath, 'stale-zip');

    await adapter.create(videoId);

    // Sem isso a guarda de 0 frames do extrator passaria com frames obsoletos
    // e o vídeo viraria DONE com um zip de conteúdo errado.
    await expect(readdir(ws.framesDir)).resolves.toEqual([]);
    await expect(stat(ws.videoPath)).rejects.toThrow();
    await expect(stat(ws.zipPath)).rejects.toThrow();
  });

  it('NÃO apaga as raízes compartilhadas: artefatos de outros jobs sobrevivem', async () => {
    const otherJobVideo = '/tmp/videos/spec-workspace-other.mp4';
    const otherJobZip = '/tmp/zips/spec-workspace-other.zip';
    await mkdir('/tmp/videos', { recursive: true });
    await mkdir('/tmp/zips', { recursive: true });
    await writeFile(otherJobVideo, 'other');
    await writeFile(otherJobZip, 'other');

    try {
      await adapter.create(videoId);

      await expect(stat(otherJobVideo)).resolves.toBeDefined();
      await expect(stat(otherJobZip)).resolves.toBeDefined();
    } finally {
      await rm(otherJobVideo, { force: true });
      await rm(otherJobZip, { force: true });
    }
  });

  it('cleanup remove os três artefatos e nunca lança', async () => {
    const ws = await adapter.create(videoId);
    await writeFile(ws.videoPath, 'video');
    await writeFile(ws.zipPath, 'zip');

    await expect(adapter.cleanup(ws)).resolves.toBeUndefined();

    await expect(stat(ws.videoPath)).rejects.toThrow();
    await expect(stat(ws.framesDir)).rejects.toThrow();
    await expect(stat(ws.zipPath)).rejects.toThrow();
  });

  describe('cleanup com falha de remoção (roda no `finally` — não pode mascarar o erro real)', () => {
    it('gera warn, NÃO lança e continua removendo os alvos seguintes', async () => {
      const ws = await adapter.create(videoId);
      await writeFile(ws.videoPath, 'video');
      await writeFile(ws.zipPath, 'zip');
      // Só o primeiro alvo falha; os outros dois seguem pelo `rm` real.
      rmImpl = (target: string, options: unknown) =>
        target === ws.videoPath
          ? Promise.reject(new Error('EBUSY: resource busy or locked'))
          : realRm(target, options as Parameters<typeof realRm>[1]);

      await expect(adapter.cleanup(ws)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to remove temp artifact',
        {
          target: ws.videoPath,
          reason: 'EBUSY: resource busy or locked',
        },
      );
      // A limpeza dos demais artefatos não pode parar no primeiro erro.
      await expect(stat(ws.framesDir)).rejects.toThrow();
      await expect(stat(ws.zipPath)).rejects.toThrow();
      expect(logger.log).toHaveBeenCalledWith(
        'Temp workspace cleaned up',
        expect.objectContaining({ videoPath: ws.videoPath }),
      );
    });

    it('rejeição que não é Error: serializa o motivo em string', async () => {
      const ws = await adapter.create(videoId);
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- o cenário testado é justamente a rejeição que não é Error.
      rmImpl = () => Promise.reject('disco cheio');

      await expect(adapter.cleanup(ws)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenLastCalledWith(
        'Failed to remove temp artifact',
        { target: ws.zipPath, reason: 'disco cheio' },
      );
    });
  });
});
