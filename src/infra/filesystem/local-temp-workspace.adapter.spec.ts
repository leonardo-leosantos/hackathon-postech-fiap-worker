import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { LocalTempWorkspaceAdapter } from './local-temp-workspace.adapter';

/**
 * O adapter é ancorado em `/tmp` por contrato (paths efêmeros do container), então
 * o teste usa um `videoId` exclusivo e limpa o que criou.
 */
const videoId = 'spec-workspace-8f2c1a';

describe('LocalTempWorkspaceAdapter', () => {
  let logger: jest.Mocked<LoggerPort>;
  let adapter: LocalTempWorkspaceAdapter;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    adapter = new LocalTempWorkspaceAdapter(logger);
  });

  afterEach(async () => {
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
});
