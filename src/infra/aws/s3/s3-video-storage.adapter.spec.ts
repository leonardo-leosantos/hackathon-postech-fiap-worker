import { S3VideoStorageAdapter } from './s3-video-storage.adapter';
import { AppConfigService } from 'src/config/app-config.service';

const configProps = {
  awsRegion: 'us-east-1',
  awsAccessKeyId: 'test',
  awsSecretAccessKey: 'test',
  s3BucketName: 'hackathon-videos',
  awsEndpoint: undefined,
};

describe('S3VideoStorageAdapter — constructor (LocalStack endpoint)', () => {
  it('honra awsEndpoint com endpoint customizado E forcePathStyle', async () => {
    const adapter = new S3VideoStorageAdapter({
      ...configProps,
      awsEndpoint: 'http://localhost:4566',
    } as unknown as AppConfigService);

    const client = adapter['client'];
    expect(client.config.forcePathStyle).toBe(true);

    const endpointProvider = client.config.endpoint;
    expect(endpointProvider).toBeDefined();
    await expect(endpointProvider!()).resolves.toMatchObject({
      hostname: 'localhost',
      port: 4566,
      protocol: 'http:',
    });
  });

  it('sem awsEndpoint usa a AWS real: endpoint undefined e forcePathStyle false', () => {
    const adapter = new S3VideoStorageAdapter(
      configProps as unknown as AppConfigService,
    );

    expect(adapter['client'].config.endpoint).toBeUndefined();
    expect(adapter['client'].config.forcePathStyle).toBe(false);
  });
});
