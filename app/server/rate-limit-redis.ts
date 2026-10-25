/**
 * Implementación Redis de `RateLimitStore` (US-01, security.md §1.6).
 *
 * - Ventana fija por IP: contador atómico con TTL (INCR + EXPIRE en un
 *   script Lua para no dejar claves sin TTL si el proceso muere a mitad).
 * - Fallos consecutivos por cuenta: contador sin TTL (se borra con el
 *   login correcto o al bloquear).
 * - Bloqueo de cuenta: clave con TTL.
 *
 * Nombres de clave con prefijo `rl:login:*` (login), `rl:reset:*`
 * (recuperación de contraseña, US-02), `rl:delete:*` (eliminación de
 * cuenta, US-03/ADR-0016), `rl:league:create:*` (creación de ligas, US-23)
 * y `rl:league:join:*` (unión a ligas, US-25); otros endpoints (cambios de
 * lineup, …) usarán su propio prefijo.
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
function resetWindowKey(ip: string): string {
  return `rl:reset:ip:${ip}`;
}
function userDeletionWindowKey(userId: string): string {
  return `rl:delete:user:${userId}`;
}
function leagueCreateWindowKey(userId: string): string {
  return `rl:league:create:user:${userId}`;
}
function leagueJoinWindowKey(ip: string): string {
  return `rl:league:join:ip:${ip}`;
}
function leagueJoinFailuresKey(ip: string): string {
  return `rl:league:join:fail:${ip}`;
}
function leagueJoinLockKey(ip: string): string {
  return `rl:league:join:lock:${ip}`;
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
  async recordResetRequest(ip, windowSec) {
    const count = (await redis.eval(
      WINDOW_SCRIPT,
      1,
      resetWindowKey(ip),
      String(windowSec),
    )) as number;
    const ttl = await redis.ttl(resetWindowKey(ip));
    return { count, remainingSec: Math.max(0, ttl) };
  },
  async recordUserDeletion(userId, windowSec) {
    const count = (await redis.eval(
      WINDOW_SCRIPT,
      1,
      userDeletionWindowKey(userId),
      String(windowSec),
    )) as number;
    const ttl = await redis.ttl(userDeletionWindowKey(userId));
    return { count, remainingSec: Math.max(0, ttl) };
  },
  async recordLeagueCreation(userId, windowSec) {
    const count = (await redis.eval(
      WINDOW_SCRIPT,
      1,
      leagueCreateWindowKey(userId),
      String(windowSec),
    )) as number;
    const ttl = await redis.ttl(leagueCreateWindowKey(userId));
    return { count, remainingSec: Math.max(0, ttl) };
  },
  async recordLeagueJoinAttempt(ip, windowSec) {
    const count = (await redis.eval(
      WINDOW_SCRIPT,
      1,
      leagueJoinWindowKey(ip),
      String(windowSec),
    )) as number;
    const ttl = await redis.ttl(leagueJoinWindowKey(ip));
    return { count, remainingSec: Math.max(0, ttl) };
  },
  async recordLeagueJoinFailure(ip) {
    return redis.incr(leagueJoinFailuresKey(ip));
  },
  async resetLeagueJoinFailures(ip) {
    await redis.del(leagueJoinFailuresKey(ip));
  },
  async lockLeagueJoin(ip, lockoutSec) {
    await redis.set(leagueJoinLockKey(ip), "1", "EX", lockoutSec);
  },
  async leagueJoinLockRemainingSec(ip) {
    const ttl = await redis.ttl(leagueJoinLockKey(ip));
    return Math.max(0, ttl);
  },
};
