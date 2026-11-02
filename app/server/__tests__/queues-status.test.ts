/**
 * Tests de `getQueueStatus` (T-14, ADR-0036): estado de cola BullMQ para el
 * panel "Jobs y fuentes" (counts + último job fallido).
 *
 * Mismo patrón que `queues.test.ts`: `bullmq` y `../env` mockeados.
 *
 * Semánticas cubiertas:
 * - counts por estado (waiting/active/delayed/completed/failed);
 * - último fallido: `finishedOn` → ISO; `id` ausente → null;
 * - sin fallidos: `lastFailedJob = null`;
 * - cuenta de `failed` ausente → 0 (defensivo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queue: {
    getJobCounts: vi.fn(),
    getFailed: vi.fn(),
  },
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function FakeQueue(this: unknown): unknown {
    return mocks.queue;
  }),
}));

vi.mock("../env", () => ({
  getServerEnv: vi.fn(() => ({ REDIS_URL: "redis://localhost:6379/0" })),
}));

import { getQueueStatus } from "../queues";

const FINISHED = 1762123200000; // 2026-11-02T10:00:00Z (ms)

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.queue.getJobCounts.mockResolvedValue({
    waiting: 1,
    active: 0,
    delayed: 2,
    completed: 10,
    failed: 3,
  });
  mocks.queue.getFailed.mockResolvedValue([
    {
      id: "job-42",
      name: "apply-formula",
      finishedOn: FINISHED,
      failedReason: "HTTP 503",
      attemptsMade: 3,
    },
  ]);
  // Aísla el mapa de colas del módulo (vi.resetModules lo re-ejecuta).
  vi.resetModules();
});

describe("getQueueStatus (T-14, ADR-0036)", () => {
  it("counts por estado + cola nombrada", async () => {
    const status = await getQueueStatus("gp-prices");

    expect(status).toMatchObject({
      name: "gp-prices",
      waiting: 1,
      active: 0,
      delayed: 2,
      completed: 10,
      failed: 3,
    });
    expect(mocks.queue.getJobCounts).toHaveBeenCalledWith(
      "waiting",
      "active",
      "delayed",
      "completed",
      "failed",
    );
    expect(mocks.queue.getFailed).toHaveBeenCalledWith(0, 0);
  });

  it("último fallido: finishedOn → ISO, motivo e intentos", async () => {
    const status = await getQueueStatus("gp-prices");

    expect(status.lastFailedJob).toEqual({
      id: "job-42",
      name: "apply-formula",
      failedAt: new Date(FINISHED).toISOString(),
      failedReason: "HTTP 503",
      attemptsMade: 3,
    });
  });

  it("sin fallidos: lastFailedJob = null", async () => {
    mocks.queue.getFailed.mockResolvedValue([]);

    const status = await getQueueStatus("results-poll");

    expect(status.lastFailedJob).toBeNull();
  });

  it("id ausente en el job fallido → null (defensivo)", async () => {
    mocks.queue.getFailed.mockResolvedValue([
      {
        name: "apply-formula",
        finishedOn: null,
        failedReason: "lock ocupado",
        attemptsMade: 1,
      },
    ]);

    const status = await getQueueStatus("gp-prices");

    expect(status.lastFailedJob).toEqual({
      id: null,
      name: "apply-formula",
      failedAt: null,
      failedReason: "lock ocupado",
      attemptsMade: 1,
    });
  });

  it("counts con estados ausentes → 0 (defensivo)", async () => {
    mocks.queue.getJobCounts.mockResolvedValue({ failed: 1 });

    const status = await getQueueStatus("gp-prices");

    expect(status).toMatchObject({
      waiting: 0,
      active: 0,
      delayed: 0,
      completed: 0,
      failed: 1,
    });
  });
});
