import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import archiver from 'archiver';
import { LOGGER } from 'src/modules/shared/ports/logger.token';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';
import type { FrameArchiverPort } from 'src/modules/video-processing/domain/ports/frame-archiver.port';

/**
 * Adapter de compactação baseado na lib `archiver`.
 *
 * Implementa {@link FrameArchiverPort} compactando todo o conteúdo de um
 * diretório de frames em um arquivo `.zip` com compressão máxima (level 9).
 */
@Injectable()
export class ArchiverFrameArchiverAdapter implements FrameArchiverPort {
  constructor(@Inject(LOGGER) private readonly logger: LoggerPort) {}

  /**
   * Compacta todo o conteúdo de `sourceDir` no arquivo `zipPath`.
   *
   * O diretório pai de `zipPath` é criado (recursivamente) se ainda não
   * existir. A stream de escrita é finalizada apenas após o evento `close`
   * do output, garantindo que o `.zip` esteja totalmente gravado em disco.
   *
   * Erros são de INFRA e são repropagados como estão (sem tradução), para que
   * o pipeline os trate como falha reprocessável.
   *
   * @param sourceDir Diretório cujo conteúdo será compactado.
   * @param zipPath Caminho de saída do arquivo `.zip`.
   * @throws Repropaga qualquer erro de escrita ou de compactação.
   */
  async archiveDirectory(sourceDir: string, zipPath: string): Promise<void> {
    await mkdir(path.dirname(zipPath), { recursive: true });

    // archiver v7 expõe a factory chamável `archiver('zip', …)` e é
    // compatível com CommonJS (v8 é ESM-only e quebra o `require` do build).
    const archive = archiver('zip', { zlib: { level: 9 } });
    const output = createWriteStream(zipPath);

    await new Promise<void>((resolve, reject) => {
      output.on('close', () => resolve());
      output.on('error', (err: Error) => reject(err));
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);
      archive.directory(sourceDir, false);
      void archive.finalize();
    });

    this.logger.log('Directory archived', {
      sourceDir,
      zipPath,
      bytes: archive.pointer(),
    });
  }
}
