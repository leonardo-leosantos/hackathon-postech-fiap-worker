import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { LOGGER } from 'src/modules/shared/ports/logger.token';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import type {
  JobWorkspace,
  TempWorkspacePort,
} from 'src/modules/video-processing/domain/ports/temp-workspace.port';

/** Raiz dos vídeos baixados. */
const VIDEOS_DIR = '/tmp/videos';
/** Raiz dos diretórios de frames extraídos (um subdiretório por job). */
const FRAMES_DIR = '/tmp/frames';
/** Raiz dos arquivos `.zip` gerados. */
const ZIPS_DIR = '/tmp/zips';

/**
 * Adapter de workspace temporário baseado no sistema de arquivos local,
 * ancorado em `/tmp` (paths efêmeros do container).
 *
 * Implementa {@link TempWorkspacePort} resolvendo os caminhos de cada job e
 * garantindo a criação/limpeza dos diretórios correspondentes.
 */
@Injectable()
export class LocalTempWorkspaceAdapter implements TempWorkspacePort {
  constructor(@Inject(LOGGER) private readonly logger: LoggerPort) {}

  /**
   * Cria os diretórios temporários do job e retorna os caminhos resolvidos.
   *
   * @param videoId Identificador do vídeo (usado como nome de arquivo/pasta).
   * @returns Os caminhos locais (`videoPath`, `framesDir`, `zipPath`) do job.
   */
  async create(videoId: string): Promise<JobWorkspace> {
    const workspace: JobWorkspace = {
      videoPath: path.join(VIDEOS_DIR, `${videoId}.mp4`),
      framesDir: path.join(FRAMES_DIR, videoId),
      zipPath: path.join(ZIPS_DIR, `${videoId}.zip`),
    };

    await mkdir(VIDEOS_DIR, { recursive: true });
    await mkdir(workspace.framesDir, { recursive: true });
    await mkdir(ZIPS_DIR, { recursive: true });

    this.logger.log('Temp workspace created', { videoId, ...workspace });
    return workspace;
  }

  /**
   * Remove TODOS os artefatos temporários do job (melhor esforço).
   *
   * Cada remoção é isolada em seu próprio `try/catch`: uma falha apenas gera
   * um `warn` e não interrompe as demais remoções. Este método NUNCA lança —
   * o cleanup roda no `finally` do pipeline e não deve mascarar o erro real.
   *
   * @param workspace Caminhos do job a serem removidos.
   */
  async cleanup(workspace: JobWorkspace): Promise<void> {
    const targets: ReadonlyArray<string> = [
      workspace.videoPath,
      workspace.framesDir,
      workspace.zipPath,
    ];

    for (const target of targets) {
      try {
        await rm(target, { recursive: true, force: true });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn('Failed to remove temp artifact', { target, reason });
      }
    }

    this.logger.log('Temp workspace cleaned up', { ...workspace });
  }
}
