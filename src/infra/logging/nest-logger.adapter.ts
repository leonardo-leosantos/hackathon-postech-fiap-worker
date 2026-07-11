import { Injectable, Logger } from '@nestjs/common';
import type { LoggerPort } from 'src/modules/shared/ports/LoggerPort';

/**
 * Adaptador de logging (implementação de infraestrutura de `LoggerPort`)
 * que encapsula o `Logger` nativo do NestJS.
 *
 * O objeto opcional de contexto é serializado para JSON e anexado à mensagem,
 * mantendo os logs em uma única linha legível independentemente do transporte
 * configurado no NestJS.
 */
@Injectable()
export class NestLoggerAdapter implements LoggerPort {
  private readonly logger = new Logger(NestLoggerAdapter.name);

  /**
   * Concatena a mensagem com o contexto serializado (quando presente).
   */
  private format(message: string, context?: Record<string, any>): string {
    return context ? `${message} ${JSON.stringify(context)}` : message;
  }

  log(message: string, context?: Record<string, any>): void {
    this.logger.log(this.format(message, context));
  }

  /**
   * Repassa o `trace` ao `Logger` do NestJS (segundo argumento de `error`),
   * anexando o contexto serializado à mensagem quando fornecido.
   */
  error(message: string, trace?: unknown, context?: Record<string, any>): void {
    this.logger.error(
      this.format(message, context),
      trace as string | undefined,
    );
  }

  warn(message: string, context?: Record<string, any>): void {
    this.logger.warn(this.format(message, context));
  }

  debug(message: string, context?: Record<string, any>): void {
    this.logger.debug(this.format(message, context));
  }
}
