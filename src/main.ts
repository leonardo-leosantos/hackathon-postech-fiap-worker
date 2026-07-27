import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Shutdown explícito em vez de app.enableShutdownHooks(): o node roda como
  // PID 1 no container e o re-raise de sinal que o Nest faz após os hooks é
  // ignorado pelo kernel para PID 1 — o processo ficava vivo até o SIGKILL no
  // fim do terminationGracePeriodSeconds (300s), atrasando todo rollout.
  // app.close() dispara o ciclo de shutdown normalmente (o SqsVideoConsumer
  // aguarda o drain da iteração corrente no onModuleDestroy) e o process.exit
  // garante a saída assim que o drain termina.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    Logger.log(`${signal} received — closing application`, 'Bootstrap');
    app
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        Logger.error(
          'Error during shutdown',
          err instanceof Error ? err.stack : String(err),
          'Bootstrap',
        );
        process.exit(1);
      });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  Logger.log(
    `Video Worker started, listening for SQS messages (health on port ${port})`,
    'Bootstrap',
  );
}

void bootstrap();
