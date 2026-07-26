import { Logger } from '@nestjs/common';
import { NestLoggerAdapter } from './nest-logger.adapter';

describe('NestLoggerAdapter', () => {
  let adapter: NestLoggerAdapter;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;
  let debug: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    adapter = new NestLoggerAdapter();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('log delega ao Logger do Nest', () => {
    adapter.log('Video processing started');

    expect(log).toHaveBeenCalledWith('Video processing started');
  });

  it('warn delega ao Logger do Nest', () => {
    adapter.warn('Failed to remove temp artifact');

    expect(warn).toHaveBeenCalledWith('Failed to remove temp artifact');
  });

  it('debug delega ao Logger do Nest', () => {
    adapter.debug('Polling SQS');

    expect(debug).toHaveBeenCalledWith('Polling SQS');
  });

  it('serializa o contexto e anexa à mensagem (log em uma única linha)', () => {
    adapter.log('Video processing started', {
      videoId: 'video-1',
      userId: 'user-1',
    });

    expect(log).toHaveBeenCalledWith(
      'Video processing started {"videoId":"video-1","userId":"user-1"}',
    );
  });

  it('error COM trace: repassa o trace como segundo argumento', () => {
    adapter.error('Video processing failed', 'Error: boom\n  at foo', {
      videoId: 'video-1',
    });

    expect(error).toHaveBeenCalledWith(
      'Video processing failed {"videoId":"video-1"}',
      'Error: boom\n  at foo',
    );
  });

  it('error SEM trace: segundo argumento fica undefined', () => {
    adapter.error('Video processing failed');

    expect(error).toHaveBeenCalledWith('Video processing failed', undefined);
  });

  it('warn e debug também recebem o contexto serializado', () => {
    adapter.warn('Failed to remove temp artifact', {
      target: '/tmp/videos/v.mp4',
    });
    adapter.debug('Message received', { messageId: 'm-1' });

    expect(warn).toHaveBeenCalledWith(
      'Failed to remove temp artifact {"target":"/tmp/videos/v.mp4"}',
    );
    expect(debug).toHaveBeenCalledWith('Message received {"messageId":"m-1"}');
  });
});
