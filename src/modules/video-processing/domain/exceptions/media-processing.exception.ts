import { DomainException } from 'src/modules/shared/exceptions/DomainException';
import { VideoErrorCode } from 'src/modules/video-processing/domain/value-objects/video-status.vo';

/**
 * Erro de NEGÓCIO: nenhuma nova tentativa irá processar este vídeo com sucesso.
 *
 * Semântica business-vs-infra:
 * - BUSINESS (esta exceção): o input em si é ruim — vídeo corrompido/não
 *   suportado (`CORRUPT_VIDEO`, `UNSUPPORTED_FORMAT`) ou o objeto simplesmente
 *   não existe no S3 (`SOURCE_NOT_FOUND`). O consumer deve marcar o vídeo como
 *   `ERROR` na Core API e APAGAR a mensagem do SQS (reprocessar resultaria no
 *   mesmo erro).
 * - INFRA (ex.: `ExternalServiceException`): falha transitória/nossa —
 *   rede/S3/API fora, disco cheio (`ENOSPC`), binário do ffmpeg ausente.
 *   A mensagem NÃO deve ser apagada; o SQS reentrega/encaminha para a DLQ, e o
 *   core atribui `INTERNAL_ERROR` a partir da DLQ.
 *
 * O `code` viaja no PATCH de status para o core, que escolhe a mensagem do
 * email a partir dele. Por isso é obrigatório: uma falha de negócio sem código
 * é rejeitada com 400 pelo core.
 */
export class MediaProcessingException extends DomainException {
  constructor(
    message: string,
    readonly code: VideoErrorCode,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}
