# Multi-service Dockerfile — pnpm monorepo
# Usage: docker build --build-arg SERVICE=search-rec -t search-rec .
ARG NODE_VERSION=22

# ── Build stage ────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS build
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps ./apps

RUN pnpm i --frozen-lockfile

# ── Run stage ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app
COPY --from=build /app ./

ENV PORT=3000

# Runtime SERVICE env var (not build arg) — Railway service variables
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'set -e' >> /app/start.sh && \
    echo 'echo "Starting service: ${SERVICE:-unknown}"' >> /app/start.sh && \
    echo 'case "${SERVICE:-}" in' >> /app/start.sh && \
    echo '  search-rec) PORT=3001 exec pnpm --filter @search/search-rec-app start ;;' >> /app/start.sh && \
    echo '  ai-gen)     PORT=3002 exec pnpm --filter @ai/ai-gen-app start ;;' >> /app/start.sh && \
    echo '  api)        PORT=3000 exec pnpm --filter @portfolio/api start ;;' >> /app/start.sh && \
    echo '  *)          echo "ERROR: SERVICE env var must be one of: search-rec, ai-gen, api (got: ${SERVICE:-empty})"; exit 1 ;;' >> /app/start.sh && \
    echo 'esac' >> /app/start.sh && \
    chmod +x /app/start.sh

EXPOSE 3000 3001 3002
CMD ["/app/start.sh"]
