/**
 * Comando de entrada do caso de uso de processamento de vídeo.
 * Deriva da mensagem recebida no SQS.
 */
export interface ProcessVideoCommand {
  videoId: string;
  userId: string;
  s3VideoKey: string;
}
