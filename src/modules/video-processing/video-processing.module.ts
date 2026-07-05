import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/app-config.module';
import { S3VideoStorageAdapter } from 'src/infra/aws/s3/s3-video-storage.adapter';
import { ArchiverFrameArchiverAdapter } from 'src/infra/archive/archiver-frame-archiver.adapter';
import { FfmpegFrameExtractorAdapter } from 'src/infra/ffmpeg/ffmpeg-frame-extractor.adapter';
import { LocalTempWorkspaceAdapter } from 'src/infra/filesystem/local-temp-workspace.adapter';
import { HttpCoreApiAdapter } from 'src/infra/http/clients/core-api/http-core-api.adapter';
import { NestLoggerAdapter } from 'src/infra/logging/nest-logger.adapter';
import { SqsVideoConsumer } from 'src/infra/messaging/consumers/sqs-video.consumer';
import { LOGGER } from 'src/modules/shared/ports/logger.token';
import { ProcessVideoUseCase } from 'src/modules/video-processing/application/use-cases/process-video.use-case';
import { CORE_API } from 'src/modules/video-processing/domain/ports/core-api.port';
import { FRAME_ARCHIVER } from 'src/modules/video-processing/domain/ports/frame-archiver.port';
import { FRAME_EXTRACTOR } from 'src/modules/video-processing/domain/ports/frame-extractor.port';
import { TEMP_WORKSPACE } from 'src/modules/video-processing/domain/ports/temp-workspace.port';
import { VIDEO_STORAGE } from 'src/modules/video-processing/domain/ports/video-storage.port';

/**
 * Módulo de feature do processamento de vídeo.
 *
 * Faz o wiring da arquitetura hexagonal: cada porta de domínio (Symbol token) é
 * ligada ao seu adapter de infraestrutura, e o `SqsVideoConsumer` (driving
 * adapter) é registrado como provider para que seus hooks de ciclo de vida
 * (`onApplicationBootstrap` / `onModuleDestroy`) sejam disparados pelo Nest.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    ProcessVideoUseCase,
    SqsVideoConsumer,
    { provide: LOGGER, useClass: NestLoggerAdapter },
    { provide: VIDEO_STORAGE, useClass: S3VideoStorageAdapter },
    { provide: FRAME_EXTRACTOR, useClass: FfmpegFrameExtractorAdapter },
    { provide: FRAME_ARCHIVER, useClass: ArchiverFrameArchiverAdapter },
    { provide: CORE_API, useClass: HttpCoreApiAdapter },
    { provide: TEMP_WORKSPACE, useClass: LocalTempWorkspaceAdapter },
  ],
})
export class VideoProcessingModule {}
