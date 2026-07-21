# apps/ai-gen Dockerfile — pnpm 워크스페이스 루트 컨텍스트에서 빌드
# docker build -f apps/ai-gen/Dockerfile .
FROM node:22-alpine

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json .swcrc ./
COPY packages ./packages
COPY apps/ai-gen ./apps/ai-gen

RUN pnpm install --frozen-lockfile

EXPOSE 3002
CMD ["pnpm", "--filter", "@ai/ai-gen-app", "start"]
