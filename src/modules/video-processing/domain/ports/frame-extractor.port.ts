export const FRAME_EXTRACTOR = Symbol('FRAME_EXTRACTOR');

/**
 * Porta de extração de frames de um vídeo (FFmpeg).
 */
export interface FrameExtractorPort {
  /** Extract 1 frame per second from `videoPath` into `framesDir` (frame-%04d.jpg). Throws MediaProcessingException if ffmpeg fails on a corrupt/unsupported video. */
  extractFrames(videoPath: string, framesDir: string): Promise<void>;
}
