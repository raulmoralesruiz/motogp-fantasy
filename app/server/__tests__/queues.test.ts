/**
 * Colas BullMQ (`app/server/queues.ts`, T-10, ADR-0034): se prueba contra un
 * mock de `bullmq` (la creación real de `Queue` no es el objetivo) y un `env`
 * fijo, verificando:
 * - `enqueueGpPrices` → `add("apply-formula", { gpId }, jobOptions)` en la cola
 *   `gp-prices` con reintentos/backoff de `PROVISIONAL_JOBS`.
 * - `ensureResultsPollScheduler` → `upsertJobScheduler` idempotente con el
 *   intervalo (ms) y tz UTC en la cola `results-poll`.
 * - Creación **perezosa**: la cola se instancia una sola vez (singleton) y se
 *   reutiliza en llamadas sucesivas.
 *
 * `bullmq` y `./env` se mockean. `vi.resetModules()` aísla el singleton de
 * cola entre tests (el módulo se re-ejecuta; los mocks registrados persisten).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  upsertJobScheduler: vi.fn(),
  queueInstances: [] as Array<{ name: string; opts: unknown }>,
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function FakeQueue(this: unknown, name: string, opts: unknown) {
    mocks.queueInstances.push({ name, opts });
    return {
      add: mocks.add,
      upsertJobScheduler: mocks.upsertJobScheduler,
      close: vi.fn(),
    };
  }),
}));

vi.mock("../env", () => ({
  getServerEnv: vi.fn(() => ({ REDIS_URL: "redis://localhost:6379/0" })),
}));

import {
  JOBS_QUEUE_GP_PRICES,
  JOBS_QUEUE_RESULTS_POLL,
  PROVISIONAL_JOBS,
} from "@/shared/config/jobs";

let queues: typeof import("../queues");

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.queueInstances.length = 0;
  mocks.add.mockResolvedValue({ id: "job-1" });
  mocks.upsertJobScheduler.mockResolvedValue({ id: "sched-1" });
  // Aísla el singleton de cola: el módulo se re-ejecuta (nuevos `let`), los
  // mocks de bullmq/env registrados con vi.mock persisten.
  vi.resetModules();
  queues = await import("../queues");
});

describe("queues (T-10, ADR-0034)", () => {
  it("enqueueGpPrices: encola apply-formula en gp-prices con reintentos/backoff", async () => {
    await queues.enqueueGpPrices("gp-1");

    expect(mocks.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = mocks.add.mock.calls[0]!;
    expect(name).toBe("apply-formula");
    expect(data).toEqual({ gpId: "gp-1" });
    expect(opts).toEqual({
      attempts: PROVISIONAL_JOBS.attempts,
      backoff: { type: "exponential", delay: PROVISIONAL_JOBS.backoffMs },
    });

    // La cola se creó con el nombre correcto + conexión desde REDIS_URL.
    expect(mocks.queueInstances).toHaveLength(1);
    const created = mocks.queueInstances[0]!;
    expect(created.name).toBe(JOBS_QUEUE_GP_PRICES);
    const conn = (
      created.opts as {
        connection: { url: string; maxRetriesPerRequest: null };
      }
    ).connection;
    expect(conn.url).toBe("redis://localhost:6379/0");
    expect(conn.maxRetriesPerRequest).toBe(null); // requisito de BullMQ
  });

  it("ensureResultsPollScheduler: upsert idempotente con intervalo (ms) y tz UTC", async () => {
    await queues.ensureResultsPollScheduler(5 * 60 * 1000);

    expect(mocks.upsertJobScheduler).toHaveBeenCalledTimes(1);
    const [id, repeatOpts, jobTemplate] =
      mocks.upsertJobScheduler.mock.calls[0]!;
    expect(id).toBe("results-poll:repeatable");
    expect(repeatOpts).toEqual({ every: 300_000, tz: "UTC" });
    expect(jobTemplate).toEqual({});

    const created = mocks.queueInstances[0]!;
    expect(created.name).toBe(JOBS_QUEUE_RESULTS_POLL);
  });

  it("creación perezosa: la misma cola se reutiliza en llamadas sucesivas", async () => {
    await queues.enqueueGpPrices("gp-1");
    await queues.enqueueGpPrices("gp-2");

    // Una sola instancia de Queue para gp-prices (singleton), dos `add`.
    const gpPrices = mocks.queueInstances.filter(
      (q) => q.name === JOBS_QUEUE_GP_PRICES,
    );
    expect(gpPrices).toHaveLength(1);
    expect(mocks.add).toHaveBeenCalledTimes(2);
  });

  describe("enqueueFireAndForget (T-10: un fallo de cola no rompe el flujo)", () => {
    it("éxito: encola sin loguear error", async () => {
      const enqueue = vi.fn().mockResolvedValue(undefined);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      queues.enqueueFireAndForget("gp-prices", enqueue, "gp-1");
      // Deja correr el microtask del `.catch` (no debe loguear nada).
      await new Promise((r) => setTimeout(r, 0));

      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("fallo: loguea el error (con message) y no lo propaga", async () => {
      const enqueue = vi
        .fn()
        .mockRejectedValue(new Error("Redis no disponible"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      // No lanza (fire-and-forget): el error se captura en el `.catch`.
      expect(() =>
        queues.enqueueFireAndForget("gp-prices", enqueue, "gp-9"),
      ).not.toThrow();
      // Deja correr el microtask del `.catch` para inspeccionar el log.
      await new Promise((r) => setTimeout(r, 0));
      expect(enqueue).toHaveBeenCalledTimes(1);

      expect(spy).toHaveBeenCalledTimes(1);
      const args = spy.mock.calls[0]!;
      expect(args[0]).toContain("fallo al encolar gp-prices");
      expect(args[0]).toContain("gp-9");
      expect(args[1]).toBe("Redis no disponible");
      spy.mockRestore();
    });

    it("fallo con valor no Error: lo loguea tal cual", async () => {
      const enqueue = vi.fn().mockRejectedValue("fallo simple");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      queues.enqueueFireAndForget("results-poll", enqueue, "gp-7");
      await new Promise((r) => setTimeout(r, 0));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toBe("fallo simple");
      spy.mockRestore();
    });
  });
});
