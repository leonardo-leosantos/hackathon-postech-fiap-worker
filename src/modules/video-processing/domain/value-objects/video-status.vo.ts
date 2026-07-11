/**
 * Status de processamento de vídeo reportados à Core API.
 * - `DONE`: frames extraídos, zipados e enviados com sucesso.
 * - `ERROR`: vídeo corrompido/não processável (erro de negócio).
 */
export type VideoProcessingStatus = 'DONE' | 'ERROR';
