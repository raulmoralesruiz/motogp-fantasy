import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  FICTION_RESULTS_VERSION,
  FICTION_SOURCE_NAME,
  seedFictionalSeason,
  type FictionWorld,
} from "../fixtures/fiction/loader";
import { loadFictionDataset } from "../fixtures/fiction/index";
import { createPrisma } from "./helpers";

/** Extrae un id de un mapa de siembra (falla claro si falta). */
function requireId(map: Map<string, string>, id: string): string {
  const value = map.get(id);
  if (!value) throw new Error(`Loader: "${id}" no está sembrado`);
  return value;
}

/**
 * T-22 · CA (verificado en CI contra BD real): el dataset ficticio de
 * economy.md §7 se siembra íntegro (temporada, mercado, lineups fijos y
 * resultados anonimizados) y respeta los constraints duros: trigger de
 * composición, uniques e idempotencia de resultados.
 */
describe("T-22 · Dataset ficticio (economy.md §7) en BD real", () => {
  let prisma!: PrismaClient;
  let world!: FictionWorld;
  const ds = loadFictionDataset();

  beforeAll(async () => {
    prisma = createPrisma();
    world = await seedFictionalSeason(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("siembra la temporada completa con los volúmenes esperados", async () => {
    const lineupIds = world.lineups.map((l) => l.id);
    const riderIds = world.riders.map((r) => r.id);
    const assetIds = [...world.riders, ...world.constructors, ...world.teams].map(
      (a) => a.id,
    );
    const gpIds = world.gps.map((g) => g.id);

    expect(world.gps).toHaveLength(6);
    expect(world.events).toHaveLength(6);
    expect(world.riders).toHaveLength(11);
    expect(world.constructors).toHaveLength(4);
    expect(world.teams).toHaveLength(4);
    expect(world.users).toHaveLength(6);
    expect(world.lineups).toHaveLength(36); // 6 jugadores × 6 GPs
    expect(
      await prisma.lineupSlot.count({ where: { lineupId: { in: lineupIds } } }),
    ).toBe(216);
    expect(
      await prisma.riderAffiliation.count({ where: { riderId: { in: riderIds } } }),
    ).toBe(66);
    // 19 activos × (1 P0 + 6 GPs)
    expect(await prisma.price.count({ where: { assetId: { in: assetIds } } })).toBe(133);
    expect(await prisma.result.count({ where: { gpId: { in: gpIds } } })).toBe(66);
  });

  it("todos los lineups fijos son completos (2 oro + 2 plata + 1 constructor + 1 equipo)", async () => {
    const groups = await prisma.lineupSlot.groupBy({
      by: ["lineupId"],
      where: { lineupId: { in: world.lineups.map((l) => l.id) } },
      _count: { _all: true },
    });
    expect(groups).toHaveLength(36);
    for (const g of groups) {
      expect(g._count._all).toBe(6);
    }
  });

  it("los precios de apertura (P0) coinciden con el fixture", async () => {
    const p0ByDbId = new Map<string, number>();
    for (const r of ds.riders) p0ByDbId.set(requireId(world.riderDbId, r.id), r.p0);
    for (const c of ds.constructors) p0ByDbId.set(requireId(world.ctorDbId, c.id), c.p0);
    for (const t of ds.teams) p0ByDbId.set(requireId(world.teamDbId, t.id), t.p0);

    const rows = await prisma.price.findMany({
      where: {
        assetId: { in: [...p0ByDbId.keys()] },
        gpId: null,
      },
    });
    expect(rows).toHaveLength(19);
    for (const row of rows) {
      expect(row.price.toNumber()).toBe(p0ByDbId.get(row.assetId));
    }
  });

  it("los resultados son provisionales con fuente y versión de auditoría", async () => {
    const rows = await prisma.result.findMany({
      where: { gpId: { in: world.gps.map((g) => g.id) } },
    });
    expect(rows).toHaveLength(66);
    for (const row of rows) {
      expect(row.status).toBe("provisional");
      expect(row.source).toBe("manual");
      expect(row.sourceName).toBe(FICTION_SOURCE_NAME);
      expect(row.resultsVersion).toBe(FICTION_RESULTS_VERSION);
    }
  });

  it("B no corre en GP3–GP4 (position NULL, estado ABSENT en raw)", async () => {
    const riderB = requireId(world.riderDbId, "rider-b");
    for (const round of [3, 4]) {
      const gp = world.gps.find((g) => g.round === round);
      const event = world.events.find((e) => e.gpId === gp?.id);
      if (!gp || !event) throw new Error(`Falta el GP${round} o su evento`);
      const row = await prisma.result.findFirst({
        where: { gpId: gp.id, eventId: event.id, riderId: riderB },
      });
      if (!row) throw new Error(`Falta el resultado de B en el GP${round}`);
      expect(row.position).toBeNull();
      expect((row.raw as { status?: string } | null)?.status).toBe("ABSENT");
    }
  });

  it("re-importar un resultado no lo duplica (unique gp, event, rider)", async () => {
    const gp1 = world.gps.find((g) => g.round === 1);
    const event1 = world.events.find((e) => e.gpId === gp1?.id);
    if (!gp1 || !event1) throw new Error("Falta el GP1 o su evento");
    const riderA = requireId(world.riderDbId, "rider-a");
    await expect(
      prisma.result.create({
        data: {
          gpId: gp1.id,
          eventId: event1.id,
          riderId: riderA,
          position: 1,
          source: "manual",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
