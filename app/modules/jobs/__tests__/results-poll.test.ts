/**
 * Tests unit del job de polling de auto-import de resultados (US-17,
 * ADR-0019).
 *
 * `pollResults` se prueba con dependencias falsas (prisma +
 * ResultsPollService) para cubrir la orquestación: ventana UTC, un intento
 * por (GP, evento), skips esperados que no cuentan como fallo, registro de
 * fallos y alerta al alcanzar el umbral.
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";

import {
  pollResults,
  type ResultsPollDeps,
  type ResultsPollService,
} from "../results-poll";
import {
  SourceNotLinkedError,
  SourceSessionNotFinishedError,
  type ImportEventFromSourceResult,
} from "@/modules/results";
import type { ResultEventKind } from "@/shared/types";

const NOW = new Date("2026-10-23T12:00:00Z");

const OK_RESULT: ImportEventFromSourceResult = {
  created: 1,
  corrected: 0,
  unchanged: 2,
  kept: 0,
  unmapped: [],
  recalculated: false,
  resultsVersion: null,
  lineupsScored: 0,
};

/** GP falso tal como lo devuelve la consulta del job (con sus eventos). */
interface FakeGp {
  id: string;
  weekendEvents: Array<{ id: string; type: string; orderNum: number }>;
}

function makeDeps(gps: FakeGp[], service?: Partial<ResultsPollService>) {
  const findMany = vi.fn().mockResolvedValue(gps);
  const prisma = { gp: { findMany } } as unknown as PrismaClient;
  const importEventFromSource = vi.fn(async () => OK_RESULT);
  const recordSourceFailure = vi.fn(async () => 1);
  const resultsService: ResultsPollService = {
    importEventFromSource,
    recordSourceFailure,
    ...service,
  };
  const deps: ResultsPollDeps = { prisma, resultsService };
  // Devuelve los spies que el servicio usa de verdad (pueden venir de `service`).
  return {
    deps,
    findMany,
    importEventFromSource: resultsService.importEventFromSource,
    recordSourceFailure: resultsService.recordSourceFailure,
  };
}

function gpWithEvents(id: string, events: Array<[string, number]>): FakeGp {
  return {
    id,
    weekendEvents: events.map(([type, orderNum], index) => ({
      id: `${id}-e${index + 1}`,
      type,
      orderNum,
    })),
  };
}

describe("pollResults (US-17 job de auto-import)", () => {
  it("consulta los GPs de la ventana UTC [now − 48h, now + 24h] con sus eventos importables", async () => {
    const { deps, findMany } = makeDeps([]);

    const out = await pollResults(NOW, deps);

    expect(out.window.from).toEqual(new Date("2026-10-21T12:00:00Z"));
    expect(out.window.to).toEqual(new Date("2026-10-24T12:00:00Z"));
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: { not: "cancelled" },
        date: { gte: out.window.from, lte: out.window.to },
      },
      include: {
        weekendEvents: {
          where: { type: { in: ["q2", "sprint", "race"] }, status: { not: "cancelled" } },
          orderBy: { orderNum: "asc" },
        },
      },
    });
  });

  it("devuelve resultados vacíos cuando no hay GPs en la ventana", async () => {
    const { deps, importEventFromSource } = makeDeps([]);

    const out = await pollResults(NOW, deps);

    expect(out.outcomes).toEqual([]);
    expect(out.alerts).toEqual([]);
    expect(importEventFromSource).not.toHaveBeenCalled();
  });

  it("importa cada (GP, evento) en orden y devuelve el resultado", async () => {
    const gps: FakeGp[] = [
      gpWithEvents("gp-1", [
        ["q2", 1],
        ["race", 3],
      ]),
      gpWithEvents("gp-2", [["sprint", 2]]),
    ];
    const { deps, importEventFromSource } = makeDeps(gps);

    const out = await pollResults(NOW, deps);

    expect(importEventFromSource).toHaveBeenCalledTimes(3);
    expect(importEventFromSource).toHaveBeenNthCalledWith(1, "gp-1", "q2", { now: NOW });
    expect(importEventFromSource).toHaveBeenNthCalledWith(2, "gp-1", "race", { now: NOW });
    expect(importEventFromSource).toHaveBeenNthCalledWith(3, "gp-2", "sprint", { now: NOW });
    expect(out.outcomes).toEqual([
      { kind: "imported", gpId: "gp-1", event: "q2", result: OK_RESULT },
      { kind: "imported", gpId: "gp-1", event: "race", result: OK_RESULT },
      { kind: "imported", gpId: "gp-2", event: "sprint", result: OK_RESULT },
    ]);
    expect(out.alerts).toEqual([]);
  });

  it("salta sin contar fallo cuando el GP no está vinculado", async () => {
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["race", 3]])];
    const { deps, recordSourceFailure } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw new SourceNotLinkedError("El GP no está vinculado a la fuente.");
      }),
    });

    const out = await pollResults(NOW, deps);

    expect(out.outcomes).toEqual([
      { kind: "skipped", gpId: "gp-1", event: "race", reason: "not-linked" },
    ]);
    expect(recordSourceFailure).not.toHaveBeenCalled();
    expect(out.alerts).toEqual([]);
  });

  it("salta sin contar fallo cuando la sesión no ha terminado", async () => {
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["sprint", 2]])];
    const { deps, recordSourceFailure } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw new SourceSessionNotFinishedError("La sesión aún no ha terminado.");
      }),
    });

    const out = await pollResults(NOW, deps);

    expect(out.outcomes).toEqual([
      { kind: "skipped", gpId: "gp-1", event: "sprint", reason: "session-not-finished" },
    ]);
    expect(recordSourceFailure).not.toHaveBeenCalled();
    expect(out.alerts).toEqual([]);
  });

  it("registra el fallo y no alerta por debajo del umbral", async () => {
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["race", 3]])];
    const { deps, recordSourceFailure } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw new Error("timeout de la fuente");
      }),
      recordSourceFailure: vi.fn(async () => 2),
    });

    const out = await pollResults(NOW, deps);

    expect(recordSourceFailure).toHaveBeenCalledWith(
      "gp-1",
      "race",
      "timeout de la fuente",
      { now: NOW },
    );
    expect(out.outcomes).toEqual([
      {
        kind: "failed",
        gpId: "gp-1",
        event: "race",
        error: "timeout de la fuente",
        consecutiveFailures: 2,
      },
    ]);
    expect(out.alerts).toEqual([]);
  });

  it("emite una alerta al alcanzar el umbral de fallos seguidos", async () => {
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["race", 3]])];
    const { deps } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw new Error("timeout de la fuente");
      }),
      recordSourceFailure: vi.fn(async () => 3),
    });

    const out = await pollResults(NOW, deps);

    expect(out.alerts).toEqual([
      {
        gpId: "gp-1",
        event: "race",
        consecutiveFailures: 3,
        lastError: "timeout de la fuente",
      },
    ]);
  });

  it("trunca el último error a 500 caracteres en la alerta (el outcome conserva el completo)", async () => {
    const longMessage = "x".repeat(600);
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["q2", 1]])];
    const { deps } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw new Error(longMessage);
      }),
      recordSourceFailure: vi.fn(async () => 3),
    });

    const out = await pollResults(NOW, deps);

    const alert = out.alerts[0];
    expect(alert?.lastError).toBe("x".repeat(500));
    expect(out.outcomes[0]).toMatchObject({ kind: "failed", error: longMessage });
  });

  it("convierte a string los lanzamientos que no son Error", async () => {
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["sprint", 2]])];
    const { deps, recordSourceFailure } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw "fallo sin mensaje";
      }),
      recordSourceFailure: vi.fn(async () => 1),
    });

    const out = await pollResults(NOW, deps);

    expect(recordSourceFailure).toHaveBeenCalledWith(
      "gp-1",
      "sprint",
      "fallo sin mensaje",
      { now: NOW },
    );
    expect(out.outcomes).toEqual([
      {
        kind: "failed",
        gpId: "gp-1",
        event: "sprint",
        error: "fallo sin mensaje",
        consecutiveFailures: 1,
      },
    ]);
  });

  it("continúa con los siguientes eventos tras un skip o un fallo", async () => {
    const gps: FakeGp[] = [
      gpWithEvents("gp-1", [
        ["q2", 1],
        ["sprint", 2],
        ["race", 3],
      ]),
    ];
    const { deps } = makeDeps(gps, {
      importEventFromSource: vi.fn(async (_gpId: string, event: ResultEventKind) => {
        if (event === "q2") throw new SourceNotLinkedError("sin vínculo");
        if (event === "sprint") throw new Error("fallo de red");
        return OK_RESULT;
      }),
      recordSourceFailure: vi.fn(async () => 1),
    });

    const out = await pollResults(NOW, deps);

    expect(out.outcomes).toEqual([
      { kind: "skipped", gpId: "gp-1", event: "q2", reason: "not-linked" },
      {
        kind: "failed",
        gpId: "gp-1",
        event: "sprint",
        error: "fallo de red",
        consecutiveFailures: 1,
      },
      { kind: "imported", gpId: "gp-1", event: "race", result: OK_RESULT },
    ]);
    expect(out.alerts).toEqual([]);
  });

  it("usa la configuración inyectada (ventana y umbral)", async () => {
    const gps: FakeGp[] = [gpWithEvents("gp-1", [["q2", 1]])];
    const { deps, findMany } = makeDeps(gps, {
      importEventFromSource: vi.fn(async () => {
        throw new Error("fallo");
      }),
      recordSourceFailure: vi.fn(async () => 1),
    });

    const out = await pollResults(
      NOW,
      deps,
      {
        windowBeforeHours: 1,
        windowAfterHours: 2,
        intervalMinutes: 5,
        failureAlertThreshold: 1,
      },
    );

    expect(out.window.from).toEqual(new Date("2026-10-23T11:00:00Z"));
    expect(out.window.to).toEqual(new Date("2026-10-23T14:00:00Z"));
    const args = findMany.mock.calls[0]?.[0] as {
      where: { date: { gte: Date; lte: Date } };
    };
    expect(args.where.date.gte).toEqual(new Date("2026-10-23T11:00:00Z"));
    expect(args.where.date.lte).toEqual(new Date("2026-10-23T14:00:00Z"));
    // Umbral 1: la primera alerta salta en el primer fallo.
    expect(out.alerts).toEqual([
      { gpId: "gp-1", event: "q2", consecutiveFailures: 1, lastError: "fallo" },
    ]);
  });
});
