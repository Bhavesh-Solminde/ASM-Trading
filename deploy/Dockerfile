# One image, two entrypoints.
# Compose picks per service via CMD override:
#   web    -> pnpm --filter @asm/web start
#   engine -> pnpm --filter @asm/engine start

FROM node:22-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: install every workspace's dependencies from the lockfile
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/engine/package.json ./apps/engine/
COPY packages/algo/package.json ./packages/algo/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/pricing/package.json ./packages/pricing/
COPY packages/trading/package.json ./packages/trading/
# `postinstall` in @asm/db runs `prisma generate`, which needs the schema.
COPY packages/db/prisma ./packages/db/prisma
COPY packages/db/prisma.config.ts ./packages/db/prisma.config.ts
RUN pnpm install --frozen-lockfile

# ---- build: copy sources and produce the Next.js production build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
COPY apps/engine ./apps/engine
# Baked into the client bundle. Overridable at build time via compose.
ARG NEXT_PUBLIC_ENGINE_WS_URL="wss://asmtrader.com/ws"
ENV NEXT_PUBLIC_ENGINE_WS_URL=$NEXT_PUBLIC_ENGINE_WS_URL
ARG NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED="false"
ENV NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED=$NEXT_PUBLIC_LIVE_ACCOUNT_ENABLED
# `next build` collects page data by evaluating API-route modules, which
# import @asm/config. That factory zod-validates env at import time, so
# even a build without traffic needs these set. The values here are only
# read during compile; real secrets come from compose env_file at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    DATABASE_MIGRATE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
    REDIS_URL="redis://localhost:6379" \
    SESSION_SECRET="build-only-placeholder-not-used-at-runtime-xxxxxxxx" \
    ADMIN_PANEL_SECRET="build-only-placeholder" \
    SMS_RELAY_SECRET="build-only-placeholder" \
    ENGINE_INTERNAL_SECRET="build-only-placeholder" \
    ENGINE_HTTP_PORT=4002 \
    ENGINE_HTTP_URL="http://engine:4002" \
    ENGINE_WS_PORT=4001 \
    BANK_FEED=simulated
RUN pnpm --filter @asm/web build

# ---- runtime: everything built, non-root user, dumb-init as PID 1
FROM base AS runtime
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app --home /home/app --shell /bin/false app \
 && mkdir -p /home/app && chown app:app /home/app
COPY --from=build --chown=app:app /app /app
USER app
ENTRYPOINT ["dumb-init", "--"]
# Default command; docker-compose overrides per service.
CMD ["pnpm", "--filter", "@asm/web", "start"]
