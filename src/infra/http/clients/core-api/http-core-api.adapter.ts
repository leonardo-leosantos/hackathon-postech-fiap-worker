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
  private readonly logger = new Logger(HttpCoreApiAdapter.name);

  constructor(private readonly config: AppConfigService) {}

  /**
   * PATCH `${API_URL}/internal/videos/${videoId}/status`.
   *
   * O axios lança automaticamente em respostas não-2xx, então tanto erros de
   * rede/timeout quanto status HTTP inválidos caem no `catch` e resultam em
   * `ExternalServiceException` (disparando o retry via SQS).
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
      await axios.patch(url, payload, { timeout: 10000 });
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
