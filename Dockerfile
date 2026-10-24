# One Dockerfile for the monorepo, one target per service (api, mock-banks). The build context
# is the repository root anyway: one lockfile, and @simulador/shared is TypeScript source.

# Same Node as local development. Debian slim (glibc), not Alpine (musl): better-sqlite3 and
# Prisma's schema engine are native binaries, prebuilt for glibc.
ARG NODE_VERSION=24.14.1

FROM node:${NODE_VERSION}-trixie-slim AS base
# Prisma's schema engine (migrate deploy) needs libssl, which slim images do not ship.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# No telemetry call from the Prisma CLI, neither in the build nor at boot.
ENV CHECKPOINT_DISABLE=1
WORKDIR /app

# Manifests first: the npm ci layers below are reused until a dependency or the Prisma schema
# changes. npm needs every workspace manifest to check the lockfile, even to install just one.
FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/mock-banks/package.json apps/mock-banks/
COPY apps/web/package.json apps/web/
# The API's postinstall runs prisma generate, which reads the schema and its config.
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma/

FROM manifests AS deps
RUN npm ci

# The mock banks stand for another company's services (they do not even import the shared
# package): their image gets their own production dependencies only, not the monorepo's.
# No install scripts: they have no native dependency, and this skips the API's postinstall.
FROM manifests AS mock-banks-deps
RUN npm ci --omit=dev --workspace @simulador/mock-banks --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build -w @simulador/api -w @simulador/mock-banks \
  && npm prune --omit=dev

# --- API: migrations at boot, then the server -------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
# Read-only for the app user (files stay owned by root).
COPY --from=build /app/node_modules node_modules/
COPY --from=build /app/apps/api/node_modules apps/api/node_modules/
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma.config.ts apps/api/
COPY --from=build /app/apps/api/prisma apps/api/prisma/
COPY --from=build /app/apps/api/dist apps/api/dist/
# The only place the app writes. A named volume mounted here starts with this owner.
RUN mkdir /data && chown node:node /data
USER node
WORKDIR /app/apps/api
ENV PATH=/app/apps/api/node_modules/.bin:/app/node_modules/.bin:$PATH \
  HOST=0.0.0.0 \
  PORT=3000 \
  DATABASE_URL=file:/data/simulador.db
EXPOSE 3000
# exec: node replaces the shell as PID 1, so docker's SIGTERM reaches the two-phase shutdown.
# Without it the shell gets the signal, ignores it, and docker kills everything 10 s later.
CMD ["sh", "-c", "prisma migrate deploy && exec node dist/main.js"]

# --- Mock banks: three servers in one process (ports 4001-4003) -------------------------------
FROM node:${NODE_VERSION}-trixie-slim AS mock-banks
ENV NODE_ENV=production
WORKDIR /app
COPY --from=mock-banks-deps /app/node_modules node_modules/
COPY --from=build /app/apps/mock-banks/package.json apps/mock-banks/
COPY --from=build /app/apps/mock-banks/dist apps/mock-banks/dist/
USER node
WORKDIR /app/apps/mock-banks
ENV MOCK_BANKS_HOST=0.0.0.0
EXPOSE 4001 4002 4003
CMD ["node", "dist/main.js"]
