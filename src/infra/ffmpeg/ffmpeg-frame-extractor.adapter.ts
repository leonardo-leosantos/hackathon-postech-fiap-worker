import { mkdir, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import { ExternalServiceException } from 'src/modules/shared/exceptions/DomainException';
import { LOGGER } from 'src/modules/shared/ports/logger.token';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import type { FrameExtractorPort } from 'src/modules/video-processing/domain/ports/frame-extractor.port';
import { VideoErrorCode } from 'src/modules/video-processing/domain/value-objects/video-status.vo';

/**
 * Falha de INFRA ao subir o processo (binário ausente na imagem, sem permissão
 * de execução). Procurados SÓ em `err.message`: são erros de spawn do Node e
 * nunca aparecem legitimamente no stderr do ffmpeg. Casar contra o stderr
 * inteiro seria arriscado — ele traz a linha `configuration:` com todas as
 * flags de build em toda execução, e um falso positivo aqui classificaria um
 * vídeo corrompido como infra (DLQ + email genérico), invertindo exatamente a
 * regra que esta classificação existe para garantir.
 */
const SPAWN_FAILURE_SIGNATURES = [
  'ENOENT',
  'EACCES',
  'Cannot find ffmpeg',
  'Cannot find ffprobe',
  'spawn ffmpeg',
];

/**
 * Falha de INFRA por disco cheio. Procurada em `err.message` E no stderr: o
 * ffmpeg reporta o ENOSPC no stderr durante a escrita dos frames.
 */
const DISK_FULL_SIGNATURES = ['ENOSPC', 'No space left on device'];

/** Quantas linhas finais do stderr do ffmpeg viajam no `errorReason`. */
const STDERR_TAIL_LINES = 10;
/** Teto de caracteres da cauda do stderr (o core trunca o campo em 1000). */
const STDERR_TAIL_MAX_CHARS = 800;

/**
 * Adapter de extração de frames baseado no binário de sistema `ffmpeg`
 * (instalado na imagem Docker — nenhum caminho de binário é hardcoded).
 *
 * Implementa {@link FrameExtractorPort} extraindo 1 frame por segundo do vídeo.
 * Equivalente à CLI: `ffmpeg -i <videoPath> -vf fps=1 <framesDir>/frame-%04d.jpg`.
 */
@Injectable()
export class FfmpegFrameExtractorAdapter implements FrameExtractorPort {
  constructor(@Inject(LOGGER) private readonly logger: LoggerPort) {}

  /**
   * Extrai 1 frame/segundo de `videoPath` para `framesDir` (frame-%04d.jpg).
   *
   * O diretório de saída é criado (recursivamente) se ainda não existir.
   *
   * A falha do ffmpeg NÃO é automaticamente erro de negócio: "binário ausente"
   * e "disco cheio" são falhas da plataforma e precisam ir para retry/DLQ (e
   * jamais dizer ao usuário que o arquivo dele está corrompido). Só o que
   * sobra — falha de decode — é atribuído ao vídeo.
   *
   * @param videoPath Caminho do arquivo de vídeo de entrada.
   * @param framesDir Diretório de saída para os frames extraídos.
   * @throws {ExternalServiceException} Falha de infra (ffmpeg ausente/sem
   *   permissão, disco cheio): mensagem preservada para retry/DLQ.
   * @throws {MediaProcessingException} (`CORRUPT_VIDEO`) O ffmpeg falhou ao
   *   decodificar o vídeo; (`UNSUPPORTED_FORMAT`) terminou sem gerar frames.
   */
  async extractFrames(videoPath: string, framesDir: string): Promise<void> {
    await mkdir(framesDir, { recursive: true });

    const outputPattern = path.join(framesDir, 'frame-%04d.jpg');
    this.logger.log('Starting frame extraction', { videoPath, framesDir });

    // Acumulado FORA da promise: a guarda de 0 frames (abaixo) também precisa do
    // stderr para produzir um `errorReason` que sirva para diagnóstico.
    let stderr = '';

    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .outputOptions(['-vf', 'fps=1'])
        .output(outputPattern)
        .on('stderr', (line: string) => {
          stderr += `${line}\n`;
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          this.logger.error('FFmpeg failed to extract frames', err, {
            videoPath,
            message: err.message,
            stderr,
          });
          reject(this.classifyFfmpegError(err, stderr));
        })
        .run();
    });

    const frames = await readdir(framesDir);
    // Zero frames com exit code 0: o ffmpeg não conseguiu extrair nada do
    // stream (container/codec não suportado, vídeo vazio). Sem esta guarda o
    // vídeo viraria DONE com um zip vazio — o pior tipo de falha, porque o
    // usuário baixa um arquivo inútil achando que deu certo.
    if (frames.length === 0) {
      throw new MediaProcessingException(
        withStderrTail(
          'FFmpeg produced no frames — unsupported format or empty stream',
          stderr,
        ),
        VideoErrorCode.UNSUPPORTED_FORMAT,
      );
    }

    this.logger.log('Frame extraction completed', {
      videoPath,
      framesDir,
      frameCount: frames.length,
    });
  }

  /**
   * Decide se a falha do ffmpeg é de INFRA (nossa) ou de NEGÓCIO (do arquivo).
   * Na dúvida assume negócio: é o comportamento antigo e o único em que temos
   * informação útil para o usuário.
   */
  private classifyFfmpegError(
    err: Error,
    stderr: string,
  ): ExternalServiceException | MediaProcessingException {
    const spawnFailed = SPAWN_FAILURE_SIGNATURES.some((signature) =>
      err.message.includes(signature),
    );
    const diskFull = DISK_FULL_SIGNATURES.some(
      (signature) =>
        err.message.includes(signature) || stderr.includes(signature),
    );

    if (spawnFailed || diskFull) {
      return new ExternalServiceException(
        'FFmpeg could not run (missing binary or no disk space)',
        err,
      );
    }

    // A cauda do stderr é o que realmente diagnostica ("moov atom not found",
    // "Invalid data found when processing input") e é persistida pelo core em
    // `video_errors.error_reason` para post-mortem. Nunca é mostrada ao usuário.
    return new MediaProcessingException(
      withStderrTail(
        `FFmpeg failed to extract frames — video may be corrupt: ${err.message}`,
        stderr,
      ),
      VideoErrorCode.CORRUPT_VIDEO,
      err,
    );
  }
}

/**
 * Anexa a cauda do stderr do ffmpeg a `message` (últimas
 * {@link STDERR_TAIL_LINES} linhas, no máximo {@link STDERR_TAIL_MAX_CHARS}
 * caracteres). Retorna `message` intacta quando não houve stderr.
 */
function withStderrTail(message: string, stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return message;

  const tail = lines.slice(-STDERR_TAIL_LINES).join(' | ');
  return `${message} | stderr: ${tail.slice(-STDERR_TAIL_MAX_CHARS)}`;
}
