import { VideoProcessingStatus } from '../value-objects/video-status.vo';

export const CORE_API = Symbol('CORE_API');

/** Payload enviado à Core API ao atualizar o status de um vídeo. */
export interface UpdateVideoStatusPayload {
  status: VideoProcessingStatus;
  s3ZipKey?: string;
}

/**
 * Porta de comunicação com a Core API.
 */
export interface CoreApiPort {
  /** PATCH ${API_URL}/internal/videos/${videoId}/status. Throws ExternalServiceException on network error or non-2xx. */
  updateVideoStatus(
    videoId: string,
    payload: UpdateVideoStatusPayload,
  ): Promise<void>;
}
