import { Inject, Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import {
  METRIC_VIDEO_PROCESSING_DURATION,
  METRIC_VIDEO_PROCESSING_TOTAL,
} from 'src/infra/http/modules/metrics/metrics.module';
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
import { buildZipStorageKey } from 'src/modules/video-processing/domain/value-objects/zip-storage-key';

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
    @InjectMetric(METRIC_VIDEO_PROCESSING_DURATION)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(METRIC_VIDEO_PROCESSING_TOTAL)
    private readonly totalCounter: Counter<string>,
  ) {}

  /**
   * Executa o pipeline completo para um vídeo.
   *
   * Contrato de delete-vs-retry para o consumer do SQS:
   * - `execute()` RESOLVE (não lança) => a mensagem DEVE ser apagada do SQS.
   *   Cobre tanto o caminho de sucesso (`DONE`) quanto o erro de NEGÓCIO
   *   (`MediaProcessingException`): nenhuma nova tentativa mudaria o resultado,
   *   então marcamos `ERROR` na Core (com o `errorCode` que o core usa para
   *   escolher a mensagem do email) e finalizamos. Além de vídeo corrompido/não
   *   suportado, isso inclui `SOURCE_NOT_FOUND` — objeto ausente no S3 é
   *   permanente, não faz sentido gastar retries.
   * - `execute()` LANÇA (rethrow de erro de INFRA, ex. `ExternalServiceException`)
   *   => a mensagem NÃO deve ser apagada; o SQS reentrega/encaminha para DLQ, e
   *   o core atribui `INTERNAL_ERROR` a partir da DLQ. Isso inclui as falhas do
   *   ffmpeg que são NOSSAS (binário ausente, disco cheio) — elas nunca dizem ao
   *   usuário que o arquivo dele é o problema.
   *
   * O cleanup do workspace temporário roda SEMPRE (finally).
   */
  async execute(command: ProcessVideoCommand): Promise<void> {
    const { videoId, userId, s3VideoKey } = command;
    this.logger.log('Starting video processing job', { videoId, userId });
    const totalStart = process.hrtime();
    const ws = await this.tempWorkspace.create(videoId);
    try {
      // Step: download
      let stepStart = process.hrtime();
      try {
        await this.storage.download(s3VideoKey, ws.videoPath); // A (infra propagates; SOURCE_NOT_FOUND = business)
        this.recordStepDuration(stepStart, 'download', 'success');
      } catch (err) {
        this.recordStepDuration(stepStart, 'download', 'failed');
        throw err;
      }

      // Step: extract_frames
      stepStart = process.hrtime();
      try {
        await this.frameExtractor.extractFrames(ws.videoPath, ws.framesDir); // B (MediaProcessingException = business)
        this.recordStepDuration(stepStart, 'extract_frames', 'success');
      } catch (err) {
        this.recordStepDuration(stepStart, 'extract_frames', 'failed');
        throw err;
      }

      // Step: zip
      stepStart = process.hrtime();
      try {
        await this.archiver.archiveDirectory(ws.framesDir, ws.zipPath); // C
        this.recordStepDuration(stepStart, 'zip', 'success');
      } catch (err) {
        this.recordStepDuration(stepStart, 'zip', 'failed');
        throw err;
      }

      // Step: upload
      stepStart = process.hrtime();
      const zipKey = buildZipStorageKey(userId, videoId);
      try {
        await this.storage.upload(ws.zipPath, zipKey); // D (infra)
        this.recordStepDuration(stepStart, 'upload', 'success');
      } catch (err) {
        this.recordStepDuration(stepStart, 'upload', 'failed');
        throw err;
      }

      // Step: notify_core
      stepStart = process.hrtime();
      try {
        await this.coreApi.updateVideoStatus(videoId, {
          status: 'DONE',
          s3ZipKey: zipKey,
        }); // E (infra)
        this.recordStepDuration(stepStart, 'notify_core', 'success');
      } catch (err) {
        this.recordStepDuration(stepStart, 'notify_core', 'failed');
        throw err;
      }

      this.logger.log('Video processing job completed', { videoId, zipKey });
      this.recordStepDuration(totalStart, 'total', 'success');
      this.totalCounter.inc({ status: 'success' });
    } catch (err) {
      if (err instanceof MediaProcessingException) {
        // BUSINESS error: tell Core it failed, then RESOLVE so the caller deletes the SQS message.
        this.logger.error(
          'Media processing failed (business error) — notifying Core ERROR',
          err,
          { videoId, errorCode: err.code },
        );
        // `errorCode` diz ao core qual mensagem de email enviar; `errorReason` é
        // só detalhe técnico (log/auditoria), nunca é mostrado ao usuário.
        const notifyStart = process.hrtime();
        try {
          await this.coreApi.updateVideoStatus(videoId, {
            status: 'ERROR',
            errorCode: err.code,
            errorReason: err.message,
          }); // if THIS fails (infra) it rethrows -> retry
          this.recordStepDuration(notifyStart, 'notify_core_error', 'success');
        } catch (notifyErr) {
          this.recordStepDuration(notifyStart, 'notify_core_error', 'failed');
          throw notifyErr;
        }

        this.recordStepDuration(totalStart, 'total', 'business_error');
        this.totalCounter.inc({ status: 'business_error' });
        return;
      }
      // INFRA error: rethrow so caller does NOT delete the message (SQS will retry / DLQ).
      this.logger.error(
        'Infrastructure error during processing — will retry',
        err,
        { videoId },
      );
      this.recordStepDuration(totalStart, 'total', 'infra_error');
      this.totalCounter.inc({ status: 'infra_error' });
      throw err;
    } finally {
      await this.tempWorkspace.cleanup(ws); // F: cleanup ALWAYS
    }
  }

  private recordStepDuration(
    start: [number, number],
    step: string,
    status: string,
  ): void {
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    this.durationHistogram.observe(
      {
        step,
        status,
      },
      durationInSeconds,
    );
  }
}
