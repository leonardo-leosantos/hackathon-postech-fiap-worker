import {
  VideoErrorCode,
  VideoProcessingStatus,
} from '../value-objects/video-status.vo';

export const CORE_API = Symbol('CORE_API');

/** Payload enviado à Core API ao atualizar o status de um vídeo. */
export interface UpdateVideoStatusPayload {
  status: VideoProcessingStatus;
  /** Somente quando `status === 'DONE'`. */
  s3ZipKey?: string;
  /** OBRIGATÓRIO quando `status === 'ERROR'` (o core devolve 400 sem ele). */
  errorCode?: VideoErrorCode;
  /**
   * Detalhe técnico do erro para log/auditoria (stderr do ffmpeg, mensagem do
   * SDK...). NUNCA é mostrado ao usuário. Truncado em 1000 chars pelo adapter.
   */
  errorReason?: string;
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
