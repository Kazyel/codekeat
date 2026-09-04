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

RUN pnpm turbo run build --filter=@codekeat/web...
RUN pnpm --filter @codekeat/web deploy --prod /app/deploy


FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV NODE_ENV=production
ENV PORT=3501
ENV HOST=0.0.0.0

WORKDIR /app

COPY --from=builder --chown=node:node /app/deploy ./
COPY --from=builder --chown=node:node /app/apps/web/dist ./dist

USER node

EXPOSE 3501

CMD ["node", "--env-file-if-exists=.env", "node_modules/srvx/bin/srvx.mjs", "--prod", "-s", "../client", "dist/server/server.js"]
