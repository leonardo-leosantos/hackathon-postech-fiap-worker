import { ConfigService } from '@nestjs/config';
import { AppConfigService } from './app-config.service';
import type { EnvVars } from './env.schema';

describe('AppConfigService', () => {
  const env: EnvVars = {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    SQS_QUEUE_URL: 'http://localhost:4566/000000000000/video-processing',
    S3_BUCKET_NAME: 'hackathon-videos',
    API_URL: 'http://localhost:3000',
    AWS_ENDPOINT: 'http://localhost:4566',
    INTERNAL_API_TOKEN: 'internal-token',
    PORT: 3001,
    NODE_ENV: 'test',
  };

  /** ConfigService dublê: lê do objeto de env já validado. */
  const build = (vars: Partial<EnvVars>): AppConfigService =>
    new AppConfigService({
      get: (key: keyof EnvVars) => vars[key],
    } as unknown as ConfigService<EnvVars, true>);

  it('expõe cada variável validada pelo getter tipado correspondente', () => {
    const config = build(env);

    expect(config.awsRegion).toBe('us-east-1');
    expect(config.awsAccessKeyId).toBe('test');
    expect(config.awsSecretAccessKey).toBe('test');
    expect(config.sqsQueueUrl).toBe(
      'http://localhost:4566/000000000000/video-processing',
    );
    expect(config.s3BucketName).toBe('hackathon-videos');
    expect(config.apiUrl).toBe('http://localhost:3000');
    expect(config.internalApiToken).toBe('internal-token');
    expect(config.port).toBe(3001);
  });

  it('awsEndpoint presente: aponta S3/SQS para o LocalStack', () => {
    expect(build(env).awsEndpoint).toBe('http://localhost:4566');
  });

  it('awsEndpoint ausente: undefined, para o SDK usar a AWS real', () => {
    const withoutEndpoint: Partial<EnvVars> = { ...env };
    delete withoutEndpoint.AWS_ENDPOINT;

    expect(build(withoutEndpoint).awsEndpoint).toBeUndefined();
  });
});
