export const FRAME_EXTRACTOR = Symbol('FRAME_EXTRACTOR');

/**
 * Porta de extração de frames de um vídeo (FFmpeg).
 */
export interface FrameExtractorPort {
  /**
   * Extract 1 frame per second from `videoPath` into `framesDir` (frame-%04d.jpg).
   * Throws MediaProcessingException (CORRUPT_VIDEO on a decode failure,
   * UNSUPPORTED_FORMAT when no frame is produced) for bad input, and
   * ExternalServiceException for platform failures (missing binary, full disk).
   */
  extractFrames(videoPath: string, framesDir: string): Promise<void>;
}
