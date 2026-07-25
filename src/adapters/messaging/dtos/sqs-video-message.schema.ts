import { z } from 'zod';
import type { ProcessVideoCommand } from 'src/modules/video-processing/application/dtos/process-video.command';

/**
 * Schema de validação da mensagem recebida no SQS.
 *
 * Valida o CONTRATO publicado pelo core (`videoUid`, `userUid`,
 * `blobStorageVideoKey`). A tradução para o vocabulário interno do domínio é
 * feita em `parseSqsVideoMessage` (padrão hexagonal: o adapter traduz).
 *
 * Uma mensagem malformada (JSON inválido ou fora deste contrato) é tratada
 * como "poison message": `parseSqsVideoMessage` lança e o consumer NÃO deve
 * reprocessar/reentregar (nunca ficará válida).
 */
export const sqsVideoMessageSchema = z.object({
  videoUid: z.string().min(1, 'videoUid is required'),
  userUid: z.string().min(1, 'userUid is required'),
  blobStorageVideoKey: z.string().min(1, 'blobStorageVideoKey is required'),
});

/** Tipo inferido do payload validado do SQS (contrato do core). */
export type SqsVideoMessage = z.infer<typeof sqsVideoMessageSchema>;

/**
 * Faz JSON.parse + validação do corpo cru da mensagem do SQS e TRADUZ o
 * contrato do core (`videoUid`/`userUid`/`blobStorageVideoKey`) para o
 * `ProcessVideoCommand` interno (`videoId`/`userId`/`s3VideoKey`).
 *
 * @throws {SyntaxError} quando o corpo não é um JSON válido (poison message).
 * @throws {z.ZodError} quando o JSON não satisfaz o contrato (poison message).
 */
export function parseSqsVideoMessage(raw: string): ProcessVideoCommand {
  const parsed: unknown = JSON.parse(raw);
  const { videoUid, userUid, blobStorageVideoKey } =
    sqsVideoMessageSchema.parse(parsed);
  return {
    videoId: videoUid,
    userId: userUid,
    s3VideoKey: blobStorageVideoKey,
  };
}
