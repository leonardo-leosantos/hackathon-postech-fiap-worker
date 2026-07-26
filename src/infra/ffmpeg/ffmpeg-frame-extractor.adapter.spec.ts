/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mock method references is safe; they are never invoked with a rebound `this`. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import { VideoErrorCode } from 'src/modules/video-processing/domain/value-objects/video-status.vo';
import { FfmpegFrameExtractorAdapter } from './ffmpeg-frame-extractor.adapter';

type FfmpegHandlers = Record<string, (arg?: any) => void>;

interface FakeFfmpegCommand {
  outputOptions(options: string[]): FakeFfmpegCommand;
  output(pattern: string): FakeFfmpegCommand;
  on(event: string, handler: (arg?: any) => void): FakeFfmpegCommand;
  run(): void;
}

/**
 * O que o `run()` do ffmpeg fake faz: recebe os handlers registrados pelo
 * adapter e simula o comportamento do processo (stderr + `end` ou `error`).
 */
let mockScenario: (handlers: FfmpegHandlers) => void | Promise<void>;

jest.mock('fluent-ffmpeg', () => ({
  __esModule: true,
  default: (): FakeFfmpegCommand => {
    const handlers: FfmpegHandlers = {};
    const command: FakeFfmpegCommand = {
      outputOptions: () => command,
      output: () => command,
      on: (event, handler) => {
        handlers[event] = handler;
        return command;
      },
      // Assíncrono como o processo real: o adapter só resolve/rejeita depois.
      run: () => void Promise.resolve().then(() => mockScenario(handlers)),
    };
    return command;
  },
}));

describe('FfmpegFrameExtractorAdapter', () => {
  let logger: jest.Mocked<LoggerPort>;
  let adapter: FfmpegFrameExtractorAdapter;
  let workDir: string;
  let framesDir: string;
  const videoPath = '/tmp/videos/video-1.mp4';

  /** Simula o ffmpeg escrevendo `count` frames e terminando com sucesso. */
  const succeedsWith =
    (count: number, stderrLines: string[] = []) =>
    async (handlers: FfmpegHandlers) => {
      stderrLines.forEach((line) => handlers.stderr(line));
      for (let i = 1; i <= count; i++) {
        await writeFile(path.join(framesDir, `frame-000${i}.jpg`), 'jpeg');
      }
      handlers.end();
    };

  /** Simula o ffmpeg falhando, opcionalmente cuspindo linhas em stderr antes. */
  const failsWith =
    (message: string, stderrLines: string[] = []) =>
    (handlers: FfmpegHandlers) => {
      stderrLines.forEach((line) => handlers.stderr(line));
      handlers.error(new Error(message));
    };

  beforeEach(async () => {
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    adapter = new FfmpegFrameExtractorAdapter(logger);
    workDir = await mkdtemp(path.join(tmpdir(), 'ffmpeg-adapter-spec-'));
    framesDir = path.join(workDir, 'frames');
    mockScenario = succeedsWith(3);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('sucesso: resolve e loga via LoggerPort (sem console)', async () => {
    await expect(adapter.extractFrames(videoPath, framesDir)).resolves.toBe(
      undefined,
    );

    expect(logger.log).toHaveBeenCalledWith('Frame extraction completed', {
      videoPath,
      framesDir,
      frameCount: 3,
    });
  });

  it.each([
    ['spawn ffmpeg ENOENT', []],
    ['Cannot find ffmpeg', []],
    ['ffmpeg exited with code 1', ['av_interleaved_write_frame: ENOSPC']],
    ['ffmpeg exited with code 1', ['No space left on device']],
    ['Error: EACCES, permission denied', []],
  ])(
    'falha de INFRA ("%s") => ExternalServiceException (retry/DLQ, não culpa o usuário)',
    async (message, stderrLines) => {
      mockScenario = failsWith(message, stderrLines);

      const error = await adapter
        .extractFrames(videoPath, framesDir)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(ExternalServiceException);
      expect(error).not.toBeInstanceOf(MediaProcessingException);
    },
  );

  it('falha de decode => MediaProcessingException CORRUPT_VIDEO com o motivo técnico', async () => {
    mockScenario = failsWith('ffmpeg exited with code 1', [
      'moov atom not found',
    ]);

    const error = await adapter
      .extractFrames(videoPath, framesDir)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MediaProcessingException);
    expect((error as MediaProcessingException).code).toBe(
      VideoErrorCode.CORRUPT_VIDEO,
    );
    expect((error as MediaProcessingException).message).toContain(
      'ffmpeg exited with code 1',
    );
  });

  it('0 frames extraídos => MediaProcessingException UNSUPPORTED_FORMAT (nunca DONE com zip vazio)', async () => {
    mockScenario = succeedsWith(0);

    const error = await adapter
      .extractFrames(videoPath, framesDir)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MediaProcessingException);
    expect((error as MediaProcessingException).code).toBe(
      VideoErrorCode.UNSUPPORTED_FORMAT,
    );
  });

  describe('errorReason carrega a cauda do stderr (auditoria em video_errors)', () => {
    it('CORRUPT_VIDEO inclui a linha de stderr que diagnostica', async () => {
      mockScenario = failsWith('ffmpeg exited with code 1', [
        'Input #0, mov,mp4',
        'moov atom not found',
      ]);

      const error = await adapter
        .extractFrames(videoPath, framesDir)
        .catch((err: unknown) => err);

      expect((error as MediaProcessingException).message).toContain(
        'moov atom not found',
      );
    });

    it('UNSUPPORTED_FORMAT (0 frames) também inclui o stderr, não só a constante', async () => {
      mockScenario = succeedsWith(0, [
        'Stream #0:0: Video: hevc (Main 10)',
        'Output file is empty, nothing was encoded',
      ]);

      const error = await adapter
        .extractFrames(videoPath, framesDir)
        .catch((err: unknown) => err);

      expect((error as MediaProcessingException).code).toBe(
        VideoErrorCode.UNSUPPORTED_FORMAT,
      );
      expect((error as MediaProcessingException).message).toContain(
        'Output file is empty, nothing was encoded',
      );
    });

    it('mantém a mensagem intacta quando não houve stderr', async () => {
      mockScenario = failsWith('ffmpeg exited with code 1');

      const error = await adapter
        .extractFrames(videoPath, framesDir)
        .catch((err: unknown) => err);

      expect((error as MediaProcessingException).message).not.toContain(
        'stderr:',
      );
    });

    it('limita a cauda a ~800 chars (o core trunca em 1000)', async () => {
      mockScenario = failsWith(
        'ffmpeg exited with code 1',
        Array.from({ length: 40 }, (_, i) => `linha-${i}-${'y'.repeat(200)}`),
      );

      const error = await adapter
        .extractFrames(videoPath, framesDir)
        .catch((err: unknown) => err);

      const { message } = error as MediaProcessingException;
      expect(message.length).toBeLessThanOrEqual(1000);
      // A cauda preservada é o FINAL do stderr, onde o ffmpeg reporta a causa.
      expect(message).toContain('linha-39');
    });
  });

  it('a linha `configuration:` do ffmpeg NÃO é lida como falha de infra', async () => {
    // O stderr real traz as flags de build em toda execução; casá-las contra os
    // sinais de infra classificaria todo vídeo corrompido como falha nossa.
    mockScenario = failsWith('ffmpeg exited with code 1', [
      'ffmpeg version 6.1.1 Copyright (c) 2000-2023 the FFmpeg developers',
      '  configuration: --prefix=/usr --enable-gpl --disable-ffplay ' +
        '--enable-libx264 --enable-libvpx --enable-libopus --enable-nonfree',
      'Invalid data found when processing input',
    ]);

    const error = await adapter
      .extractFrames(videoPath, framesDir)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(MediaProcessingException);
    expect((error as MediaProcessingException).code).toBe(
      VideoErrorCode.CORRUPT_VIDEO,
    );
  });
});
