import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from 'src/config/app-config.service';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import type {
  CoreApiPort,
  UpdateVideoStatusPayload,
} from 'src/modules/video-processing/domain/ports/core-api.port';

/**
 * Adaptador HTTP para a Core API (implementação de infraestrutura de `CoreApiPort`).
 *
 * IMPORTANTE (contrato de retry): esta é uma dependência de INFRAESTRUTURA.
 * Qualquer falha aqui (erro de rede, timeout ou resposta não-2xx) é lançada como
 * `ExternalServiceException`. O use-case relança esse erro, o consumer do SQS NÃO
 * apaga a mensagem e o SQS reentrega/encaminha para a DLQ. Falhar silenciosamente
 * quebraria a garantia de entrega da atualização de status.
 */
@Injectable()
export class HttpCoreApiAdapter implements CoreApiPort {
  /**
   * Limite de `errorReason` aceito pelo core (`video_errors.error_reason`).
   * O stderr do ffmpeg pode ser enorme, então truncamos antes de enviar para
   * não tomar 400 por tamanho.
   */
  private static readonly MAX_ERROR_REASON_LENGTH = 1000;

  private readonly logger = new Logger(HttpCoreApiAdapter.name);

  constructor(private readonly config: AppConfigService) {}

  /**
   * PATCH `${API_URL}/internal/videos/${videoId}/status`.
   *
   * O axios lança automaticamente em respostas não-2xx, então tanto erros de
   * rede/timeout quanto status HTTP inválidos caem no `catch` e resultam em
   * `ExternalServiceException` (disparando o retry via SQS). Isso inclui o 400
   * que o core devolve quando falta `errorCode` num `status: 'ERROR'` —
   * esquecer o código falha ruidosamente, não em silêncio.
   *
   * @throws {ExternalServiceException} em erro de rede, timeout ou resposta não-2xx.
   */
  async updateVideoStatus(
    videoId: string,
    payload: UpdateVideoStatusPayload,
  ): Promise<void> {
    const url = `${this.config.apiUrl}/internal/videos/${videoId}/status`;
    this.logger.log(
      `Notifying Core API of video status update ${JSON.stringify({
        videoId,
        status: payload.status,
      })}`,
    );

    try {
      // Traduz o vocabulário do domínio para o DTO do core
      // (s3ZipKey -> blobStorageZipKey) e envia o header interno de autenticação.
      const body = {
        status: payload.status,
        ...(payload.s3ZipKey ? { blobStorageZipKey: payload.s3ZipKey } : {}),
        ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
        ...(payload.errorReason
          ? {
              errorReason: payload.errorReason.slice(
                0,
                HttpCoreApiAdapter.MAX_ERROR_REASON_LENGTH,
              ),
            }
          : {}),
      };
      await axios.patch(url, body, {
        timeout: 10000,
        headers: { 'x-internal-token': this.config.internalApiToken },
      });
      this.logger.log(
        `Core API notified of video status update ${JSON.stringify({
          videoId,
          status: payload.status,
        })}`,
      );
    } catch (err) {
      throw new ExternalServiceException(
        'Failed to notify Core API of video status',
        err,
      );
    }
  }
}
