#syntax:docker/dockerfile:1

FROM node:26-alpine AS base

RUN apk add --no-cache bash

WORKDIR /base

COPY .npmrc package.json ./

RUN npm install -g "$(node -p 'require("./package.json").packageManager')" \
    && chown node:node /base

USER node

COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/server/package.json ./apps/server/

RUN pnpm install --frozen-lockfile

COPY --chown=node:node apps/server ./apps/server

FROM base AS build

RUN pnpm --filter server build \
    && pnpm --filter server deploy --prod /base/deploy

FROM node:26-alpine AS app

RUN apk add --no-cache bash

USER node

WORKDIR /app

COPY --chown=node:node --from=build /base/deploy ./

CMD ["node", "/app/dist/server.js"]
