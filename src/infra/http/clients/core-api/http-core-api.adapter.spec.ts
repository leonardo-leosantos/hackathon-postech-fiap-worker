/* eslint-disable @typescript-eslint/unbound-method -- asserting on jest mock method references is safe; they are never invoked with a rebound `this`. */
import axios from 'axios';
import { HttpCoreApiAdapter } from './http-core-api.adapter';
import { AppConfigService } from 'src/config/app-config.service';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import { VideoErrorCode } from 'src/modules/video-processing/domain/value-objects/video-status.vo';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HttpCoreApiAdapter', () => {
  const apiUrl = 'http://core.internal';
  const internalApiToken = 'internal-token-123';
  const videoId = 'video-1';

  const config = {
    apiUrl,
    internalApiToken,
  } as unknown as AppConfigService;

  let adapter: HttpCoreApiAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.patch.mockResolvedValue({ status: 200, data: {} });
    adapter = new HttpCoreApiAdapter(config);
  });

  it('PATCHes DONE with translated blobStorageZipKey and internal header', async () => {
    await expect(
      adapter.updateVideoStatus(videoId, {
        status: 'DONE',
        s3ZipKey: 'zips/user-1/video-1.zip',
      }),
    ).resolves.toBeUndefined();

    expect(mockedAxios.patch).toHaveBeenCalledTimes(1);
    expect(mockedAxios.patch).toHaveBeenCalledWith(
      `${apiUrl}/internal/videos/${videoId}/status`,
      { status: 'DONE', blobStorageZipKey: 'zips/user-1/video-1.zip' },
      {
        timeout: 10000,
        headers: { 'x-internal-token': internalApiToken },
      },
    );
  });

  it('PATCHes ERROR without the blobStorageZipKey key', async () => {
    await expect(
      adapter.updateVideoStatus(videoId, { status: 'ERROR' }),
    ).resolves.toBeUndefined();

    expect(mockedAxios.patch).toHaveBeenCalledTimes(1);

    const [, body] = mockedAxios.patch.mock.calls[0];
    expect(body).toEqual({ status: 'ERROR' });
    expect(body).not.toHaveProperty('blobStorageZipKey');
  });

  it('PATCHes ERROR with errorCode and errorReason', async () => {
    await expect(
      adapter.updateVideoStatus(videoId, {
        status: 'ERROR',
        errorCode: VideoErrorCode.CORRUPT_VIDEO,
        errorReason: 'ffmpeg: moov atom not found',
      }),
    ).resolves.toBeUndefined();

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      `${apiUrl}/internal/videos/${videoId}/status`,
      {
        status: 'ERROR',
        errorCode: 'CORRUPT_VIDEO',
        errorReason: 'ffmpeg: moov atom not found',
      },
      {
        timeout: 10000,
        headers: { 'x-internal-token': internalApiToken },
      },
    );
  });

  it('omits errorCode/errorReason when absent', async () => {
    await expect(
      adapter.updateVideoStatus(videoId, {
        status: 'DONE',
        s3ZipKey: 'zips/user-1/video-1.zip',
      }),
    ).resolves.toBeUndefined();

    const [, body] = mockedAxios.patch.mock.calls[0];
    expect(body).not.toHaveProperty('errorCode');
    expect(body).not.toHaveProperty('errorReason');
  });

  it('truncates errorReason at 1000 chars (o stderr do ffmpeg pode ser enorme)', async () => {
    await expect(
      adapter.updateVideoStatus(videoId, {
        status: 'ERROR',
        errorCode: VideoErrorCode.CORRUPT_VIDEO,
        errorReason: 'x'.repeat(5000),
      }),
    ).resolves.toBeUndefined();

    const [, body] = mockedAxios.patch.mock.calls[0];
    const { errorReason } = body as { errorReason: string };
    expect(errorReason).toHaveLength(1000);
    expect(errorReason).toBe('x'.repeat(1000));
  });

  it('throws ExternalServiceException when axios.patch rejects', async () => {
    mockedAxios.patch.mockRejectedValue(new Error('network down'));

    await expect(
      adapter.updateVideoStatus(videoId, { status: 'DONE' }),
    ).rejects.toBeInstanceOf(ExternalServiceException);
  });
});
