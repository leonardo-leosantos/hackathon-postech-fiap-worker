# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A NestJS **SQS worker** (no business HTTP API) that processes videos asynchronously.
The only HTTP endpoint is `/health` (liveness/readiness for the orchestrator). Real
work is driven by SQS messages. Note: the README's boilerplate lower half is the
default NestJS starter text; the "Video Worker" section at the top is the source of truth.

## Commands

```bash
npm run start:dev            # dev with watch
npm run build && npm run start:prod   # production (nest build -> node dist/main)
npm run lint                 # eslint --fix over {src,apps,libs,test}
npm run format               # prettier --write

npm test                     # all unit tests (jest, *.spec.ts under src/)
npm test -- process-video    # run a single test file by name fragment
npm run test:watch
npm run test:cov
npm run test:e2e             # jest with test/jest-e2e.json

docker compose up app   # worker
```

Env vars are validated with zod at boot (fail-fast). Copy `.env.example` to `.env`.
Required: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SQS_QUEUE_URL`
(URL), `S3_BUCKET_NAME`, `API_URL` (URL), `INTERNAL_API_TOKEN` (sent as the
`x-internal-token` header to the Core API's `internal/*` routes; must match the core's).
Optional: `PORT` (3001), `NODE_ENV`, `AWS_ENDPOINT` (URL — set it to point S3/SQS at
LocalStack; absent in production so the SDK uses real AWS; the S3 client also enables
`forcePathStyle` whenever it is set).
Schema lives in `src/config/env.schema.ts`.

## Architecture

Hexagonal (ports & adapters). The whole app is one feature module: `VideoProcessingModule`.

- **Domain ports** (`src/modules/video-processing/domain/ports/*`) are interfaces plus a
  `Symbol` DI token each (e.g. `VIDEO_STORAGE`, `FRAME_EXTRACTOR`, `FRAME_ARCHIVER`,
  `CORE_API`, `TEMP_WORKSPACE`; `LOGGER` lives in `src/modules/shared/ports`).
- **Adapters** implement them under `src/infra/*` (S3, ffmpeg via `fluent-ffmpeg`,
  archiver, local filesystem workspace, axios Core API client, Nest logger).
- **Wiring** is in `video-processing.module.ts` — each token is bound to its adapter
  via `{ provide: TOKEN, useClass: Adapter }`. Inject ports with
  `@Inject(TOKEN)` + `import type` for the interface. Add a new capability by defining
  a port (interface + Symbol), writing the adapter, and registering it here.
- **Driving adapter**: `SqsVideoConsumer` (`src/infra/messaging/consumers`) is a Nest
  provider that starts long-polling in `onApplicationBootstrap` and drains in
  `onModuleDestroy` (shutdown hooks enabled in `main.ts`). It delegates each message to
  `ProcessVideoUseCase`.

### The pipeline (`ProcessVideoUseCase.execute`)

download from S3 → extract 1 frame/sec with ffmpeg → zip frames → upload zip to
`zips/<userId>/<videoId>.zip` → PATCH Core API status `DONE`. Temp workspace cleanup
always runs in `finally`.

**Wire contract vs. domain vocabulary.** The worker speaks the core's vocabulary on
the wire and translates in the adapters (hexagonal). The SQS message body uses the
core's field names `{ videoUid, userUid, blobStorageVideoKey }`; `parseSqsVideoMessage`
(`src/adapters/messaging/dtos/sqs-video-message.schema.ts`) validates that shape and
maps it to the internal `ProcessVideoCommand` (`{ videoId, userId, s3VideoKey }`). The
status PATCH sends `{ status, blobStorageZipKey?, errorCode?, errorReason? }` (the adapter
maps the domain's `s3ZipKey` → `blobStorageZipKey` and truncates `errorReason` at 1000
chars) plus the `x-internal-token` header. The domain port `CoreApiPort` and
`ProcessVideoCommand` keep the internal names — only the adapters translate.

**Mirrored-from-core, no shared lib** (change one side and you must change the other):
`VideoErrorCode` (`.../domain/value-objects/video-status.vo.ts`) and the zip key
convention `zips/<userId>/<videoId>.zip` (`.../domain/value-objects/zip-storage-key.ts`,
which the core's DLQ consumer probes to avoid false "failed" emails). Both have
drift-locking specs — if one fails, ask whether the core changed, don't just update the
expectation.

### Error semantics — this is the core design invariant

Whether an SQS message is deleted is decided entirely by whether `execute()` resolves or throws:

- **Success** or **business error** (`MediaProcessingException` — bad input, will never
  succeed on retry) → `execute()` **resolves**; on business error it first notifies Core
  with `{ status: 'ERROR', errorCode, errorReason }`. The consumer **deletes** the message.
  Business covers `CORRUPT_VIDEO` (ffmpeg decode failure), `UNSUPPORTED_FORMAT` (ffmpeg
  produced 0 frames) and `SOURCE_NOT_FOUND` (`NoSuchKey`/`NotFound`/404 on download).
- **Infra error** (`ExternalServiceException` — network/S3/API failure, plus *our* ffmpeg
  failures: missing binary, `ENOSPC`) → `execute()` **throws**; the consumer does **not**
  delete → SQS redelivers after visibility timeout, then DLQ after configured retries. The
  core assigns `INTERNAL_ERROR` from the DLQ — a platform fault never tells the user their
  file is broken.
- **Poison message** (invalid JSON / fails `sqsVideoMessageSchema`) → `parseSqsVideoMessage`
  throws in the consumer → not deleted → same redelivery/DLQ path.

When editing the use-case or consumer, preserve this resolve-vs-throw contract: it is
what maps error kinds to ACK/retry/DLQ behavior. Domain exceptions are in
`src/modules/shared/exceptions/DomainException.ts` (business subclasses) and
`.../domain/exceptions/media-processing.exception.ts`.

## Conventions

- Path alias `src/...` maps to the `src/` root (tsconfig `paths` + jest `moduleNameMapper`).
- Tests are colocated `*.spec.ts` next to the code, run from `rootDir: src`.
- Many `index.ts` files under `src/infra/database/typeorm/*`, `src/adapters/*`, and
  `src/infra/http/{filters,middleware}` are empty `export {}` scaffolding from a shared
  template — this worker has no database. Don't assume DB/controller layers exist.
- Comments and docstrings in the codebase are written in Portuguese; match the
  surrounding language when editing a file.
- FFmpeg is a runtime dependency (installed via `apk add ffmpeg` in the production
  Docker stage), not an npm package.
