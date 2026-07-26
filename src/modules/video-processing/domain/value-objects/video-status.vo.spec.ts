import { VideoErrorCode } from './video-status.vo';

/**
 * Teste de ANTI-DRIFT, não de comportamento.
 *
 * `VideoErrorCode` é duplicado em
 * `hackathon-postech-fiap-core/src/modules/videos/domain/video-error-code.enum.ts`
 * (não há lib compartilhada). Os valores viajam pela rede no PATCH de status, e
 * o core valida contra o enum dele: se um lado renomear/remover um valor, a
 * notificação de falha quebra em produção.
 *
 * Se este teste falhar, a pergunta certa NÃO é "como faço passar" — é "o core
 * também mudou?". Atualizar só aqui reintroduz o drift que o teste existe para
 * pegar.
 */
describe('VideoErrorCode (espelhado do core)', () => {
  it('trava os valores literais aceitos pelo core', () => {
    expect(VideoErrorCode).toEqual({
      CORRUPT_VIDEO: 'CORRUPT_VIDEO',
      UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
      SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      TIMEOUT: 'TIMEOUT',
    });
  });

  it('mantém exatamente 5 códigos (novo código no core precisa vir para cá)', () => {
    expect(Object.keys(VideoErrorCode)).toHaveLength(5);
  });
});
