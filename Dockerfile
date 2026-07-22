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
RUN apt-get update -qq && apt-get install -y -qq openssl dnsutils && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app ./

ENV PORT=3000

# Runtime SERVICE env var (not build arg)
RUN echo '#!/bin/sh' > /app/start.sh && \
    echo 'set -e' >> /app/start.sh && \
    echo 'echo "Starting service: ${SERVICE:-unknown}"' >> /app/start.sh && \
    echo 'if [ -n "${REDIS_URL}" ]; then' >> /app/start.sh && \
    echo '  REDIS_HOST=$(echo "${REDIS_URL}" | sed -n "s|.*@\\([^:/]*\\).*|\\1|p")' >> /app/start.sh && \
    echo '  REDIS_PORT=$(echo "${REDIS_URL}" | sed -n "s|.*:\([0-9]*\)$|\\1|p")' >> /app/start.sh && \
    echo '  echo "Redis diagnostics: host=${REDIS_HOST:-?} port=${REDIS_PORT:-6379}"' >> /app/start.sh && \
    echo '  nslookup "${REDIS_HOST}" 2>&1 || true' >> /app/start.sh && \
    echo '  timeout 5 openssl s_client -connect "${REDIS_HOST}:${REDIS_PORT:-6379}" </dev/null 2>&1 | head -5 || echo "openssl connect failed"' >> /app/start.sh && \
    echo 'fi' >> /app/start.sh && \
    echo 'case "${SERVICE:-}" in' >> /app/start.sh && \
    echo '  search-rec) PORT=3001 exec pnpm --filter @search/search-rec-app start ;;' >> /app/start.sh && \
    echo '  ai-gen)     PORT=3002 exec pnpm --filter @ai/ai-gen-app start ;;' >> /app/start.sh && \
    echo '  api)        PORT=3000 exec pnpm --filter @portfolio/api start ;;' >> /app/start.sh && \
    echo '  *)          echo "ERROR: SERVICE env var must be one of: search-rec, ai-gen, api (got: ${SERVICE:-empty})"; exit 1 ;;' >> /app/start.sh && \
    echo 'esac' >> /app/start.sh && \
    chmod +x /app/start.sh

EXPOSE 3000 3001 3002
CMD ["/app/start.sh"]
