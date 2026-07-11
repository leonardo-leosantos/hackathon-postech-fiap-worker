export const FRAME_ARCHIVER = Symbol('FRAME_ARCHIVER');

/**
 * Porta de compactação de um diretório de frames em um arquivo .zip.
 */
export interface FrameArchiverPort {
  /** Zip the contents of `sourceDir` into `zipPath`. */
  archiveDirectory(sourceDir: string, zipPath: string): Promise<void>;
}
