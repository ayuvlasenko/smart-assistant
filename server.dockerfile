#syntax:docker/dockerfile:1

FROM node:24-alpine AS base

RUN apk add --no-cache bash

USER node

WORKDIR /base

COPY --chown=node:node .npmrc package*.json ./
COPY --chown=node:node apps/server/package*.json ./apps/server/

RUN npm ci

COPY --chown=node:node apps/server ./apps/server

FROM base AS build

RUN npm run build -w server

FROM node:24-alpine AS app

RUN apk add --no-cache bash

WORKDIR /app

COPY --chown=node:node --from=build /base/package*.json ./
COPY --chown=node:node --from=build /base/apps/server/package*.json ./apps/server/
COPY --chown=node:node --from=build /base/node_modules ./node_modules
COPY --chown=node:node --from=build /base/apps/server/node_modules* ./apps/server/
COPY --chown=node:node --from=build /base/apps/server/migrate-mongo-config.js ./apps/server/migrate-mongo-config.js
COPY --chown=node:node --from=build /base/apps/server/migrations ./apps/server/migrations
COPY --chown=node:node --from=build /base/apps/server/dist ./apps/server/dist
COPY --chown=node:node --from=build /base/apps/server/static ./apps/server/static

CMD ["node", "/app/apps/server/dist/server.js"]
