/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mock method references is safe; they are never invoked with a rebound `this`. */
import { mockClient } from 'aws-sdk-client-mock';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SqsVideoConsumer } from './sqs-video.consumer';
import { AppConfigService } from 'src/config/app-config.service';
import { ProcessVideoUseCase } from 'src/modules/video-processing/application/use-cases/process-video.use-case';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';

const sqsMock = mockClient(SQSClient);

/** Backoff aplicado pelo consumer quando o próprio `receive` falha (ms). */
const BACKOFF_MS = 5_000;

const configProps = {
  sqsQueueUrl: 'http://localhost:4566/000000000000/video-processing',
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'test',
  awsSecretAccessKey: 'test',
  awsEndpoint: undefined,
};

const config = configProps as unknown as AppConfigService;

/**
 * Corpo no CONTRATO DO CORE (`videoUid`/`userUid`/`blobStorageVideoKey`).
 * Usar este contrato também exercita a regressão da migração de contrato.
 */
const coreContractBody = JSON.stringify({
  videoUid: 'video-1',
  userUid: 'user-1',
  blobStorageVideoKey: 'uploads/user-1/video-1.mp4',
});

/** Command interno já TRADUZIDO que o use case deve receber. */
const translatedCommand = {
  videoId: 'video-1',
  userId: 'user-1',
  s3VideoKey: 'uploads/user-1/video-1.mp4',
};

describe('SqsVideoConsumer', () => {
  let useCase: { execute: jest.Mock };
  let logger: jest.Mocked<LoggerPort>;
  let consumer: SqsVideoConsumer;

  beforeEach(() => {
    sqsMock.reset();
    jest.clearAllMocks();

    useCase = {
      execute: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    consumer = new SqsVideoConsumer(
      useCase as unknown as ProcessVideoUseCase,
      config,
      logger,
    );
  });

  afterAll(() => {
    sqsMock.restore();
  });

  describe('handleMessage — ACK semantics (delete vs retry/DLQ)', () => {
    it('1) valid core-contract message + execute resolves => translated command + message deleted', async () => {
      const message: Message = {
        MessageId: 'm-1',
        ReceiptHandle: 'rh-1',
        Body: coreContractBody,
      };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(useCase.execute).toHaveBeenCalledTimes(1);
      expect(useCase.execute).toHaveBeenCalledWith(translatedCommand);

      const deleteCalls = sqsMock.commandCalls(DeleteMessageCommand);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].args[0].input).toEqual({
        QueueUrl: config.sqsQueueUrl,
        ReceiptHandle: 'rh-1',
      });
    });

    it('2) execute rejects (infra ExternalServiceException) => NOT deleted, logs error, resolves', async () => {
      useCase.execute.mockRejectedValue(
        new ExternalServiceException('S3 down'),
      );

      const message: Message = {
        MessageId: 'm-2',
        ReceiptHandle: 'rh-2',
        Body: coreContractBody,
      };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('3) non-JSON body (poison) => execute not called, not deleted, resolves', async () => {
      const message: Message = {
        MessageId: 'm-3',
        ReceiptHandle: 'rh-3',
        Body: 'not-json',
      };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(useCase.execute).not.toHaveBeenCalled();
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('4) valid JSON but LEGACY contract (videoId/userId/s3VideoKey) => poison, no execute, no delete', async () => {
      const legacyBody = JSON.stringify({
        videoId: 'video-1',
        userId: 'user-1',
        s3VideoKey: 'uploads/user-1/video-1.mp4',
      });
      const message: Message = {
        MessageId: 'm-4',
        ReceiptHandle: 'rh-4',
        Body: legacyBody,
      };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(useCase.execute).not.toHaveBeenCalled();
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('5a) message without Body => warns, no execute, no delete', async () => {
      const message: Message = { MessageId: 'm-5a', ReceiptHandle: 'rh-5a' };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
      expect(useCase.execute).not.toHaveBeenCalled();
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    });

    it('5b) message without ReceiptHandle => warns, no execute, no delete', async () => {
      const message: Message = { MessageId: 'm-5b', Body: coreContractBody };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
      expect(useCase.execute).not.toHaveBeenCalled();
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    });

    it('6) delete fails after successful execute => resolves, logs error', async () => {
      sqsMock.on(DeleteMessageCommand).rejects(new Error('delete failed'));

      const message: Message = {
        MessageId: 'm-6',
        ReceiptHandle: 'rh-6',
        Body: coreContractBody,
      };

      await expect(consumer['handleMessage'](message)).resolves.toBeUndefined();

      expect(useCase.execute).toHaveBeenCalledTimes(1);
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('constructor — LocalStack endpoint', () => {
    it('honra awsEndpoint (LocalStack) com endpoint customizado no client', async () => {
      const withEndpoint = new SqsVideoConsumer(
        useCase as unknown as ProcessVideoUseCase,
        {
          ...configProps,
          awsEndpoint: 'http://localhost:4566',
        } as unknown as AppConfigService,
        logger,
      );

      const endpointProvider = withEndpoint['client'].config.endpoint;
      expect(endpointProvider).toBeDefined();
      await expect(endpointProvider!()).resolves.toMatchObject({
        hostname: 'localhost',
        port: 4566,
        protocol: 'http:',
      });
    });

    it('usa o endpoint padrão da AWS quando awsEndpoint está ausente', () => {
      // `consumer` do beforeEach já é construído com awsEndpoint: undefined.
      expect(consumer['client'].config.endpoint).toBeUndefined();
    });
  });

  describe('polling lifecycle', () => {
    it('7) happy loop: bootstrap -> receive 1 -> process -> delete -> destroy (loop exits)', async () => {
      let receiveCount = 0;
      sqsMock.on(ReceiveMessageCommand).callsFake(() => {
        receiveCount += 1;
        if (receiveCount === 1) {
          return {
            Messages: [
              {
                MessageId: 'm-7',
                ReceiptHandle: 'rh-7',
                Body: coreContractBody,
              },
            ],
          };
        }
        // 2ª chamada: encerra o loop de forma graciosa e devolve vazio.
        consumer.onModuleDestroy();
        return { Messages: [] };
      });

      consumer.onApplicationBootstrap();
      await consumer['pollingLoop'];

      expect(useCase.execute).toHaveBeenCalledTimes(1);
      expect(useCase.execute).toHaveBeenCalledWith(translatedCommand);
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(1);

      const receiveCalls = sqsMock.commandCalls(ReceiveMessageCommand);
      expect(receiveCalls.length).toBeGreaterThanOrEqual(1);
      expect(receiveCalls[0].args[0].input).toEqual({
        QueueUrl: config.sqsQueueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 20,
        VisibilityTimeout: 300,
      });
    });

    it('trata resposta sem Messages como lote vazio (fallback ?? [])', async () => {
      let receiveCount = 0;
      sqsMock.on(ReceiveMessageCommand).callsFake(() => {
        receiveCount += 1;
        if (receiveCount === 1) {
          return {}; // sem a propriedade Messages — cai no ?? []
        }
        consumer.onModuleDestroy();
        return { Messages: [] };
      });

      consumer.onApplicationBootstrap();
      await consumer['pollingLoop'];

      expect(useCase.execute).not.toHaveBeenCalled();
      expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
      expect(receiveCount).toBeGreaterThanOrEqual(2); // o loop não caiu
    });

    describe('with fake timers', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('8) receive itself rejects first time => logs backoff, sleeps, retries, then destroys', async () => {
        let receiveCount = 0;
        sqsMock.on(ReceiveMessageCommand).callsFake(() => {
          receiveCount += 1;
          if (receiveCount === 1) {
            throw new Error('receive failed');
          }
          // 2ª chamada: encerra o loop e devolve vazio.
          consumer.onModuleDestroy();
          return { Messages: [] };
        });

        consumer.onApplicationBootstrap();

        // Pula o backoff de 5s (sem isto o teste travaria em tempo real).
        await jest.advanceTimersByTimeAsync(BACKOFF_MS);
        await consumer['pollingLoop'];

        expect(logger.error).toHaveBeenCalledWith(
          'Failed to receive messages from SQS — backing off',
          expect.any(Error),
          expect.objectContaining({ queueUrl: config.sqsQueueUrl }),
        );
        // O loop NÃO caiu: houve uma 2ª tentativa de receive após o backoff.
        expect(receiveCount).toBeGreaterThanOrEqual(2);
        expect(useCase.execute).not.toHaveBeenCalled();
        expect(sqsMock.commandCalls(DeleteMessageCommand)).toHaveLength(0);
      });
    });
  });
});
