# Responsabilidades — Video Worker

> **O operário.** Executa o trabalho pesado. Não atende cliente, não decide política.

| | |
|---|---|
| **Perfil de carga** | Pesado. Consome CPU e RAM; a execução pode levar minutos |
| **Escala por** | Profundidade da fila SQS — não por número de requisições |
| **Nunca** | Recebe requisição de usuário, acessa banco de dados ou envia e-mail |

---

## 1. Responsabilidades

Escutar a fila do SQS e, para cada mensagem:

1. **Baixar** o vídeo do S3
2. Rodar o **FFmpeg** para extrair os frames (1 por segundo)
3. **Compactar** tudo em um `.zip`
4. **Subir** o resultado para o S3
5. **Reportar** o desfecho à Core API

### Fronteira: o Worker não é dono de nenhum dado

PostgreSQL, Redis e o tópico SNS pertencem **exclusivamente à Core API**. O Worker não tem
credencial de banco, não conhece o Redis e não publica em SNS.

Ele fala com o mundo por exatamente três canais: **lê do SQS**, **lê e escreve no S3**, e **chama a
Core API por HTTP**. Nada além disso.

---

## 2. Comunicação com a Core API

Como o banco e o cache pertencem à Core API, ela é a única **fonte da verdade** para o status dos
vídeos. Ao terminar — com sucesso ou falha — o Worker precisa notificá-la:

1. O Worker extrai os frames e sobe o `.zip` para o S3
2. Faz `PATCH /internal/videos/{id}/status` informando *"terminei, o zip está aqui"*
3. A Core API atualiza o PostgreSQL e limpa o cache da listagem no Redis
4. A API responde `200 OK`
5. **Só então** o Worker remove a mensagem do SQS

A ordem do passo 5 é a garantia de entrega: se o Worker morrer entre o passo 1 e o 4, a mensagem
volta para a fila e outro Worker refaz o trabalho.

A rota `/internal` é protegida por um **Internal Token** no header `x-internal-token` — e, em
produção na AWS, também por Security Group restringindo a origem à sub-rede do Worker.

---

## 3. Ciclo de vida da mensagem (Visibility Timeout)

Quando o Worker puxa uma mensagem, o SQS **não a apaga** — apenas a esconde dos outros Workers por
um tempo, o *Visibility Timeout*.

> **Regra de arquitetura:** o Visibility Timeout precisa ser **maior que o tempo máximo de
> processamento**. Com vídeos limitados a 5 min e extração levando no máximo ~2 min, a fila está
> configurada em **300s (5 min)**.

Se o contêiner morrer do nada — *OOM Kill*, falha de hardware da AWS — a mensagem reaparece na fila
e outro Worker tenta de novo. É o que sustenta a política de **zero perda de requisições**.

⚠️ Se o timeout for **menor** que o processamento, o SQS reentrega uma mensagem que ainda está sendo
processada: dois Workers no mesmo vídeo. A Core API tem defesas contra isso, mas o dimensionamento
correto aqui é a primeira linha.

---

## 4. Disco efêmero

Processamento de mídia não é *stream* contínuo: o FFmpeg exige leitura aleatória do arquivo para
pular de frame em frame. Por isso o Worker baixa o `.mp4` para o **disco temporário do contêiner**.

- O Fargate oferece **20 GB de disco efêmero** sem custo adicional
- Com vídeos limitados a **50 MB**, a folga é enorme
- Cada job usa caminhos próprios em `/tmp`: `videos/`, `frames/<videoId>/`, `zips/`

**A limpeza roda sempre**, num `finally` — em sucesso e em erro. Sem isso, um Worker de vida longa
acumularia arquivos até estourar o disco.

O workspace também é **limpo na criação**: se um job anterior do mesmo vídeo morreu no meio (OOM),
os arquivos que sobraram são removidos antes de começar. Caso contrário, frames obsoletos poderiam
ser empacotados como se fossem novos.

---

## 5. Falhas: a decisão que o Worker toma

Para cada erro, o Worker responde a **uma pergunta**: *é culpa do arquivo ou da nossa
infraestrutura?* A resposta determina se a mensagem é apagada ou reprocessada.

### Erro de negócio — o arquivo é ruim

Vídeo corrompido, formato não suportado, ou o objeto nem existe no S3. Tentar de novo daria
exatamente o mesmo resultado.

1. O Worker captura a exceção e a **classifica** com um código (`CORRUPT_VIDEO`,
   `UNSUPPORTED_FORMAT`, `SOURCE_NOT_FOUND`)
2. Chama o `PATCH` da Core API com `status: ERROR` + o código + o motivo técnico
3. **Apaga a mensagem do SQS** — *ack* positivo mesmo em erro de negócio

⚠️ **O Worker não escreve no banco nem publica em SNS.** Quem grava o `ERROR` no PostgreSQL, publica
o evento e dispara o e-mail é a **Core API**, a partir do `PATCH`. O Worker só classifica e reporta.

### Erro de infraestrutura — a culpa é nossa

S3 fora do ar, banco indisponível, disco cheio, binário do FFmpeg ausente na imagem.

1. O Worker **não** apaga a mensagem
2. Após o Visibility Timeout, ela volta para a fila
3. Depois de **3 tentativas** (`maxReceiveCount = 3`), o SQS a move para a **DLQ**

> **Cuidado que vale destacar:** nem toda falha do FFmpeg é culpa do vídeo. "Binário ausente" e
> "disco cheio" são falhas **nossas** e vão para retry/DLQ — jamais dizem ao usuário que o arquivo
> dele está corrompido.

---

## 6. Dead Letter Queue

A DLQ **não é um cemitério**. Na nossa arquitetura ela é **consumida pela Core API**, que marca o
vídeo como `ERROR` e notifica o usuário com uma mensagem genérica de indisponibilidade — porque a
falha foi nossa, não dele.

Isso fecha o buraco clássico: sem esse consumidor, um vídeo que falhasse por erro de infraestrutura
ficaria em `PROCESSING` para sempre, sem status e sem aviso.

Complementarmente, dá para plugar um **alarme do CloudWatch** na profundidade da DLQ, notificando a
equipe de engenharia via SNS. São coisas diferentes e ambas úteis: o consumidor avisa **o usuário**;
o alarme avisa **quem conserta**.

---

## 7. O que o Worker **não** faz

| Não faz | Quem faz |
|---|---|
| Expor endpoint para o usuário | Core API |
| Autenticar usuários | Lambda de auth + Core API |
| Acessar PostgreSQL ou Redis | Core API (dona exclusiva) |
| Publicar em SNS | Core API |
| Enviar e-mail ou saber o destinatário | Core API |
| Consumir a DLQ | Core API |

O Worker recebe um `videoId`, um `userId` e uma chave do S3. Ele não sabe quem é o usuário, e não
precisa saber.

---

## 8. Contrapartida no Core

A outra metade desta arquitetura — endpoints, autenticação, cache, deduplicação de notificação e os
processos que detectam falhas que o Worker não conseguiu reportar — está documentada no repositório
da Core API:

> 🎼 **Responsabilidades do Core:** `https://github.com/leonardo-leosantos/hackathon-postech-fiap-core/blob/master/docs/responsabilidades-core.md`

---

## Documentos relacionados

- [Tratamento de erros](./tratamento-de-erros.md) — a classificação de falhas em detalhe
