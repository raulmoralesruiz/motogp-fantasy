/**
 * T-10 (ADR-0034): lock por GP (Redis) + concurrencia.
 *
 * CA: "un solo recálculo a la vez por GP (advisory lock, test de
 * concurrencia: 2 jobs simultáneos → se serializan, sin duplicados)".
 *
 * Se prueba contra un Redis real (Testcontainers, global-setup) usando
 * `redisGpLockStore` (la implementación de producción) + un `PriceService`
 * falso con una "puerta" (gate) para garantizar que los dos jobs compitan por
 * el lock a la vez. El `PriceService` real no se usa (no hace falta la BD para
 * verificar la semántica del lock).
 */
import { describe, expect, it, vi } from "vitest";

import type { ApplyFormulaForGpResult, PriceService } from "../../app/modules/market";

import { integrationRedisUrl } from "./helpers";

// El singleton `redis` lee REDIS_URL al crearse: se fija ANTES de importar
// `gp-lock-redis` (que importa `@/server/redis`).
const redisUrl = integrationRedisUrl();
process.env.REDIS_URL = redisUrl ?? "redis://localhost:6379/0";
process.env.DATABASE_URL ??= "postgresql://x:x@localhost:5432/x?schema=public";

const { applyPricesForGp } = await import("../../app/modules/jobs");
const { redisGpLockStore } = await import("../../app/server/gp-lock-redis");

const GP = "gp-concurrencia";
const skipNoRedis = redisUrl === null;

/** PriceService falso: `applyFormulaForGp` con puerta (resolve manual). */
function makeGatedPriceService() {
  let resolveGate: (() => void) | undefined;
  const gate = new Promise<void>((r) => (resolveGate = r));
  const apply = vi.fn(async (): Promise<ApplyFormulaForGpResult> => {
    await gate;
    return {
      targetGpId: null,
      targetGpRound: null,
      created: 1,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 0,
      skippedLocked: false,
      changes: [],
    };
  });
  const service = { applyFormulaForGp: apply } as unknown as PriceService;
  return { service, apply, releaseGate: () => resolveGate?.() };
}

describe("T-10 · lock por GP (Redis) + concurrencia", () => {
  describe.skipIf(skipNoRedis)("redisGpLockStore (semántica con token)", () => {
    it("acquire devuelve un token; una segunda acquire devuelve null (ocupado)", async () => {
      const t1 = await redisGpLockStore.acquire(GP, 120);
      expect(t1).not.toBeNull();
      const t2 = await redisGpLockStore.acquire(GP, 120);
      expect(t2).toBeNull();
      await redisGpLockStore.release(GP, t1!);
    });

    it("release con el token del dueño libera el lock", async () => {
      const t1 = await redisGpLockStore.acquire(GP, 120);
      await redisGpLockStore.release(GP, t1!);
      const t2 = await redisGpLockStore.acquire(GP, 120);
      expect(t2).not.toBeNull();
      await redisGpLockStore.release(GP, t2!);
    });

    it("release con token equivocado NO libera el lock de otro", async () => {
      const t1 = await redisGpLockStore.acquire(GP, 120);
      await redisGpLockStore.release(GP, "token-equivocado");
      const t2 = await redisGpLockStore.acquire(GP, 120);
      expect(t2).toBeNull(); // sigue ocupado: el release equivocado no lo tocó
      await redisGpLockStore.release(GP, t1!);
    });
  });

  it.skipIf(skipNoRedis)(
    "2 jobs simultáneos → se serializan, sin duplicados (CA de T-10)",
    async () => {
      const { service, apply, releaseGate } = makeGatedPriceService();
      const deps = { priceService: service, lockStore: redisGpLockStore };

      // Job A: adquiene el lock y su apply queda pendiente en la puerta.
      const aPromise = applyPricesForGp(GP, deps);
      // Da tiempo a A a adquirir el lock (el apply sigue en la puerta).
      await new Promise((r) => setTimeout(r, 50));

      // Job B: intenta adquirir mientras A lo mantiene → ocupado.
      const b = await applyPricesForGp(GP, deps);
      expect(b.applied).toBe(false);
      expect(b.locked).toBe(true);
      expect(apply).toHaveBeenCalledTimes(1); // A lo empezó; B no

      // Suelta la puerta: A termina y libera el lock.
      releaseGate();
      const a = await aPromise;
      expect(a.applied).toBe(true);
      expect(a.locked).toBe(false);

      // Sin duplicados: la fórmula se aplicó UNA vez.
      expect(apply).toHaveBeenCalledTimes(1);
    },
  );
});
