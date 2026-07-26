/**
 * Prefixo do S3 onde os zips de frames são gravados.
 * Ver {@link buildZipStorageKey} para a convenção completa.
 */
export const ZIP_KEY_PREFIX = 'zips';

/**
 * Monta a chave do S3 do zip de frames: `zips/<userId>/<videoId>.zip`.
 *
 * ⚠️ ACOPLAMENTO COM O CORE — esta convenção é ESPELHADA em
 * `hackathon-postech-fiap-core` (guarda anti-falso-positivo do consumer da DLQ:
 * antes de marcar `ERROR` ele checa se este objeto existe no S3, para não mandar
 * email de "falhou" num vídeo que na verdade deu certo e só teve o callback de
 * status falhando).
 *
 * Se a convenção mudar só de um lado NADA quebra em teste: a guarda do core
 * simplesmente para de encontrar o zip e volta a mandar email errado, em
 * silêncio. Alterar aqui exige alterar lá no mesmo deploy.
 */
export function buildZipStorageKey(userId: string, videoId: string): string {
  return `${ZIP_KEY_PREFIX}/${userId}/${videoId}.zip`;
}
