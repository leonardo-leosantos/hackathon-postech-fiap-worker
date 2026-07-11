import { DomainException } from 'src/modules/shared/exceptions/DomainException';

/**
 * Erro de NEGÓCIO: o vídeo é intrinsecamente inválido/corrompido/não suportado
 * e nenhuma nova tentativa irá processá-lo com sucesso.
 *
 * Semântica business-vs-infra:
 * - BUSINESS (esta exceção): o input em si é ruim. O consumer deve marcar o
 *   vídeo como `ERROR` na Core API e APAGAR a mensagem do SQS (não faz sentido
 *   reprocessar — resultaria no mesmo erro).
 * - INFRA (ex.: `ExternalServiceException`): falha transitória de rede/S3/API.
 *   A mensagem NÃO deve ser apagada; o SQS reentrega/encaminha para a DLQ.
 */
export class MediaProcessingException extends DomainException {}
