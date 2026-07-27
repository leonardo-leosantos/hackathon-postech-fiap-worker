# Tratamento de erros — Video Worker

## O papel do worker

O worker **não envia email e não sabe que email existe**. O que ele faz é decidir, para cada falha,
duas coisas:

1. **De quem é a culpa** — do arquivo do usuário ou da nossa plataforma?
2. **Vale tentar de novo?**

Ele reporta essa decisão ao core via `PATCH /internal/videos/:id/status`, e o core cuida do resto
(notificação, deduplicação, auditoria). Classificar errado aqui significa mandar a mensagem errada
para o usuário lá.

---

## A regra que rege tudo: delete-vs-retry

Se a mensagem do SQS é apagada ou não depende de **uma coisa só** — se `execute()` resolve ou lança:

| `ProcessVideoUseCase.execute()` | Mensagem SQS | Quando |
|---|---|---|
| **RESOLVE** | apagada ✅ | Sucesso, **ou** erro de negócio (`MediaProcessingException`) — já notificou `ERROR` ao core, e reprocessar daria o mesmo resultado |
| **LANÇA** | preservada ↻ | Erro de infra (`ExternalServiceException`) — o SQS reentrega e, após 3 tentativas, manda para a DLQ |

⚠️ **É o invariante mais sensível do repo.** Qualquer alteração no `process-video.use-case.ts`
precisa preservá-lo. O `finally` do cleanup do workspace roda sempre, nos dois caminhos.

---

## Os códigos que o worker emite

| Código | Origem no pipeline | Resultado |
|---|---|---|
| `CORRUPT_VIDEO` | ffmpeg falhou ao decodificar | negócio → apaga a mensagem |
| `UNSUPPORTED_FORMAT` | codec/container não suportado, **ou 0 frames extraídos** | negócio → apaga a mensagem |
| `SOURCE_NOT_FOUND` | `NoSuchKey`/`NotFound`/404 no download do S3 | negócio → apaga a mensagem |

**O worker nunca emite `INTERNAL_ERROR` nem `TIMEOUT`.** Esses dois são atribuídos pelo **core**,
justamente nos casos em que o worker não conseguiu reportar nada — porque ele mesmo é quem falhou
(S3 fora, disco cheio, processo morto). O core os detecta consumindo a DLQ ou varrendo vídeos
travados.

---

## O pipeline e o que cada passo pode produzir

```
download (S3) ──► extract frames (ffmpeg) ──► zip ──► upload (S3) ──► PATCH status
     │                     │                   │           │              │
 SOURCE_NOT_FOUND    CORRUPT_VIDEO           infra       infra          infra
 (negócio)           UNSUPPORTED_FORMAT      ↻ DLQ       ↻ DLQ          ↻ DLQ
 infra: ↻ DLQ        (negócio)
                     infra: ↻ DLQ
```

---

## A decisão que evita culpar o usuário

Nem toda falha do ffmpeg é culpa do vídeo. Duas situações são **nossas** e precisam ir para
retry/DLQ, nunca marcar o arquivo como corrompido:

| Sinal | Onde é procurado | Classificação |
|---|---|---|
| `ENOENT`, `EACCES`, `Cannot find ffmpeg`, `spawn ffmpeg` | **só** em `err.message` | infra — binário ausente na imagem |
| `ENOSPC`, `No space left on device` | `err.message` **e** no stderr | infra — disco cheio |
| qualquer outra falha de decode | — | negócio → `CORRUPT_VIDEO` |

Os sinais de spawn são procurados **apenas** em `err.message`, nunca no stderr: o ffmpeg despeja a
linha `configuration:` com todas as flags de build em toda execução, e um falso positivo ali
classificaria **todo vídeo corrompido** como falha nossa.

Dois cuidados na mesma linha:

- **`NoSuchKey` no download é negócio, não infra.** O objeto não existir é permanente — tratar como
  infra gastaria 3 tentativas à toa e deixaria o vídeo travado em `PROCESSING`.
- **0 frames com exit code 0 é falha.** Sem essa verificação o vídeo viraria `DONE` com um zip
  **vazio**, e o usuário baixaria um arquivo inútil achando que deu certo.

O detalhe técnico (cauda do stderr) viaja no campo `errorReason`, truncado em 1000 chars. Ele vai
para auditoria e log no core — **nunca** é mostrado ao usuário.

---

## O que o worker NÃO faz

- ❌ Enviar email ou conhecer o destinatário
- ❌ Consumir a DLQ — isso vive no core, que precisa do banco para marcar `ERROR`
- ❌ Varrer vídeos travados (reaper) — também no core
- ❌ Publicar em SNS — o worker só fala com o core via `PATCH`

---

## Dois contratos espelhados com o core

Não há biblioteca compartilhada entre os repos. Estes dois precisam ser alterados **nos dois lados,
no mesmo deploy**:

| O quê | Aqui | No core |
|---|---|---|
| `VideoErrorCode` | `domain/value-objects/video-status.vo.ts` | `modules/videos/domain/video-error-code.enum.ts` |
| Chave do zip `zips/<userId>/<videoId>.zip` | `domain/value-objects/zip-storage-key.ts` | `modules/videos/videos.constants.ts` |

⚠️ A chave do zip é o acoplamento mais perigoso: o core a usa para checar no S3 se o vídeo
**realmente** falhou antes de marcar `ERROR`. Se as convenções divergirem, **nada quebra em teste** —
a verificação simplesmente para de achar o zip, e o sistema volta a mandar email de erro para vídeo
que processou com sucesso. Cada lado tem um teste que trava a string exata.

---

## Visão completa

Este documento cobre só a parte do worker. A arquitetura inteira — as 12 falhas mapeadas, as 6
linhas de defesa (deduplicação no Redis, guarda anti-falso-positivo, reaper) e o texto exato de cada
email — está documentada no repositório do core:

> 📖 **Documentação completa:** `<COLE AQUI O LINK DO GITHUB>`
>
> <sub>Sugestão de URL, confirme a branch antes de colar:</sub>
> <sub>`https://github.com/leonardo-leosantos/hackathon-postech-fiap-core/blob/master/docs/tratamento-de-erros-e-notificacao.md`</sub>
