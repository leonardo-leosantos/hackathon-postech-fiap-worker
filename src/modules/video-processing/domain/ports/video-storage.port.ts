export const VIDEO_STORAGE = Symbol('VIDEO_STORAGE');

/**
 * Porta de armazenamento de vídeo (S3). Abstrai download/upload de objetos.
 */
export interface VideoStoragePort {
  /** Download the S3 object at `key` to local `destPath`. Throws ExternalServiceException on failure. */
  download(key: string, destPath: string): Promise<void>;
  /** Upload local `filePath` to S3 under `key`. Throws ExternalServiceException on failure. */
  upload(filePath: string, key: string): Promise<void>;
}
