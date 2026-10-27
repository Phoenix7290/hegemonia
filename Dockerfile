FROM node:24-bookworm-slim AS builder
RUN npm install -g pnpm@10

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/maps/package.json ./packages/maps/
COPY packages/engine/package.json ./packages/engine/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm test
RUN pnpm --filter @hegemonia/web build && pnpm --filter @hegemonia/server build

# Run stage
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=2567
ENV HOST=::
ENV PUBLIC_DIR=/app/apps/web/dist

COPY --from=builder /app /app

USER 1000:1000
EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:2567/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["sh", "-c", "npx tsx apps/server/src/migrate.ts && exec npx tsx apps/server/src/index.ts"]
