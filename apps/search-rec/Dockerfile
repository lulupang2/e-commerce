# apps/search-rec Dockerfile — pnpm 워크스페이스 루트 컨텍스트에서 빌드
# docker build -f apps/search-rec/Dockerfile .
FROM node:22-alpine

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .swcrc ./
COPY packages ./packages
COPY apps/search-rec ./apps/search-rec

RUN pnpm install --frozen-lockfile

EXPOSE 3001
CMD ["pnpm", "--filter", "@search/search-rec-app", "start"]
