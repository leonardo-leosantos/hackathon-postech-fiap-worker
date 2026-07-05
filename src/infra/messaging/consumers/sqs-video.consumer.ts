import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { AppConfigService } from 'src/config/app-config.service';
import { LOGGER } from 'src/modules/shared/ports/logger.token';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { ProcessVideoUseCase } from 'src/modules/video-processing/application/use-cases/process-video.use-case';
import { parseSqsVideoMessage } from 'src/adapters/messaging/dtos/sqs-video-message.schema';

/** Long polling do SQS (em segundos). */
const WAIT_TIME_SECONDS = 20;
/** Tempo que a mensagem fica invisível enquanto o job roda (em segundos). */
const VISIBILITY_TIMEOUT_SECONDS = 300;
/** Backoff aplicado quando o próprio `receive` falha (em ms). */
const RECEIVE_BACKOFF_MS = 5_000;

/**
 * Adapter de entrada (driving adapter): consome a fila do SQS via long polling
 * e delega cada mensagem ao `ProcessVideoUseCase`.
 *
 * Semântica de ACK (o motivo de existir do worker):
 * - `useCase.execute()` RESOLVE (sucesso ou erro de negócio já tratado)
 *   => a mensagem É apagada do SQS.
 * - `useCase.execute()` LANÇA (erro de infra) => a mensagem NÃO é apagada;
 *   o SQS reentrega após o visibility timeout e, após 3 tentativas, envia à DLQ.
 * - Mensagem poison (JSON/contrato inválido) => também NÃO é apagada aqui;
 *   segue o mesmo caminho de reentrega/DLQ.
 */
@Injectable()
export class SqsVideoConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly client: SQSClient;
  private readonly queueUrl: string;
  private running = false;
  private pollingLoop?: Promise<void>;

  constructor(
    private readonly useCase: ProcessVideoUseCase,
    private readonly config: AppConfigService,
    @Inject(LOGGER) private readonly logger: LoggerPort,
  ) {
    this.queueUrl = this.config.sqsQueueUrl;
    this.client = new SQSClient({
      region: this.config.awsRegion,
      credentials: {
        accessKeyId: this.config.awsAccessKeyId,
        secretAccessKey: this.config.awsSecretAccessKey,
      },
    });
  }

  onApplicationBootstrap(): void {
    this.running = true;
    this.logger.log('SQS video consumer started — listening for messages', {
      queueUrl: this.queueUrl,
    });
    // Não damos await: o loop deve rodar em background durante todo o ciclo de vida.
    this.pollingLoop = this.poll();
  }

  onModuleDestroy(): void {
    // Sinaliza o loop para encerrar de forma graciosa após a iteração atual.
    this.running = false;
    this.logger.log('SQS video consumer stopping — draining current iteration');
  }

  private async poll(): Promise<void> {
    while (this.running) {
      let messages: Message[];
      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            VisibilityTimeout: VISIBILITY_TIMEOUT_SECONDS,
          }),
        );
        messages = response.Messages ?? [];
      } catch (err) {
        // Falha de infra no próprio receive: não derruba o loop, apenas espera e tenta de novo.
        this.logger.error(
          'Failed to receive messages from SQS — backing off',
          err,
          { queueUrl: this.queueUrl },
        );
        await this.sleep(RECEIVE_BACKOFF_MS);
        continue;
      }

      for (const message of messages) {
        await this.handleMessage(message);
      }
    }

    this.logger.log('SQS video consumer polling loop exited');
  }

  private async handleMessage(message: Message): Promise<void> {
    const { Body: body, ReceiptHandle: receiptHandle } = message;

    if (body === undefined || receiptHandle === undefined) {
      // Sem corpo ou sem receipt handle não há o que processar nem como apagar.
      this.logger.warn(
        'Received SQS message without body/receiptHandle — skipping',
        {
          messageId: message.MessageId,
        },
      );
      return;
    }

    try {
      const command = parseSqsVideoMessage(body);
      this.logger.log('SQS message received', { videoId: command.videoId });

      // RESOLVE => sucesso ou erro de negócio tratado; em ambos apagamos a mensagem.
      await this.useCase.execute(command);

      this.logger.log('Video processing job succeeded', {
        videoId: command.videoId,
      });

      await this.deleteMessage(receiptHandle);
      this.logger.log('SQS message deleted', { videoId: command.videoId });
    } catch (err) {
      // Chegar aqui significa: (a) poison message (parse/validação) ou
      // (b) erro de INFRA lançado pelo use case. Em ambos NÃO apagamos:
      // o SQS reentrega após o visibility timeout e encaminha à DLQ após 3 tentativas.
      this.logger.error(
        'Message processing failed — leaving it on the queue for retry/DLQ',
        err,
        { messageId: message.MessageId },
      );
    }
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
