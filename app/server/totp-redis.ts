/**
 * Implementación Redis de `TotpChallengeStore` (D-07, ADR-0039).
 *
 * - Reto: clave `totp:challenge:<token>` → userId, con TTL (`SET ... EX`).
 *   El token es opaco (256 bits): solo su valor identifica el reto.
 * - Fallos: clave `totp:fail:<token>` (INCR), con el mismo TTL que el reto
 *   (si el reto ya expiró, el contador se limpia: no debe quedar órfano).
 *
 * Nomenclatura de claves: prefijo `totp:*` (independiente de `rl:*` del
 * rate limiting, que alimenta además el bloqueo por cuenta).
 */
import type { TotpChallengeStore } from "@/modules/identity";
import { generateTotpChallengeToken } from "@/modules/identity";

import { redis } from "./redis";

function challengeKey(token: string): string {
  return `totp:challenge:${token}`;
}
function failuresKey(token: string): string {
  return `totp:fail:${token}`;
}

export const redisTotpChallengeStore: TotpChallengeStore = {
  async issue(userId, ttlSec) {
    const token = generateTotpChallengeToken();
    await redis.set(challengeKey(token), userId, "EX", ttlSec);
    return token;
  },
  async resolve(token) {
    return redis.get(challengeKey(token));
  },
  async failureCount(token) {
    const value = await redis.get(failuresKey(token));
    return value ? Number(value) : 0;
  },
  async recordFailure(token) {
    const count = await redis.incr(failuresKey(token));
    const ttl = await redis.ttl(challengeKey(token));
    if (ttl > 0) {
      if (count === 1) await redis.expire(failuresKey(token), ttl);
    } else {
      // El reto ya no existe: no dejar el contador órfano (sin TTL).
      await redis.del(failuresKey(token));
    }
    return count;
  },
  async consume(token) {
    await redis.del(challengeKey(token), failuresKey(token));
  },
};
