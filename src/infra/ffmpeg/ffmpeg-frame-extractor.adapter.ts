import { mkdir, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import { MediaProcessingException } from 'src/modules/video-processing/domain/exceptions/media-processing.exception';
import type { FrameExtractorPort } from 'src/modules/video-processing/domain/ports/frame-extractor.port';

/**
 * Adapter de extração de frames baseado no binário de sistema `ffmpeg`
 * (instalado na imagem Docker — nenhum caminho de binário é hardcoded).
 *
 * Implementa {@link FrameExtractorPort} extraindo 1 frame por segundo do vídeo.
 * Equivalente à CLI: `ffmpeg -i <videoPath> -vf fps=1 <framesDir>/frame-%04d.jpg`.
 */
@Injectable()
export class FfmpegFrameExtractorAdapter implements FrameExtractorPort {
  /**
   * Extrai 1 frame/segundo de `videoPath` para `framesDir` (frame-%04d.jpg).
   *
   * O diretório de saída é criado (recursivamente) se ainda não existir.
   * Qualquer falha do ffmpeg é tratada como erro de NEGÓCIO: o vídeo é
   * considerado corrompido/não suportado e uma {@link MediaProcessingException}
   * é lançada (o consumer deve marcar `ERROR` e apagar a mensagem do SQS).
   *
   * @param videoPath Caminho do arquivo de vídeo de entrada.
   * @param framesDir Diretório de saída para os frames extraídos.
   * @throws {MediaProcessingException} Quando o ffmpeg falha ao processar o vídeo.
   */
  async extractFrames(videoPath: string, framesDir: string): Promise<void> {
    await mkdir(framesDir, { recursive: true });

    const outputPattern = path.join(framesDir, 'frame-%04d.jpg');
    console.log('Starting frame extraction', { videoPath, framesDir });

    await new Promise<void>((resolve, reject) => {
      let stderr = '';
      ffmpeg(videoPath)
        .outputOptions(['-vf', 'fps=1'])
        .output(outputPattern)
        .on('stderr', (line: string) => {
          stderr += `${line}\n`;
        })
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          console.error('FFmpeg failed to extract frames', {
            videoPath,
            message: err.message,
            stderr,
          });
          reject(
            new MediaProcessingException(
              'FFmpeg failed to extract frames — video may be corrupt',
              err,
            ),
          );
        })
        .run();
    });

    const frames = await readdir(framesDir);
    console.log('Frame extraction completed', {
      videoPath,
      framesDir,
      frameCount: frames.length,
    });
  }
}
