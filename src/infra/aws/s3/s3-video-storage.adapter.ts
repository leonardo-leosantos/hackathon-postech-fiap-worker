import { Injectable, Logger } from '@nestjs/common';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppConfigService } from 'src/config/app-config.service';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import type { VideoStoragePort } from 'src/modules/video-processing/domain/ports/video-storage.port';

/**
 * Adaptador de armazenamento de vídeo baseado no Amazon S3.
 *
 * Implementa {@link VideoStoragePort} usando o AWS SDK v3 (`@aws-sdk/client-s3`).
 * Todo erro de I/O de rede é encapsulado em {@link ExternalServiceException}
 * para que o pipeline o trate como erro de INFRAESTRUTURA (retry / DLQ no SQS).
 */
@Injectable()
export class S3VideoStorageAdapter implements VideoStoragePort {
  private readonly logger = new Logger(S3VideoStorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: AppConfigService) {
    this.client = new S3Client({
      region: this.config.awsRegion,
      credentials: {
        accessKeyId: this.config.awsAccessKeyId,
        secretAccessKey: this.config.awsSecretAccessKey,
      },
    });
    this.bucket = this.config.s3BucketName;
  }

  /**
   * Baixa o objeto S3 identificado por `key` para o caminho local `destPath`.
   *
   * Garante que o diretório pai de `destPath` exista, então faz o streaming
   * do corpo da resposta (um `Readable` do Node) direto para um arquivo em disco,
   * evitando carregar o vídeo inteiro em memória.
   *
   * @param key Chave do objeto no bucket configurado.
   * @param destPath Caminho absoluto do arquivo de destino local.
   * @throws {ExternalServiceException} Se o download ou a escrita em disco falhar.
   */
  async download(key: string, destPath: string): Promise<void> {
    this.logger.log(`Starting S3 download: s3://${this.bucket}/${key}`);
    try {
      // Garante que o diretório pai exista antes de escrever o arquivo.
      await mkdir(dirname(destPath), { recursive: true });

      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const body = response.Body;
      if (!(body instanceof Readable)) {
        // Em ambiente Node o Body é sempre um Readable; qualquer outro caso é inesperado.
        throw new Error(
          'S3 GetObject response body is not a Node Readable stream',
        );
      }

      // Streaming do corpo da resposta para o arquivo local, aguardando a conclusão.
      await pipeline(body, createWriteStream(destPath));

      this.logger.log(
        `Finished S3 download: s3://${this.bucket}/${key} -> ${destPath}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to download video from S3 (s3://${this.bucket}/${key})`,
        err,
      );
      throw new ExternalServiceException(
        'Failed to download video from S3',
        err,
      );
    }
  }

  /**
   * Envia o arquivo local `filePath` para o S3 sob a chave `key`.
   *
   * O arquivo é lido via stream (`createReadStream`) para não carregar o
   * conteúdo inteiro em memória. `ContentType` é definido como
   * `application/zip` para arquivos `.zip`.
   *
   * @param filePath Caminho absoluto do arquivo local a ser enviado.
   * @param key Chave de destino no bucket configurado.
   * @throws {ExternalServiceException} Se o upload falhar.
   */
  async upload(filePath: string, key: string): Promise<void> {
    try {
      const body: ReadStream = createReadStream(filePath);
      const contentType = key.toLowerCase().endsWith('.zip')
        ? 'application/zip'
        : undefined;

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );

      this.logger.log(
        `Finished S3 upload: ${filePath} -> s3://${this.bucket}/${key}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to upload zip to S3 (s3://${this.bucket}/${key})`,
        err,
      );
      throw new ExternalServiceException('Failed to upload zip to S3', err);
    }
  }
}
