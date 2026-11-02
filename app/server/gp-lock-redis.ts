/**
 * Implementación Redis de `GpLockStore` (T-10, ADR-0034): lock por GP para
 * los jobs de background (precios, polling) — un solo job a la vez por GP
 * (AGENTS.md §6, CA de T-10: "2 jobs simultáneos → se serializan, sin
 * duplicados").
 *
 * - `acquire`: `SET key token NX PX ttl` atómico → devuelve el **token de
 *   dueño** si se consigue, `null` si otro job lo mantiene. El token es
 *   aleatorio (CSPRNG) para distinguir a cada dueño.
 * - `release`: script Lua que solo borra la clave si su valor coincide con
 *   el token (un proceso no libera el lock de otro si el suyo expiró por
 *   TTL).
 *
 * Clave con prefijo `job:gp:lock:` (distingue de `rl:*` de rate-limit).
 */
import { randomBytes } from "node:crypto";

import type { GpLockStore } from "@/modules/jobs";

import { redis } from "./redis";

function lockKey(gpId: string): string {
  return `job:gp:lock:${gpId}`;
}

/** Solo borra la clave si su valor coincide con el token del dueño (ARGV[1]). */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function newToken(): string {
  return randomBytes(16).toString("hex");
}

export const redisGpLockStore: GpLockStore = {
  async acquire(gpId, ttlSec) {
    const token = newToken();
    const ms = Math.max(1, Math.round(ttlSec * 1000));
    const ok = await redis.set(lockKey(gpId), token, "PX", ms, "NX");
    return ok === "OK" ? token : null;
  },
  async release(gpId, token) {
    await redis.eval(RELEASE_SCRIPT, 1, lockKey(gpId), token);
  },
};
