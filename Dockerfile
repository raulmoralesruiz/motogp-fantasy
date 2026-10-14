# Fantasy MotoGP Independiente — imagen de producción (T-02, WP4).
# Multi-stage: deps → build → runner (Next.js standalone).
# Base node:24-slim (glibc): el engine de Prisma no soporta alpine/musl.
#
# Build (lo hace deploy.sh):
#   docker build --build-arg NEXT_PUBLIC_APP_URL=https://motogp.raulmorales.eu \
#     -t motogp-web:<sha> -t motogp-web:latest .

# ── 1. Dependencias ─────────────────────────────────────────────────────────
FROM node:24-slim AS deps
WORKDIR /app
# El CLI openssl lo necesita Prisma para detectar la versión del sistema
# (3.x en bookworm); sin él asume openssl-1.1.x y el engine no carga en runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
# prisma/ es necesario aquí: el postinstall (prisma generate) lo necesita.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ── 2. Build ────────────────────────────────────────────────────────────────
FROM node:24-slim AS build
WORKDIR /app
# openssl: mismo motivo que en deps (detección de la versión por Prisma).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* se "hornea" en el bundle del cliente en el build: se pasa
# con --build-arg (deploy.sh lo lee del .env). El resto son valores ficticios:
# el build no conecta con BD/Redis (lo mismo que en CI).
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
  DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
  REDIS_URL="redis://localhost:6379"
RUN npx prisma generate && npm run build

# ── 3. Runner ───────────────────────────────────────────────────────────────
FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# libssl3: el engine de Prisma enlaza dinámicamente contra libssl.so.3;
# node:24-slim no lo incluye (node lleva OpenSSL estático, pero el engine no).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libssl3 \
  && rm -rf /var/lib/apt/lists/*
# .next/standalone trae server.js + el node_modules mínimo de runtime.
# Añadimos el node_modules completo (CLI de Prisma para `migrate deploy`)
# y prisma/ (schema + migraciones).
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node", "server.js"]
