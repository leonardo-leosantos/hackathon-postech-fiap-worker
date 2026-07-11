export interface LoggerPort {
  log(message: string, context?: Record<string, any>): void;
  error(message: string, trace?: unknown, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  debug(message: string, context?: Record<string, any>): void;
}
