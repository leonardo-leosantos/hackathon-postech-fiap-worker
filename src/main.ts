import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilita os hooks de shutdown (SIGTERM/SIGINT) para que o
  // SqsVideoConsumer.onModuleDestroy seja chamado e o polling encerre de forma
  // graciosa quando o ECS/Docker parar o container.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  Logger.log(
    `Video Worker started, listening for SQS messages (health on port ${port})`,
    'Bootstrap',
  );
}

void bootstrap();
