import { Inject, Injectable } from '@nestjs/common';
import { LOGGER } from 'src/modules/shared/ports/logger.token';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { ProcessVideoCommand } from 'src/modules/video-processing/application/dtos/process-video.command';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import { CORE_API } from 'src/modules/video-processing/domain/ports/core-api.port';
import type { CoreApiPort } from 'src/modules/video-processing/domain/ports/core-api.port';
import { FRAME_ARCHIVER } from 'src/modules/video-processing/domain/ports/frame-archiver.port';
import type { FrameArchiverPort } from 'src/modules/video-processing/domain/ports/frame-archiver.port';
import { FRAME_EXTRACTOR } from 'src/modules/video-processing/domain/ports/frame-extractor.port';
import type { FrameExtractorPort } from 'src/modules/video-processing/domain/ports/frame-extractor.port';
import { TEMP_WORKSPACE } from 'src/modules/video-processing/domain/ports/temp-workspace.port';
import type { TempWorkspacePort } from 'src/modules/video-processing/domain/ports/temp-workspace.port';
import { VIDEO_STORAGE } from 'src/modules/video-processing/domain/ports/video-storage.port';
import type { VideoStoragePort } from 'src/modules/video-processing/domain/ports/video-storage.port';

/**
 * Orquestra o pipeline de processamento de vídeo:
 * download (S3) -> extração de frames (FFmpeg) -> zip -> upload (S3) -> notifica Core.
 */
@Injectable()
export class ProcessVideoUseCase {
  constructor(
    @Inject(VIDEO_STORAGE) private readonly storage: VideoStoragePort,
    @Inject(FRAME_EXTRACTOR)
    private readonly frameExtractor: FrameExtractorPort,
    @Inject(FRAME_ARCHIVER) private readonly archiver: FrameArchiverPort,
    @Inject(CORE_API) private readonly coreApi: CoreApiPort,
    @Inject(TEMP_WORKSPACE)
    private readonly tempWorkspace: TempWorkspacePort,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {}

  /**
   * Executa o pipeline completo para um vídeo.
   *
   * Contrato de delete-vs-retry para o consumer do SQS:
   * - `execute()` RESOLVE (não lança) => a mensagem DEVE ser apagada do SQS.
   *   Cobre tanto o caminho de sucesso (`DONE`) quanto o erro de NEGÓCIO
   *   (`MediaProcessingException`): vídeo corrompido/não suportado nunca será
   *   processado com sucesso, então marcamos `ERROR` na Core e finalizamos.
   * - `execute()` LANÇA (rethrow de erro de INFRA, ex. `ExternalServiceException`)
   *   => a mensagem NÃO deve ser apagada; o SQS reentrega/encaminha para DLQ.
   *
   * O cleanup do workspace temporário roda SEMPRE (finally).
   */
  async execute(command: ProcessVideoCommand): Promise<void> {
    const { videoId, userId, s3VideoKey } = command;
    this.logger.log('Starting video processing job', { videoId, userId });
    const ws = await this.tempWorkspace.create(videoId);
    try {
      await this.storage.download(s3VideoKey, ws.videoPath); // A (infra error propagates)
      await this.frameExtractor.extractFrames(ws.videoPath, ws.framesDir); // B (MediaProcessingException = business)
      await this.archiver.archiveDirectory(ws.framesDir, ws.zipPath); // C
      const zipKey = `zips/${userId}/${videoId}.zip`;
      await this.storage.upload(ws.zipPath, zipKey); // D (infra)
      await this.coreApi.updateVideoStatus(videoId, {
        status: 'DONE',
        s3ZipKey: zipKey,
      }); // E (infra)
      this.logger.log('Video processing job completed', { videoId, zipKey });
    } catch (err) {
      if (err instanceof MediaProcessingException) {
        // BUSINESS error: tell Core it failed, then RESOLVE so the caller deletes the SQS message.
        this.logger.error(
          'Media processing failed (business error) — notifying Core ERROR',
          err,
          { videoId },
        );
        await this.coreApi.updateVideoStatus(videoId, { status: 'ERROR' }); // if THIS fails (infra) it rethrows -> retry
        return;
      }
      // INFRA error: rethrow so caller does NOT delete the message (SQS will retry / DLQ).
      this.logger.error(
        'Infrastructure error during processing — will retry',
        err,
        { videoId },
      );
      throw err;
    } finally {
      await this.tempWorkspace.cleanup(ws); // F: cleanup ALWAYS
    }
  }
}
