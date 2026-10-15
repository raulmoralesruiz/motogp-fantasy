/**
 * Implementación Redis de `RateLimitStore` (US-01, security.md §1.6).
 *
 * - Ventana fija por IP: contador atómico con TTL (INCR + EXPIRE en un
 *   script Lua para no dejar claves sin TTL si el proceso muere a mitad).
 * - Fallos consecutivos por cuenta: contador sin TTL (se borra con el
 *   login correcto o al bloquear).
 * - Bloqueo de cuenta: clave con TTL.
 *
 * Nombres de clave con prefijo `rl:login:*`; otros endpoints (unión por
 * código de liga, cambios de lineup, …) usarán su propio prefijo.
 */
import type { RateLimitStore } from "@/modules/identity";

import { redis } from "./redis";

/** Ventana fija atómica: INCR + EXPIRE solo en el primer hit. */
const WINDOW_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

function windowKey(ip: string): string {
  return `rl:login:ip:${ip}`;
}
function failuresKey(account: string): string {
  return `rl:login:fail:${account}`;
}
function lockKey(account: string): string {
  return `rl:login:lock:${account}`;
}

export const redisRateLimitStore: RateLimitStore = {
  async recordAttempt(ip, windowSec) {
    const count = (await redis.eval(
      WINDOW_SCRIPT,
      1,
      windowKey(ip),
      String(windowSec),
    )) as number;
    const ttl = await redis.ttl(windowKey(ip));
    return { count, remainingSec: Math.max(0, ttl) };
  },
  async recordFailure(account) {
    return redis.incr(failuresKey(account));
  },
  async resetFailures(account) {
    await redis.del(failuresKey(account));
  },
  async lockAccount(account, lockoutSec) {
    await redis.set(lockKey(account), "1", "EX", lockoutSec);
  },
  async lockRemainingSec(account) {
    const ttl = await redis.ttl(lockKey(account));
    return Math.max(0, ttl);
  },
};
