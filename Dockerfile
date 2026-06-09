# Stage 1: Base & Dependencies
FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Copiar apenas arquivos de dependências primeiro para cache mais eficiente
COPY package*.json ./

# Stage 2: Build
FROM base AS builder

# Instalar todas as dependências (incluindo dev dependencies para build)
RUN npm ci

# Copiar código fonte e configurações de build
COPY . .

# Build da aplicação
RUN npm run build

# Stage: Test (mantém devDependencies para docker-compose)
FROM builder AS test

ENV NODE_ENV=test

# Stage 3: Production Dependencies
FROM base AS prod-deps

# Instalar apenas dependências de produção
RUN npm ci --only=production && \
    npm cache clean --force

# Stage 4: Production Image
FROM node:20-alpine AS production

WORKDIR /usr/src/app

# Criar usuário não-root para segurança
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copiar apenas o necessário para rodar a aplicação
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/package.json ./package.json

# Garantir permissões corretas
RUN chown -R nestjs:nodejs /usr/src/app

# Mudar para usuário não-root
USER nestjs

# Expor porta da aplicação
EXPOSE 3001

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3001

# Healthcheck - verifica se a aplicação está respondendo
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3001) + '/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)}).on('error', () => process.exit(1))"

# Comando de inicialização
CMD ["node", "dist/main"]
