/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mock method references is safe; they are never invoked with a rebound `this`. */
import { ProcessVideoUseCase } from './process-video.use-case';
import { ProcessVideoCommand } from 'src/modules/video-processing/application/dtos/process-video.command';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import type { JobWorkspace } from 'src/modules/video-processing/domain/ports/temp-workspace.port';
import type { VideoStoragePort } from 'src/modules/video-processing/domain/ports/video-storage.port';
import type { FrameExtractorPort } from 'src/modules/video-processing/domain/ports/frame-extractor.port';
import type { FrameArchiverPort } from 'src/modules/video-processing/domain/ports/frame-archiver.port';
import type { CoreApiPort } from 'src/modules/video-processing/domain/ports/core-api.port';
import type { TempWorkspacePort } from 'src/modules/video-processing/domain/ports/temp-workspace.port';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';

describe('ProcessVideoUseCase', () => {
  const command: ProcessVideoCommand = {
    videoId: 'video-1',
    userId: 'user-1',
    s3VideoKey: 'uploads/user-1/video-1.mp4',
  };

  const workspace: JobWorkspace = {
    videoPath: '/tmp/videos/video-1.mp4',
    framesDir: '/tmp/frames/video-1',
    zipPath: '/tmp/zips/video-1.zip',
  };

  let storage: jest.Mocked<VideoStoragePort>;
  let frameExtractor: jest.Mocked<FrameExtractorPort>;
  let archiver: jest.Mocked<FrameArchiverPort>;
  let coreApi: jest.Mocked<CoreApiPort>;
  let tempWorkspace: jest.Mocked<TempWorkspacePort>;
  let logger: jest.Mocked<LoggerPort>;
  let useCase: ProcessVideoUseCase;

  beforeEach(() => {
    storage = {
      download: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
    };
    frameExtractor = {
      extractFrames: jest.fn().mockResolvedValue(undefined),
    };
    archiver = {
      archiveDirectory: jest.fn().mockResolvedValue(undefined),
    };
    coreApi = {
      updateVideoStatus: jest.fn().mockResolvedValue(undefined),
    };
    tempWorkspace = {
      create: jest.fn().mockResolvedValue(workspace),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    useCase = new ProcessVideoUseCase(
      storage,
      frameExtractor,
      archiver,
      coreApi,
      tempWorkspace,
      logger,
    );
  });

  it('(a) success: runs the full pipeline, marks DONE and cleans up', async () => {
    await expect(useCase.execute(command)).resolves.toBeUndefined();

    expect(storage.download).toHaveBeenCalledWith(
      command.s3VideoKey,
      workspace.videoPath,
    );
    expect(frameExtractor.extractFrames).toHaveBeenCalledWith(
      workspace.videoPath,
      workspace.framesDir,
    );
    expect(archiver.archiveDirectory).toHaveBeenCalledWith(
      workspace.framesDir,
      workspace.zipPath,
    );
    expect(storage.upload).toHaveBeenCalledWith(
      workspace.zipPath,
      'zips/user-1/video-1.zip',
    );
    expect(coreApi.updateVideoStatus).toHaveBeenCalledWith(command.videoId, {
      status: 'DONE',
      s3ZipKey: 'zips/user-1/video-1.zip',
    });
    expect(tempWorkspace.cleanup).toHaveBeenCalledWith(workspace);
  });

  it('(b) business error: marks ERROR, resolves (no throw) and cleans up', async () => {
    frameExtractor.extractFrames.mockRejectedValue(
      new MediaProcessingException('corrupt video'),
    );

    await expect(useCase.execute(command)).resolves.toBeUndefined();

    expect(coreApi.updateVideoStatus).toHaveBeenCalledWith(command.videoId, {
      status: 'ERROR',
    });
    expect(coreApi.updateVideoStatus).toHaveBeenCalledTimes(1);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(tempWorkspace.cleanup).toHaveBeenCalledWith(workspace);
  });

  it('(c) infra error: rethrows, does NOT notify Core, still cleans up', async () => {
    const infraError = new ExternalServiceException('S3 down');
    storage.download.mockRejectedValue(infraError);

    await expect(useCase.execute(command)).rejects.toBe(infraError);

    expect(coreApi.updateVideoStatus).not.toHaveBeenCalled();
    expect(frameExtractor.extractFrames).not.toHaveBeenCalled();
    expect(tempWorkspace.cleanup).toHaveBeenCalledWith(workspace);
  });
});
