/**
 * Tests unit del job de precios por GP (US-08).
 *
 * `applyPricesForGp` se prueba con dependencias falsas (lock store +
 * PriceService) para cubrir la orquestación: lock → aplicar → liberar,
 * lock ocupado → saltar, error → liberar + re-lanzar.
 */
import { describe, expect, it, vi } from "vitest";

import {
  applyPricesForGp,
  PRICE_JOB_LOCK_TTL_SEC,
  type GpLockStore,
  type PriceJobDeps,
} from "../prices";
import type { ApplyFormulaForGpResult, PriceService } from "@/modules/market";

/** Falso lock store: registra acquire/release y permite forzar ocupado. */
function makeFakeLockStore(options?: { occupied?: boolean }): {
  store: GpLockStore;
  acquired: string[];
  released: Array<{ gpId: string; token: string }>;
  ttlSeen: number[];
} {
  const acquired: string[] = [];
  const released: Array<{ gpId: string; token: string }> = [];
  const ttlSeen: number[] = [];
  let tokenCounter = 0;
  const store: GpLockStore = {
    async acquire(gpId, ttlSec) {
      ttlSeen.push(ttlSec);
      if (options?.occupied) return null;
      acquired.push(gpId);
      tokenCounter += 1;
      return `token-${tokenCounter}`;
    },
    async release(gpId, token) {
      released.push({ gpId, token });
    },
  };
  return { store, acquired, released, ttlSeen };
}

/** Falso PriceService: solo `applyFormulaForGp`. */
function makeFakePriceService(
  result?: Partial<ApplyFormulaForGpResult>,
): { service: PriceService; apply: ReturnType<typeof vi.fn> } {
  const apply = vi.fn(async () => ({
    targetGpId: "gp-2",
    targetGpRound: 2,
    created: 1,
    updated: 0,
    unchanged: 0,
    skippedNoOpening: 0,
    skippedLocked: false,
    changes: [],
    ...result,
  }));
  const service = { applyFormulaForGp: apply } as unknown as PriceService;
  return { service, apply };
}

const GP = "gp-1";

describe("applyPricesForGp (US-08 job de precios)", () => {
  it("adquiere el lock, aplica la fórmula y libera el lock", async () => {
    const lock = makeFakeLockStore();
    const { service, apply } = makeFakePriceService();
    const deps: PriceJobDeps = { priceService: service, lockStore: lock.store };

    const out = await applyPricesForGp(GP, deps);

    expect(out.applied).toBe(true);
    expect(out.locked).toBe(false);
    expect(out.result).toBeDefined();
    expect(lock.acquired).toEqual([GP]);
    expect(lock.ttlSeen).toEqual([PRICE_JOB_LOCK_TTL_SEC]);
    expect(lock.released).toEqual([{ gpId: GP, token: "token-1" }]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ gpId: GP });
  });

  it("devuelve el resultado del servicio tal cual", async () => {
    const lock = makeFakeLockStore();
    const { service } = makeFakePriceService({
      created: 3,
      updated: 1,
      unchanged: 2,
      skippedNoOpening: 4,
      skippedLocked: true,
      targetGpId: null,
      targetGpRound: null,
    });
    const deps: PriceJobDeps = { priceService: service, lockStore: lock.store };

    const out = await applyPricesForGp(GP, deps);

    expect(out.result).toEqual({
      targetGpId: null,
      targetGpRound: null,
      created: 3,
      updated: 1,
      unchanged: 2,
      skippedNoOpening: 4,
      skippedLocked: true,
      changes: [],
    });
  });

  it("si el lock está ocupado, salta sin aplicar ni liberar", async () => {
    const lock = makeFakeLockStore({ occupied: true });
    const { service, apply } = makeFakePriceService();
    const deps: PriceJobDeps = { priceService: service, lockStore: lock.store };

    const out = await applyPricesForGp(GP, deps);

    expect(out.applied).toBe(false);
    expect(out.locked).toBe(true);
    expect(out.result).toBeUndefined();
    expect(lock.acquired).toEqual([]);
    expect(lock.released).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
  });

  it("si el servicio lanza, libera el lock y re-lanza el error", async () => {
    const lock = makeFakeLockStore();
    const boom = new Error("fallo de BD");
    const apply = vi.fn(async () => {
      throw boom;
    });
    const service = { applyFormulaForGp: apply } as unknown as PriceService;
    const deps: PriceJobDeps = { priceService: service, lockStore: lock.store };

    await expect(applyPricesForGp(GP, deps)).rejects.toBe(boom);

    expect(lock.acquired).toEqual([GP]);
    expect(lock.released).toEqual([{ gpId: GP, token: "token-1" }]);
  });
});
