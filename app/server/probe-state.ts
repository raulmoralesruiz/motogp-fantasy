/**
 * Estado del health-check de la fuente (T-14, ADR-0036):
 * `ProbeStateStore` (contrato) + implementación en memoria (tests/dev).
 *
 * Lo comparten el worker (escribe cada ciclo) y la web (lo lee en
 * `admin.jobsStatus`): el estado vive en Redis (`mon:source:probe`,
 * `probe-state-redis.ts`), no en memoria de un proceso.
 *
 * Semántica (coherente con `source_state`, ADR-0019):
 * - éxito: `consecutiveFailures = 0`, `lastSuccessAt` actualizado;
 *   **NO limpia `lastError`** (auditoría del último fallo visto);
 * - fallo: `consecutiveFailures + 1`, `lastError` actualizado.
 */
import type { ProbeState } from "@/modules/results";

export interface ProbeAttempt {
  ok: boolean;
  error: string | null;
  latencyMs: number | null;
  at: Date;
}

export interface ProbeStateStore {
  /** Estado actual (null si aún no hubo ninguna sonda). */
  read(): Promise<ProbeState | null>;
  /** Registra una sonda y devuelve el estado resultante. */
  recordAttempt(attempt: ProbeAttempt): Promise<ProbeState>;
}

/**
 * Implementación en memoria (tests, dev local sin Redis): thread-safe
 * para un solo proceso; en producción usa `redisProbeStateStore`.
 */
export class MemoryProbeStateStore implements ProbeStateStore {
  private state: ProbeState | null = null;

  async read(): Promise<ProbeState | null> {
    return this.state ? { ...this.state } : null;
  }

  async recordAttempt(attempt: ProbeAttempt): Promise<ProbeState> {
    const prev = this.state;
    const failures = attempt.ok
      ? 0
      : (prev?.consecutiveFailures ?? 0) + 1;
    this.state = {
      consecutiveFailures: failures,
      lastError: attempt.ok ? prev?.lastError ?? null : attempt.error,
      lastAttemptAt: attempt.at.toISOString(),
      lastSuccessAt: attempt.ok
        ? attempt.at.toISOString()
        : (prev?.lastSuccessAt ?? null),
      lastLatencyMs: attempt.latencyMs,
    };
    return { ...this.state };
  }
}
