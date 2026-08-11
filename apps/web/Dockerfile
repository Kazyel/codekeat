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

ARG NEXT_PUBLIC_APP_NAME=Codekeat
ARG NEXT_PUBLIC_API_URL=http://localhost:3001

ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY . .

RUN pnpm turbo run build --filter=@codekeat/web...

FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/server ./apps/web/.next/server
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node

EXPOSE 3000

WORKDIR /app/apps/web

CMD ["node", "server.js"]
