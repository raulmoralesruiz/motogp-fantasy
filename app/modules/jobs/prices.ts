/**
 * Job de precios por GP (US-08): tras un GP definitivo, aplica la fórmula
 * de precios v1 (`pricing-v1`) y registra cada movimiento (motivo `formula`).
 *
 * Orquesta el módulo `market` (`PriceService.applyFormulaForGp`); nunca al
 * revés (dirección de dependencias: `jobs/` orquesta módulos).
 *
 * Lock por GP: un solo job de precios a la vez por GP (mismo patrón que el
 * recálculo, AGENTS.md §6). El lock se inyecta (`GpLockStore`); la
 * implementación de producción (Redis) vive en `app/server/gp-lock-redis.ts`
 * (T-10, ADR-0034) y el disparo automático (cola BullMQ) en `worker/`. El
 * panel admin (`market.prices.applyFormula`) sigue disparando la fórmula
 * directamente para un GP (fallback manual).
 */
import type { ApplyFormulaForGpResult, PriceService } from "@/modules/market";

/**
 * Lock por GP (inyectado): evita dos jobs de precios concurrentes para el
 * mismo GP.
 *
 * Semántica con token (segura en multi-proceso):
 * - `acquire` devuelve el **token de dueño** si consigue el lock, o `null` si
 *   otro job lo mantiene.
 * - `release` solo libera si el token coincide con el dueño actual (un
 *   proceso no libera el lock de otro si el suyo expiró por TTL).
 */
export interface GpLockStore {
  acquire(gpId: string, ttlSec: number): Promise<string | null>;
  release(gpId: string, token: string): Promise<void>;
}

export interface PriceJobDeps {
  priceService: PriceService;
  lockStore: GpLockStore;
}

export interface PriceJobResult {
  /** La fórmula se aplicó (el job hizo su trabajo). */
  applied: boolean;
  /** `true` si el lock estaba ocupado (el job se saltó; la cola reintentará). */
  locked: boolean;
  /** Resultado del servicio (solo cuando `applied`). */
  result?: ApplyFormulaForGpResult;
}

/** TTL del lock: sobra para la transacción; si el proceso muere, expira solo. */
export const PRICE_JOB_LOCK_TTL_SEC = 120;

/**
 * Job de precios de un GP (US-08).
 *
 * 1. Adquiere el lock por GP; si está ocupado, se salta (`locked: true`).
 * 2. Ejecuta `PriceService.applyFormulaForGp` (gate de lockout del GP
 *    objetivo dentro de la transacción; idempotente).
 * 3. Libera el lock siempre (incluso si el servicio lanza), con su token.
 */
export async function applyPricesForGp(
  gpId: string,
  deps: PriceJobDeps,
): Promise<PriceJobResult> {
  const token = await deps.lockStore.acquire(gpId, PRICE_JOB_LOCK_TTL_SEC);
  if (token === null) {
    return { applied: false, locked: true };
  }
  try {
    const result = await deps.priceService.applyFormulaForGp({ gpId });
    return { applied: true, locked: false, result };
  } finally {
    await deps.lockStore.release(gpId, token);
  }
}
