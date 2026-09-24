FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Workspace manifests are enough for npm to link workspaces before the
# source is copied in — keeps this layer cached across source-only changes.
COPY package.json package-lock.json* ./
COPY apps/web/package.json ./apps/web/
COPY packages/schemas/package.json ./packages/schemas/
COPY packages/db/package.json ./packages/db/
COPY packages/domain/package.json ./packages/domain/
COPY packages/services/package.json ./packages/services/
COPY packages/actions/package.json ./packages/actions/
COPY packages/ui/package.json ./packages/ui/
RUN npm ci --legacy-peer-deps

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p uploads

ARG DATABASE_URL="mongodb://localhost:27017/tbook-admin"
ARG AUTH_SECRET="placeholder"
ARG NEXTAUTH_URL="https://placeholder.example.com"
ARG AUTH_TRUST_HOST="true"

ENV DATABASE_URL=$DATABASE_URL
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_URL=$NEXTAUTH_URL
ENV AUTH_TRUST_HOST=$AUTH_TRUST_HOST

RUN npm run build --workspace=apps/web

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
RUN mkdir -p uploads && chown nextjs:nodejs uploads

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Standalone output preserves the monorepo layout (outputFileTracingRoot = repo root).
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Static assets read via fs at runtime (not import'd, so Next's output-file-tracing
# won't reliably pick them up) — copy explicitly. Currently: the voucher PDF
# renderer's vendored Unicode font.
COPY --from=builder --chown=nextjs:nodejs /app/packages/services/assets ./packages/services/assets

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
