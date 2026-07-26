import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { S3VideoStorageAdapter } from './s3-video-storage.adapter';
import { AppConfigService } from 'src/config/app-config.service';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import { VideoErrorCode } from 'src/modules/video-processing/domain/value-objects/video-status.vo';

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

describe('S3VideoStorageAdapter — classificação de erros', () => {
  let adapter: S3VideoStorageAdapter;
  let send: jest.Mock;
  let workDir: string;
  let destPath: string;

  beforeEach(async () => {
    adapter = new S3VideoStorageAdapter(
      configProps as unknown as AppConfigService,
    );
    send = jest.fn();
    // Substitui o transporte do SDK: o objetivo é a tradução de erro, não a rede.
    (adapter['client'] as unknown as { send: jest.Mock }).send = send;

    workDir = await mkdtemp(path.join(tmpdir(), 's3-adapter-spec-'));
    destPath = path.join(workDir, 'nested', 'video-1.mp4');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  /** Erro no formato que o AWS SDK v3 produz. */
  const awsError = (
    name: string,
    httpStatusCode?: number,
  ): Error & { $metadata?: { httpStatusCode: number } } =>
    Object.assign(new Error(name), {
      name,
      ...(httpStatusCode ? { $metadata: { httpStatusCode } } : {}),
    });

  describe('download', () => {
    it('faz streaming do corpo para o disco no caminho de sucesso', async () => {
      send.mockResolvedValue({ Body: Readable.from([Buffer.from('video')]) });

      await expect(adapter.download('uploads/v.mp4', destPath)).resolves.toBe(
        undefined,
      );
      await expect(readFile(destPath, 'utf8')).resolves.toBe('video');
    });

    it.each([
      ['NoSuchKey', undefined],
      ['NotFound', undefined],
      ['SomeOtherName', 404],
    ])(
      'objeto ausente (%s / status %s) => MediaProcessingException SOURCE_NOT_FOUND',
      async (name, status) => {
        send.mockRejectedValue(awsError(name, status));

        const error = await adapter
          .download('uploads/v.mp4', destPath)
          .catch((err: unknown) => err);

        expect(error).toBeInstanceOf(MediaProcessingException);
        expect((error as MediaProcessingException).code).toBe(
          VideoErrorCode.SOURCE_NOT_FOUND,
        );
      },
    );

    it('erro no formato legado (Code em vez de name) também é SOURCE_NOT_FOUND', async () => {
      send.mockRejectedValue(
        Object.assign(new Error('no such key'), { Code: 'NoSuchKey' }),
      );

      const error = await adapter
        .download('uploads/v.mp4', destPath)
        .catch((err: unknown) => err);

      expect(error).toBeInstanceOf(MediaProcessingException);
      expect((error as MediaProcessingException).code).toBe(
        VideoErrorCode.SOURCE_NOT_FOUND,
      );
    });

    it.each([
      ['AccessDenied', 403],
      ['InternalError', 500],
      ['TimeoutError', undefined],
    ])(
      'demais erros (%s) continuam ExternalServiceException (retry/DLQ)',
      async (name, status) => {
        send.mockRejectedValue(awsError(name, status));

        await expect(
          adapter.download('uploads/v.mp4', destPath),
        ).rejects.toBeInstanceOf(ExternalServiceException);
      },
    );

    it('corpo que não é Readable é erro de infra, não de negócio', async () => {
      send.mockResolvedValue({ Body: 'not-a-stream' });

      await expect(
        adapter.download('uploads/v.mp4', destPath),
      ).rejects.toBeInstanceOf(ExternalServiceException);
    });
  });

  describe('upload (inalterado: todo erro é de infra)', () => {
    it('envia o zip com ContentType application/zip', async () => {
      const zipPath = path.join(workDir, 'frames.zip');
      await writeFile(zipPath, 'zip-bytes');
      send.mockResolvedValue({});

      await expect(
        adapter.upload(zipPath, 'zips/user-1/video-1.zip'),
      ).resolves.toBe(undefined);

      const calls = send.mock.calls as Array<
        [{ input: Record<string, unknown> }]
      >;
      expect(calls[0][0].input).toMatchObject({
        Bucket: 'hackathon-videos',
        Key: 'zips/user-1/video-1.zip',
        ContentType: 'application/zip',
      });
    });

    it('NoSuchKey no upload NÃO virou negócio: segue ExternalServiceException', async () => {
      const zipPath = path.join(workDir, 'frames.zip');
      await writeFile(zipPath, 'zip-bytes');
      send.mockRejectedValue(awsError('NoSuchKey'));

      await expect(
        adapter.upload(zipPath, 'zips/user-1/video-1.zip'),
      ).rejects.toBeInstanceOf(ExternalServiceException);
    });
  });
});
