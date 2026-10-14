/**
 * Conexión Redis (singleton) — health-check ahora, BullMQ en fases posteriores.
 * En dev, se guarda en globalThis para sobrevivir al hot-reload de Next.js.
 */
import { Redis } from "ioredis";

import { getServerEnv } from "./env";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis: Redis =
  globalForRedis.redis ??
  new Redis(getServerEnv().REDIS_URL, {
    maxRetriesPerRequest: null, // requerido por BullMQ
    lazyConnect: true, // no conectar hasta el primer uso
  });

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
