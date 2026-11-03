/**
 * Tests del ciclo de polling con alertas (T-14, ADR-0036):
 * `runResultsPollCycle` = probe de la fuente + polling (US-17) + alertas en
 * transición.
 *
 * Todo se prueba con dependencias falsas (fetch, prisma, servicio, stores,
 * sink) — sin red ni Redis. Lo clave verificado: la **política de
 * transición** (ADR-0036):
 * - alerta SOLO al cruzar el umbral (prev < N ≤ new);
 * - aviso de recuperación (prev ≥ N > new);
 * - NO se repite mientras el fallo persiste;
 * - el sink nunca lanza ⇒ el ciclo sigue (un fallo de entrega no rompe el
 *   polling).
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";

import type { ResultsPollService } from "@/modules/jobs";
import type { ImportEventFromSourceResult } from "@/modules/results";
import type { ResultEventKind } from "@/shared/types";

import { runResultsPollCycle, type PollCycleDeps } from "../poll-cycle";
import { MemoryProbeStateStore } from "../probe-state";
import type { AlertSink } from "../alert-sink";

const NOW = new Date("2026-11-02T10:00:00Z");
const THRESHOLD = 3;

const OK_IMPORT: ImportEventFromSourceResult = {
  created: 1,
  corrected: 0,
  unchanged: 2,
  kept: 0,
  unmapped: [],
  recalculated: false,
  resultsVersion: null,
  lineupsScored: 0,
};

function fakeProbeFetch(ok: boolean) {
  const fetchImpl = (
    async (): Promise<Response> => {
      if (!ok) throw new Error("fetch failed (test)");
      return new Response(JSON.stringify([{ id: "s2026" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  ) as unknown as typeof fetch;
  return { fetchImpl };
}

interface SourceStateRow {
  gpId: string;
  event: string;
  source: string;
  consecutiveFailures: number;
}

/**
 * Prisma falso: `gp.findMany` (GPs de ventana + nombres por ID) y
 * `sourceState.findMany` (filas en alerta antes/después).
 */
function makePrisma(opts: {
  gps?: Array<{ id: string; name: string }>;
  failingBefore?: SourceStateRow[];
  after?: SourceStateRow[];
}) {
  const gpFindMany = vi.fn(async (args: {
    where?: Record<string, unknown>;
  }) => {
    if (args.where?.id) {
      const ids = (args.where.id as { in: string[] }).in;
      return (opts.gps ?? []).filter((g) => ids.includes(g.id));
    }
    // Ventana (pollResults): devolvemos el GP con UN evento race.
    return (opts.gps ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      status: "active",
      date: NOW,
      weekendEvents: [
        { id: `${g.id}-e1`, type: "race" as ResultEventKind, orderNum: 3 },
      ],
    }));
  });
  const sourceStateFindMany = vi
    .fn()
    .mockResolvedValueOnce(opts.failingBefore ?? [])
    .mockResolvedValue(opts.after ?? []);
  return {
    prisma: {
      gp: { findMany: gpFindMany },
      sourceState: { findMany: sourceStateFindMany },
    } as unknown as PrismaClient,
    gpFindMany,
    sourceStateFindMany,
  };
}

function makeService(opts: {
  importFails?: boolean;
  newFailureCount?: number;
}) {
  const importEventFromSource = vi.fn(async (): Promise<
    ImportEventFromSourceResult
  > => {
    if (opts.importFails) throw new Error("HTTP 503 (test)");
    return OK_IMPORT;
  });
  const recordSourceFailure = vi.fn(async () => opts.newFailureCount ?? 1);
  const resultsService = { importEventFromSource, recordSourceFailure };
  return {
    resultsService: resultsService as unknown as ResultsPollService,
    importEventFromSource,
    recordSourceFailure,
  };
}

function makeSink(behavior: "ok" | "throw" = "ok") {
  const send = vi.fn(async () => {
    if (behavior === "throw") throw new Error("sink caído (test)");
  });
  return {
    sink: { send } as unknown as AlertSink,
    send,
  };
}

/** Pre-carga N fallos consecutivos en el store de probe (estado previo). */
async function seedProbeFailures(
  store: MemoryProbeStateStore,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await store.recordAttempt({
      ok: false,
      error: `fallo ${i + 1}`,
      latencyMs: null,
      at: new Date(NOW.getTime() - (n - i) * 300_000),
    });
  }
}

function baseDeps(
  probeOk: boolean,
  overrides: Partial<PollCycleDeps> = {},
): PollCycleDeps {
  const { fetchImpl } = fakeProbeFetch(probeOk);
  const prisma = makePrisma({}).prisma;
  const resultsService = makeService({}).resultsService;
  return {
    prisma: prisma as PrismaClient,
    resultsService: resultsService as ResultsPollService,
    probe: { fetchImpl },
    probeConfig: { timeoutMs: 5000, failureAlertThreshold: THRESHOLD },
    pollConfig: {
      windowBeforeHours: 48,
      windowAfterHours: 24,
      failureAlertThreshold: THRESHOLD,
      intervalMinutes: 5,
    },
    probeState: new MemoryProbeStateStore(),
    alertSink: makeSink().sink as AlertSink,
    ...overrides,
  };
}

describe("runResultsPollCycle · probe de la fuente (T-14, ADR-0036)", () => {
  it("primer fallo del probe (1 < umbral): NO alerta aún", async () => {
    const { sink, send } = makeSink();
    const out = await runResultsPollCycle(NOW, baseDeps(false, {
      alertSink: sink as AlertSink,
    }));

    expect(out.probe.state.consecutiveFailures).toBe(1);
    expect(out.probe.transition).toBe("none");
    expect(out.alerts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("fallo que cruza el umbral (2 → 3): UNA alerta source-probe-failure", async () => {
    const { sink, send } = makeSink();
    const probeState = new MemoryProbeStateStore();
    await seedProbeFailures(probeState, THRESHOLD - 1);

    const out = await runResultsPollCycle(NOW, baseDeps(false, {
      probeState,
      alertSink: sink as AlertSink,
    }));

    expect(out.probe.transition).toBe("threshold_reached");
    expect(out.alerts).toEqual([
      expect.objectContaining({
        kind: "source-probe-failure",
        consecutiveFailures: THRESHOLD,
      }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fallo que persiste sobre el umbral (3 → 4): NO repite la alerta", async () => {
    const { sink, send } = makeSink();
    const probeState = new MemoryProbeStateStore();
    await seedProbeFailures(probeState, THRESHOLD);

    const out = await runResultsPollCycle(NOW, baseDeps(false, {
      probeState,
      alertSink: sink as AlertSink,
    }));

    expect(out.probe.state.consecutiveFailures).toBe(THRESHOLD + 1);
    expect(out.probe.transition).toBe("none");
    expect(out.alerts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("recuperación (3 → 0): UNA alerta source-probe-recovered", async () => {
    const { sink, send } = makeSink();
    const probeState = new MemoryProbeStateStore();
    await seedProbeFailures(probeState, THRESHOLD);

    const out = await runResultsPollCycle(NOW, baseDeps(true, {
      probeState,
      alertSink: sink as AlertSink,
    }));

    expect(out.probe.transition).toBe("recovered");
    expect(out.alerts).toEqual([
      expect.objectContaining({ kind: "source-probe-recovered" }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("estado del probe persiste en el store (lo leerá admin.jobsStatus)", async () => {
    const probeState = new MemoryProbeStateStore();
    await runResultsPollCycle(NOW, baseDeps(true, { probeState }));

    const state = (await probeState.read())!;
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastSuccessAt).toBe(NOW.toISOString());
    expect(state.lastAttemptAt).toBe(NOW.toISOString());
  });
});

describe("runResultsPollCycle · fallos del polling (T-14, ADR-0036)", () => {
  it("fallo del auto-import que cruza el umbral: alerta con nombre de GP", async () => {
    const { sink, send } = makeSink();
    const { prisma, gpFindMany } = makePrisma({
      gps: [{ id: "gp-1", name: "GP de Indonesia" }],
    });
    const { importEventFromSource, recordSourceFailure } = makeService({
      importFails: true,
      newFailureCount: THRESHOLD,
    });

    const out = await runResultsPollCycle(NOW, {
      ...baseDeps(true),
      prisma: prisma as PrismaClient,
      resultsService: { importEventFromSource, recordSourceFailure } as ResultsPollService,
      alertSink: sink as AlertSink,
    });

    expect(recordSourceFailure).toHaveBeenCalledTimes(1);
    expect(out.alerts).toEqual([
      expect.objectContaining({
        kind: "source-poll-failure",
        gpName: "GP de Indonesia",
        eventLabel: "carrera principal",
        consecutiveFailures: THRESHOLD,
      }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    // El nombre se resolvió con la consulta por ID.
    expect(gpFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: expect.anything() }) }),
    );
  });

  it("fallo del auto-import bajo el umbral: NO alerta", async () => {
    const { sink, send } = makeSink();
    const { prisma } = makePrisma({
      gps: [{ id: "gp-1", name: "GP de Indonesia" }],
    });
    const { importEventFromSource, recordSourceFailure } = makeService({
      importFails: true,
      newFailureCount: THRESHOLD - 1,
    });

    const out = await runResultsPollCycle(NOW, {
      ...baseDeps(true),
      prisma: prisma as PrismaClient,
      resultsService: { importEventFromSource, recordSourceFailure } as ResultsPollService,
      alertSink: sink as AlertSink,
    });

    expect(out.alerts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("recuperación del auto-import (estaba en alerta y ahora importa): alerta de OK", async () => {
    const { sink, send } = makeSink();
    const { prisma } = makePrisma({
      gps: [{ id: "gp-1", name: "GP de Indonesia" }],
      failingBefore: [
        {
          gpId: "gp-1",
          event: "race",
          source: "pulselive",
          consecutiveFailures: THRESHOLD,
        },
      ],
      after: [
        { gpId: "gp-1", event: "race", source: "pulselive", consecutiveFailures: 0 },
      ],
    });
    const service = makeService({ importFails: false });

    const out = await runResultsPollCycle(NOW, {
      ...baseDeps(true),
      prisma: prisma as PrismaClient,
      resultsService: service.resultsService,
      alertSink: sink as AlertSink,
    });

    expect(out.poll.outcomes).toEqual([expect.objectContaining({ kind: "imported" })]);
    expect(out.alerts).toEqual([
      expect.objectContaining({
        kind: "source-poll-recovered",
        gpName: "GP de Indonesia",
        eventLabel: "carrera principal",
      }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("fallo que persiste sobre el umbral (3 → 4): NO alerta de recuperación", async () => {
    const { sink, send } = makeSink();
    const { prisma } = makePrisma({
      gps: [{ id: "gp-1", name: "GP de Indonesia" }],
      failingBefore: [
        {
          gpId: "gp-1",
          event: "race",
          source: "pulselive",
          consecutiveFailures: THRESHOLD,
        },
      ],
      after: [
        {
          gpId: "gp-1",
          event: "race",
          source: "pulselive",
          consecutiveFailures: THRESHOLD + 1,
        },
      ],
    });
    const { importEventFromSource, recordSourceFailure } = makeService({
      importFails: true,
      newFailureCount: THRESHOLD + 1,
    });

    const out = await runResultsPollCycle(NOW, {
      ...baseDeps(true),
      prisma: prisma as PrismaClient,
      resultsService: { importEventFromSource, recordSourceFailure } as ResultsPollService,
      alertSink: sink as AlertSink,
    });

    // Siguiendo en fallo sobre el umbral: ni nueva alerta de fallo (el
    // cruce ya se avisó)...
    expect(out.poll.outcomes).toEqual([
      expect.objectContaining({ kind: "failed" }),
    ]);
    // ...ni alerta de recuperación (sigue caído).
    expect(out.alerts).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("sin alertas activas previas: solo la consulta de failingBefore (1 llamada)", async () => {
    const { prisma, sourceStateFindMany } = makePrisma({ gps: [] });

    await runResultsPollCycle(NOW, {
      ...baseDeps(true),
      prisma: prisma as PrismaClient,
    });

    // 1ª llamada: failingBefore (vacia). No hay 2ª (no hay recuperaciones).
    expect(sourceStateFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("runResultsPollCycle · robustez del sink (T-14, ADR-0036)", () => {
  it("sink que lanza: el ciclo NO se rompe (safeSend lo traga)", async () => {
    const { sink } = makeSink("throw");
    const probeState = new MemoryProbeStateStore();
    await seedProbeFailures(probeState, THRESHOLD - 1);

    const out = await runResultsPollCycle(NOW, baseDeps(false, {
      probeState,
      alertSink: sink as AlertSink,
    }));

    // El ciclo terminó; el estado del probe se registró igualmente.
    expect(out.probe.state.consecutiveFailures).toBe(THRESHOLD);
    expect(out.probe.transition).toBe("threshold_reached");
    // La alerta NO se cuenta como enviada (el sink falló).
    expect(out.alerts).toEqual([]);
  });

  it("resuelve el resultado completo (probe + poll + alerts) aunque falle todo", async () => {
    const { sink } = makeSink("throw");
    const { prisma } = makePrisma({
      gps: [{ id: "gp-1", name: "GP X" }],
    });
    const { importEventFromSource, recordSourceFailure } = makeService({
      importFails: true,
      newFailureCount: THRESHOLD,
    });

    const out = await runResultsPollCycle(NOW, {
      ...baseDeps(false, { alertSink: sink as AlertSink }),
      prisma: prisma as PrismaClient,
      resultsService: { importEventFromSource, recordSourceFailure } as ResultsPollService,
    });

    expect(out.probe.result.ok).toBe(false);
    expect(out.poll.outcomes).toEqual([expect.objectContaining({ kind: "failed" })]);
    expect(out.alerts).toEqual([]);
  });
});
