import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from 'src/config/app-config.service';
import { validateEnv } from 'src/config/env.schema';

/**
 * Módulo global de configuração.
 * Registra o `ConfigModule` com validação via `zod` (fail-fast no boot)
 * e disponibiliza o `AppConfigService` tipado para injeção em toda a app.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
