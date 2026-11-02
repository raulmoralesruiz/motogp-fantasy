/**
 * Implementación Redis de `ProbeStateStore` (T-14, ADR-0036): el estado
 * del health-check de la fuente vive en la clave `mon:source:probe`
 * (JSON), compartido por el worker (escribe cada ciclo) y la web (lo lee
 * en `admin.jobsStatus`).
 *
 * Escritura GET→SET (no atómica): tolerable — hay un único escritor real
 * (el worker, un proceso; `concurrency: 1`) y la web solo lee. La pérdida
 * de consistencia en un hipotético cruce no afecta a datos de juego.
 *
 * Tests: se mockea `../redis` (mismo patrón que `rate-limit-redis.test.ts`).
 */
import { redis } from "./redis";

import type { ProbeState } from "@/modules/results";
import type { ProbeStateStore } from "./probe-state";

export const PROBE_STATE_KEY = "mon:source:probe";

/** Parseo defensivo (JSON corrupto ⇒ estado ausente, nunca lanza). */
function parseState(raw: string | null): ProbeState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ProbeState;
    if (typeof value.consecutiveFailures !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

export const redisProbeStateStore: ProbeStateStore = {
  async read() {
    const raw = await redis.get(PROBE_STATE_KEY);
    return parseState(raw);
  },
  async recordAttempt(attempt) {
    const raw = await redis.get(PROBE_STATE_KEY);
    const prev = parseState(raw);
    const failures = attempt.ok ? 0 : (prev?.consecutiveFailures ?? 0) + 1;
    const next: ProbeState = {
      consecutiveFailures: failures,
      lastError: attempt.ok ? prev?.lastError ?? null : attempt.error,
      lastAttemptAt: attempt.at.toISOString(),
      lastSuccessAt: attempt.ok
        ? attempt.at.toISOString()
        : (prev?.lastSuccessAt ?? null),
      lastLatencyMs: attempt.latencyMs,
    };
    await redis.set(PROBE_STATE_KEY, JSON.stringify(next));
    return next;
  },
};
