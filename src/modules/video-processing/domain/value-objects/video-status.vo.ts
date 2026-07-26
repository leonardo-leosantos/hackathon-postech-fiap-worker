/**
 * Status de processamento de vídeo reportados à Core API.
 * - `DONE`: frames extraídos, zipados e enviados com sucesso.
 * - `ERROR`: falha no processamento (ver {@link VideoErrorCode} para o motivo).
 */
export type VideoProcessingStatus = 'DONE' | 'ERROR';

/**
 * Taxonomia do motivo da falha, enviada junto com `status: 'ERROR'` no PATCH
 * de status. É o que permite ao core escolher a mensagem do email ao usuário.
 *
 * ⚠️ ESPELHADO de
 * `hackathon-postech-fiap-core/src/modules/videos/domain/video-error-code.enum.ts`.
 * Não existe lib compartilhada entre os repos: qualquer alteração aqui precisa
 * ser replicada lá (e vice-versa). O teste `video-status.vo.spec.ts` trava os
 * valores literais — é a única barreira automática contra drift.
 *
 * Este worker só emite os três primeiros. `INTERNAL_ERROR` e `TIMEOUT` são
 * atribuídos pelo core (consumer da DLQ e reaper), justamente nos casos em que
 * o worker não conseguiu reportar nada.
 */
export enum VideoErrorCode {
  /** Arquivo ilegível / stream de vídeo inválido (ffmpeg falhou ao decodificar). */
  CORRUPT_VIDEO = 'CORRUPT_VIDEO',
  /** Container/codec não suportado, ou nenhum frame extraído. */
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
  /** Objeto não existe no S3 (upload do usuário nunca foi concluído). */
  SOURCE_NOT_FOUND = 'SOURCE_NOT_FOUND',
  /** Falha nossa: S3 fora, disco cheio, ffmpeg ausente, crash. Setado pelo core. */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  /** Não terminou dentro da janela de processamento. Setado pelo core. */
  TIMEOUT = 'TIMEOUT',
}
