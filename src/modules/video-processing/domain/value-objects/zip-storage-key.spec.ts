import { buildZipStorageKey } from './zip-storage-key';

/**
 * Teste de ANTI-DRIFT: o consumer da DLQ do core checa a existência de
 * `zips/{userUid}/{videoUid}.zip` no S3 antes de marcar `ERROR`, para não mandar
 * email de "falhou" num vídeo que deu certo. Mudar esta convenção só aqui não
 * quebra nada visivelmente — a guarda do core só para de encontrar o zip.
 */
describe('buildZipStorageKey (convenção espelhada no core)', () => {
  it('trava o formato zips/<userId>/<videoId>.zip', () => {
    expect(buildZipStorageKey('user-1', 'video-1')).toBe(
      'zips/user-1/video-1.zip',
    );
  });
});
