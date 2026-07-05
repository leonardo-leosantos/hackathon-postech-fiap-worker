import { z } from 'zod';
import type { ProcessVideoCommand } from 'src/modules/video-processing/application/dtos/process-video.command';

/**
 * Schema de validação da mensagem recebida no SQS.
 *
 * Uma mensagem malformada (JSON inválido ou fora deste contrato) é tratada
 * como "poison message": `parseSqsVideoMessage` lança e o consumer NÃO deve
 * reprocessar/reentregar (nunca ficará válida).
 */
export const sqsVideoMessageSchema = z.object({
  videoId: z.string().min(1, 'videoId is required'),
  userId: z.string().min(1, 'userId is required'),
  s3VideoKey: z.string().min(1, 's3VideoKey is required'),
});

/** Tipo inferido do payload validado do SQS. */
export type SqsVideoMessage = z.infer<typeof sqsVideoMessageSchema>;

/**
 * Faz JSON.parse + validação do corpo cru da mensagem do SQS e retorna o
 * `ProcessVideoCommand` correspondente.
 *
 * @throws {SyntaxError} quando o corpo não é um JSON válido (poison message).
 * @throws {z.ZodError} quando o JSON não satisfaz o contrato (poison message).
 */
export function parseSqsVideoMessage(raw: string): ProcessVideoCommand {
  const parsed: unknown = JSON.parse(raw);
  const { videoId, userId, s3VideoKey } = sqsVideoMessageSchema.parse(parsed);
  return { videoId, userId, s3VideoKey };
}
