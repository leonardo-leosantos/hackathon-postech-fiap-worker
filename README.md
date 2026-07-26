<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Video Worker

Serviço worker (consumidor de SQS) que processa vídeos de forma assíncrona.
Não expõe API de negócio — o único endpoint HTTP é `/health` (liveness/readiness
para o orquestrador). O trabalho real é dirigido por mensagens da fila SQS.

### Pipeline (A → F)

Para cada mensagem recebida, o `ProcessVideoUseCase` executa:

- **A. Download** — baixa o vídeo do S3 (`s3VideoKey`) para o workspace temporário local.
- **B. Extração de frames** — FFmpeg extrai 1 frame por segundo (`frame-%04d.jpg`).
- **C. Compactação** — os frames são zipados em um único `.zip`.
- **D. Upload** — o `.zip` é enviado ao S3 em `zips/<userId>/<videoId>.zip`.
- **E. Notificação** — a Core API recebe `PATCH /internal/videos/<videoId>/status`
  com `{ status: 'DONE', blobStorageZipKey }` e o header `x-internal-token`
  (`INTERNAL_API_TOKEN`). Internamente o domínio usa `s3ZipKey`; o adapter HTTP
  traduz para `blobStorageZipKey` (vocabulário do core).
- **F. Cleanup** — o workspace temporário é sempre removido (roda no `finally`).

### Payload da mensagem SQS

O corpo (`Body`) da mensagem é um JSON no contrato publicado pelo core:

```json
{
  "videoUid": "abc-123",
  "userUid": "user-42",
  "blobStorageVideoKey": "uploads/user-42/abc-123.mp4"
}
```

Os três campos são obrigatórios e não podem ser vazios. O `parseSqsVideoMessage`
valida esse contrato e traduz para o command interno (`videoId`/`userId`/`s3VideoKey`).

### Semântica de erro / DLQ

O que decide se a mensagem é apagada da fila é o resultado do use-case:

- **Sucesso** (`DONE`) → a mensagem é apagada do SQS.
- **Erro de NEGÓCIO** (`MediaProcessingException`, ex.: vídeo corrompido/não
  suportado) → o worker notifica a Core API com `{ status: 'ERROR' }`, o
  use-case RESOLVE e a mensagem é apagada (reprocessar daria o mesmo erro).
- **Erro de INFRA** (`ExternalServiceException`: falha de rede/S3/API) → o
  use-case LANÇA, a mensagem NÃO é apagada; o SQS reentrega após o visibility
  timeout e encaminha para a DLQ após as tentativas configuradas.
- **Poison message** (JSON inválido ou fora do contrato) → também não é apagada;
  segue o mesmo caminho de reentrega/DLQ.

### Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Descrição |
| --- | --- |
| `NODE_ENV` | `development` \| `test` \| `production` |
| `PORT` | Porta do endpoint `/health` (default 3001) |
| `AWS_REGION` | Região AWS |
| `AWS_ACCESS_KEY_ID` | Credencial AWS |
| `AWS_SECRET_ACCESS_KEY` | Credencial AWS |
| `AWS_ENDPOINT` | _(opcional)_ Endpoint AWS customizado, ex.: LocalStack (`http://localhost:4566`). Ausente em produção → SDK usa a AWS real. Quando setado, o cliente S3 usa `forcePathStyle`. |
| `SQS_QUEUE_URL` | URL da fila SQS de entrada |
| `S3_BUCKET_NAME` | Bucket S3 (origem dos vídeos e destino dos zips) |
| `API_URL` | Base URL da Core API |
| `INTERNAL_API_TOKEN` | Token enviado no header `x-internal-token` às rotas `internal/*` da Core API. Deve ser idêntico ao do core. |

As variáveis são validadas no boot (fail-fast) via `zod`.

### Integração local com LocalStack + core

Para o ciclo completo local (upload → fila → processamento → zip no S3 → PATCH de
status), o worker aponta para a infra LocalStack provisionada pelo projeto
`hackathon-postech-fiap-core` via rede Docker externa compartilhada. Suba o compose do
**core primeiro** (`postgres`, `redis`, `localstack`, `app`) e depois o worker
(`docker compose up app`). Detalhes e roteiro de validação ponta a ponta
em [`prompts/integracao-localstack-core.md`](prompts/integracao-localstack-core.md).

### Como rodar

```bash
# desenvolvimento (watch)
$ npm run start:dev

# produção (build + node)
$ npm run build && npm run start:prod

# docker (worker)
$ docker compose up app
```

> A imagem Docker de produção instala o `ffmpeg` (dependência de runtime da
> etapa de extração de frames).

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
