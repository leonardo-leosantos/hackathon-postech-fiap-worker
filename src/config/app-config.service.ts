import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvVars } from 'src/config/env.schema';

/**
 * Wrapper fortemente tipado ao redor do `ConfigService` do NestJS.
 * Expõe getters tipados para cada variável de ambiente validada,
 * evitando o uso de strings mágicas e `any` pela aplicação.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvVars, true>) {}

  get awsRegion(): string {
    return this.configService.get('AWS_REGION', { infer: true });
  }

  get awsAccessKeyId(): string {
    return this.configService.get('AWS_ACCESS_KEY_ID', { infer: true });
  }

  get awsSecretAccessKey(): string {
    return this.configService.get('AWS_SECRET_ACCESS_KEY', { infer: true });
  }

  get sqsQueueUrl(): string {
    return this.configService.get('SQS_QUEUE_URL', { infer: true });
  }

  get s3BucketName(): string {
    return this.configService.get('S3_BUCKET_NAME', { infer: true });
  }

  get apiUrl(): string {
    return this.configService.get('API_URL', { infer: true });
  }

  get awsEndpoint(): string | undefined {
    return this.configService.get('AWS_ENDPOINT', { infer: true });
  }

  get internalApiToken(): string {
    return this.configService.get('INTERNAL_API_TOKEN', { infer: true });
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }
}
