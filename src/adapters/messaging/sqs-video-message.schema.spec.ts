import { parseSqsVideoMessage } from './dtos/sqs-video-message.schema';

describe('parseSqsVideoMessage', () => {
  it('translates the core contract into the internal command', () => {
    const raw = JSON.stringify({
      videoUid: 'video-1',
      userUid: 'user-1',
      blobStorageVideoKey: 'uploads/user-1/video-1.mp4',
    });

    expect(parseSqsVideoMessage(raw)).toEqual({
      videoId: 'video-1',
      userId: 'user-1',
      s3VideoKey: 'uploads/user-1/video-1.mp4',
    });
  });

  it('throws for malformed JSON', () => {
    expect(() => parseSqsVideoMessage('{ not json')).toThrow();
  });

  it('throws when a required field is missing', () => {
    const raw = JSON.stringify({ videoUid: 'video-1', userUid: 'user-1' });

    expect(() => parseSqsVideoMessage(raw)).toThrow();
  });

  it('throws when a required field is empty', () => {
    const raw = JSON.stringify({
      videoUid: 'video-1',
      userUid: '',
      blobStorageVideoKey: 'uploads/user-1/video-1.mp4',
    });

    expect(() => parseSqsVideoMessage(raw)).toThrow();
  });
});
