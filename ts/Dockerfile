# syntax=docker/dockerfile:1.7
# Build context is the repository root (see docker-compose.yml), so the image can carry the shared
# migrations and the shared contract next to the service.

# ---- build: compile TypeScript ------------------------------------------------------------------------------
FROM node:26-alpine AS build
WORKDIR /app/ts
COPY ts/package.json ts/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY ts/tsconfig.json ts/tsconfig.build.json ./
COPY ts/src ./src
RUN npm run build

# ---- deps: production dependencies only ---------------------------------------------------------------------
FROM node:26-alpine AS deps
WORKDIR /app/ts
COPY ts/package.json ts/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

# ---- runtime ------------------------------------------------------------------------------------------------
FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8082 \
    MIGRATIONS_DIR=/app/db/migrations \
    CONTRACT_PATH=/app/contract/openapi.yaml
WORKDIR /app/ts
COPY --from=deps --chown=node:node /app/ts/node_modules ./node_modules
COPY --from=build --chown=node:node /app/ts/dist ./dist
COPY --chown=node:node ts/package.json ./
COPY --chown=node:node db/migrations /app/db/migrations
COPY --chown=node:node contract/openapi.yaml /app/contract/openapi.yaml
USER node
EXPOSE 8082
# Liveness only: readiness (DB + Redis) is for the orchestrator to decide on, not a reason to restart.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health/live" || exit 1
# node as PID 1 receives SIGTERM directly, which starts the graceful shutdown in main.ts.
CMD ["node", "--enable-source-maps", "dist/main.js"]
