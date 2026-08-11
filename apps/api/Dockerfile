# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.14.1

FROM node:${NODE_VERSION}-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS builder

COPY . .

RUN pnpm turbo run build --filter=@codekeat/api...
RUN pnpm --filter=@codekeat/api deploy --prod /opt/codekeat-api

FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/app/data/codekeat.db

WORKDIR /app

RUN mkdir -p /app/data && chown -R node:node /app

COPY --from=builder --chown=node:node /opt/codekeat-api ./

USER node

EXPOSE 3001

CMD ["node", "dist/index.js"]
