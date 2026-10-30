/**
 * Tests de `MarketService` (US-06, T-24): las ramas defensivas que la suite
 * de integración no recorre — violaciones de unique concurrentes (P2002),
 * errores no-P2002 (re-lanzados) y NOT_FOUND de `setRiderAffiliationFrom`.
 *
 * `prisma` se inyecta (DI) como un objeto falso: cada método es un
 * `vi.fn()` y `$transaction(fn)` ejecuta `fn` con el propio objeto como
 * `tx` (los tests no necesitan una BD real).
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { MarketService } from "../market-service";

const meta = { actorId: "admin-1", ip: "127.0.0.1" };

/** Prisma falso: los métodos son `vi.fn()` independientes; `tx` = el propio objeto. */
function makePrisma() {
  const rider = { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() };
  const constructor = { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() };
  const team = { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() };
  const gp = { findUnique: vi.fn(), findMany: vi.fn() };
  const riderAffiliation = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const season = { findUnique: vi.fn() };
  const price = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const auditLog = { create: vi.fn() };
  const prisma = {
    rider,
    constructor,
    team,
    gp,
    riderAffiliation,
    season,
    price,
    auditLog,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    rider,
    constructor,
    team,
    gp,
    riderAffiliation,
    season,
    price,
    auditLog,
  };
}

const P2002 = { code: "P2002" };
const boom = () => new Error("caída de BD");

const riderRow = {
  id: "r1",
  name: "Francesco Bagnaia",
  number: 27,
  isActive: true,
};
const constructorRow = { id: "c1", name: "Ducati" };
const teamRow = {
  id: "t1",
  name: "Ducati Lenovo Team",
  constructorId: "c1",
};
const teamWithConstructor = {
  ...teamRow,
  constructor: { id: "c1", name: "Ducati" },
};
const gpRow = {
  id: "g1",
  seasonId: "s1",
  round: 5,
  name: "GP de Cataluña",
  date: new Date("2026-06-14T13:00:00Z"),
};

describe("MarketService.createRider (T-24)", () => {
  it("P2002 (creación concurrente) → reutiliza el existente sin auditar", async () => {
    const fake = makePrisma();
    fake.rider.findUnique
      .mockResolvedValueOnce(null) // pre-consulta: aún no existe
      .mockResolvedValueOnce(riderRow); // tras el P2002: ya existe
    fake.rider.create.mockRejectedValueOnce(P2002);
    const service = new MarketService({ prisma: fake.prisma });

    const result = await service.createRider(
      { name: riderRow.name, number: 27 },
      meta,
    );

    expect(result).toMatchObject({ id: "r1", created: false });
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("P2002 y la re-consulta no encuentra la fila → se re-lanza", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    fake.rider.create.mockRejectedValueOnce(P2002);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.createRider({ name: "X" }, meta),
    ).rejects.toEqual(P2002);
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    const err = boom();
    fake.rider.create.mockRejectedValueOnce(err);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(service.createRider({ name: "X" }, meta)).rejects.toBe(err);
  });
});

describe("MarketService.createConstructor (T-24)", () => {
  it("P2002 (creación concurrente) → reutiliza el existente sin auditar", async () => {
    const fake = makePrisma();
    fake.constructor.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(constructorRow);
    fake.constructor.create.mockRejectedValueOnce(P2002);
    const service = new MarketService({ prisma: fake.prisma });

    const result = await service.createConstructor(
      { name: constructorRow.name },
      meta,
    );

    expect(result).toMatchObject({ id: "c1", created: false });
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.constructor.findUnique.mockResolvedValue(null);
    const err = boom();
    fake.constructor.create.mockRejectedValueOnce(err);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.createConstructor({ name: "X" }, meta),
    ).rejects.toBe(err);
  });
});

describe("MarketService.createTeam (T-24)", () => {
  it("P2002 (creación concurrente) → reutiliza el existente sin auditar", async () => {
    const fake = makePrisma();
    fake.constructor.findUnique.mockResolvedValueOnce(constructorRow);
    fake.team.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(teamWithConstructor);
    fake.team.create.mockRejectedValueOnce(P2002);
    const service = new MarketService({ prisma: fake.prisma });

    const result = await service.createTeam(
      { name: teamRow.name, constructorId: "c1" },
      meta,
    );

    expect(result).toMatchObject({
      id: "t1",
      constructorName: "Ducati",
      created: false,
    });
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.constructor.findUnique.mockResolvedValue(constructorRow);
    fake.team.findUnique.mockResolvedValue(null);
    const err = boom();
    fake.team.create.mockRejectedValueOnce(err);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.createTeam({ name: "X", constructorId: "c1" }, meta),
    ).rejects.toBe(err);
  });
});

describe("MarketService.setRiderAffiliation (T-24)", () => {
  it("P2002 (creación concurrente) → re-ejecuta y no-op si ya coincide", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.team.findUnique.mockResolvedValue(teamRow);
    fake.gp.findUnique.mockResolvedValue(gpRow);
    fake.riderAffiliation.findUnique
      .mockResolvedValueOnce(null) // 1ª tx: aún no existe → intenta crear
      .mockResolvedValueOnce({
        // 2ª tx (re-ejecución): ya existe, con la misma afiliación
        id: "a1",
        riderId: "r1",
        gpId: "g1",
        teamId: "t1",
        constructorId: "c1",
        gp: gpRow,
        team: teamRow,
        constructor: constructorRow,
      });
    fake.riderAffiliation.create.mockRejectedValueOnce(P2002);
    const service = new MarketService({ prisma: fake.prisma });

    const result = await service.setRiderAffiliation(
      { riderId: "r1", gpId: "g1", teamId: "t1" },
      meta,
    );

    expect(result).toMatchObject({ changed: false });
    expect(fake.riderAffiliation.update).not.toHaveBeenCalled();
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.team.findUnique.mockResolvedValue(teamRow);
    fake.gp.findUnique.mockResolvedValue(gpRow);
    fake.riderAffiliation.findUnique.mockResolvedValue(null);
    const err = boom();
    fake.riderAffiliation.create.mockRejectedValueOnce(err);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.setRiderAffiliation({ riderId: "r1", gpId: "g1", teamId: "t1" }, meta),
    ).rejects.toBe(err);
  });
});

describe("MarketService.setRiderAffiliationFrom (T-24)", () => {
  it("piloto inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.setRiderAffiliationFrom(
        { riderId: "nope", fromGpId: "g1", teamId: "t1" },
        meta,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("equipo inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.team.findUnique.mockResolvedValue(null);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.setRiderAffiliationFrom(
        { riderId: "r1", fromGpId: "g1", teamId: "nope" },
        meta,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ── getRider (detalle del piloto + afiliaciones) ────────────────────────────

describe("MarketService.getRider", () => {
  /** Piloto con una afiliación que incluye las relaciones (como las devuelve Prisma). */
  const riderWithAffiliation = {
    ...riderRow,
    affiliations: [
      {
        id: "a1",
        riderId: "r1",
        teamId: "t1",
        constructorId: "c1",
        gpId: "g1",
        gp: gpRow,
        team: teamRow,
        constructor: constructorRow,
      },
    ],
  };

  it("piloto inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(service.getRider("nope")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("mapea las afiliaciones con `manufacturer` (NO `constructor`)", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderWithAffiliation);
    const service = new MarketService({ prisma: fake.prisma });

    const detail = await service.getRider("r1");

    expect(detail.rider).toMatchObject({ id: "r1", name: riderRow.name });
    expect(detail.affiliations).toHaveLength(1);
    const affiliation = detail.affiliations[0]!;
    expect(affiliation).toMatchObject({
      id: "a1",
      teamId: "t1",
      constructorId: "c1",
      gp: { round: gpRow.round, name: gpRow.name },
      team: { id: "t1", name: teamRow.name },
      manufacturer: { id: "c1", name: "Ducati" },
    });
    // La key propia `constructor` NO debe estar en la vista (ver test
    // siguiente): superjson itera propiedades propias (`Object.entries`).
    expect(Object.hasOwn(affiliation, "constructor")).toBe(false);
  });

  it("REGRESIÓN: la respuesta se serializa con superjson (sin key peligrosa `constructor`)", async () => {
    // superjson (transformer de tRPC) lanza "Detected property constructor"
    // si un objeto de la respuesta tiene key propia `constructor`: el
    // endpoint `market.riders.get` fallaba en producción (500). Esta prueba
    // garantiza que la vista de `getRider` siempre es serializable.
    const superjson = await import("superjson");
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderWithAffiliation);
    const service = new MarketService({ prisma: fake.prisma });

    const detail = await service.getRider("r1");

    expect(() => superjson.serialize(detail)).not.toThrow();
  });
});

// ── P0 heurística desde clasificación (ADR-0014) ────────────────────────────

const seasonRow = { id: "s1", year: 2026, name: "Temporada 2026" };

/** Clasificación de 3 riders (posiciones 1, 2, 3). */
const standings3 = [
  {
    position: 1,
    riderFullName: "Rider One",
    riderNumber: 1,
    teamName: "Team A",
    constructorName: "Ctor A",
    points: 300,
  },
  {
    position: 2,
    riderFullName: "Rider Two",
    riderNumber: 2,
    teamName: "Team A",
    constructorName: "Ctor A",
    points: 200,
  },
  {
    position: 3,
    riderFullName: "Rider Three",
    riderNumber: 3,
    teamName: "Team B",
    constructorName: "Ctor B",
    points: 100,
  },
];

describe("MarketService.calculateP0FromClassification (ADR-0014)", () => {
  it("temporada inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.season.findUnique.mockResolvedValue(null);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.calculateP0FromClassification("nope", standings3, meta),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("clasificación vacía → error de normalización", async () => {
    const fake = makePrisma();
    fake.season.findUnique.mockResolvedValue(seasonRow);
    const service = new MarketService({ prisma: fake.prisma });

    await expect(
      service.calculateP0FromClassification("s1", [], meta),
    ).rejects.toThrow(/clasificación/);
  });

  it(
    "calcula P0 de riders (lineal 30→10), equipos y constructores (media), " +
      "y audita `price.p0_heuristic`",
    async () => {
      const fake = makePrisma();
      fake.season.findUnique.mockResolvedValue(seasonRow);
      // Riders en BD (por nombre).
      fake.rider.findUnique.mockImplementation(async ({ where }) => {
        const byName = new Map([
          ["Rider One", { id: "r1", name: "Rider One" }],
          ["Rider Two", { id: "r2", name: "Rider Two" }],
          ["Rider Three", { id: "r3", name: "Rider Three" }],
        ]);
        return byName.get(where.name) ?? null;
      });
      // Sin P0 existente → se crea.
      fake.price.findFirst.mockResolvedValue(null);
      fake.price.create.mockResolvedValue({ id: "p1" });
      // Afiliaciones: r1/r2 en Team A (Ctor A), r3 en Team B (Ctor B).
      fake.riderAffiliation.findFirst.mockImplementation(async ({ where }) => {
        const byRider = new Map([
          ["r1", { teamId: "t1", constructorId: "c1" }],
          ["r2", { teamId: "t1", constructorId: "c1" }],
          ["r3", { teamId: "t2", constructorId: "c2" }],
        ]);
        return byRider.get(where.riderId) ?? null;
      });
      const service = new MarketService({ prisma: fake.prisma });

      const result = await service.calculateP0FromClassification(
        "s1",
        standings3,
        meta,
      );

      // Riders: pos 1 → 30, pos 2 → 20, pos 3 → 10.
      expect(result).toMatchObject({
        ridersPriced: 3,
        teamsPriced: 2,
        constructorsPriced: 2,
        maxPrice: 30,
        minPrice: 10,
      });
      // P0 de riders.
      const riderCreates = fake.price.create.mock.calls
        .map((call) => call[0].data)
        .filter((d) => d.assetType === "rider");
      expect(riderCreates).toEqual([
        expect.objectContaining({ assetId: "r1", price: 30, reason: "formula" }),
        expect.objectContaining({ assetId: "r2", price: 20, reason: "formula" }),
        expect.objectContaining({ assetId: "r3", price: 10, reason: "formula" }),
      ]);
      // P0 de equipos (media de sus riders): Team A = (30+20)/2 = 25, Team B = 10.
      const teamCreates = fake.price.create.mock.calls
        .map((call) => call[0].data)
        .filter((d) => d.assetType === "team");
      expect(teamCreates).toEqual([
        expect.objectContaining({ assetId: "t1", price: 25 }),
        expect.objectContaining({ assetId: "t2", price: 10 }),
      ]);
      // P0 de constructores: Ctor A = 25, Ctor B = 10.
      const ctorCreates = fake.price.create.mock.calls
        .map((call) => call[0].data)
        .filter((d) => d.assetType === "constructor");
      expect(ctorCreates).toEqual([
        expect.objectContaining({ assetId: "c1", price: 25 }),
        expect.objectContaining({ assetId: "c2", price: 10 }),
      ]);
      // Auditoría `price.p0_heuristic` con resumen (los campos van en `data`).
      expect(fake.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "price.p0_heuristic",
            afterData: expect.objectContaining({
              ridersPriced: 3,
              teamsPriced: 2,
              constructorsPriced: 2,
            }),
          }),
        }),
      );
    },
  );

  it("rider sin afiliación → su P0 se fija pero no cuenta para equipo/constructor", async () => {
    const fake = makePrisma();
    fake.season.findUnique.mockResolvedValue(seasonRow);
    fake.rider.findUnique.mockImplementation(async ({ where }) => {
      const byName = new Map([
        ["Rider One", { id: "r1", name: "Rider One" }],
        ["Rider Two", { id: "r2", name: "Rider Two" }],
      ]);
      return byName.get(where.name) ?? null;
    });
    fake.price.findFirst.mockResolvedValue(null);
    fake.price.create.mockResolvedValue({ id: "p1" });
    // Solo r1 tiene afiliación; r2 no.
    fake.riderAffiliation.findFirst.mockImplementation(async ({ where }) => {
      if (where.riderId === "r1") return { teamId: "t1", constructorId: "c1" };
      return null;
    });
    const service = new MarketService({ prisma: fake.prisma });

    const result = await service.calculateP0FromClassification(
      "s1",
      [standings3[0]!, standings3[1]!],
      meta,
    );

    expect(result).toMatchObject({
      ridersPriced: 2,
      teamsPriced: 1,
      constructorsPriced: 1,
    });
    // Team A solo cuenta r1 (30) → P0 = 30 (no la media de 30 y 20).
    const teamCreates = fake.price.create.mock.calls
      .map((call) => call[0].data)
      .filter((d) => d.assetType === "team");
    expect(teamCreates).toEqual([
      expect.objectContaining({ assetId: "t1", price: 30 }),
    ]);
  });

  it("P0 existente con otro valor → se actualiza (no se duplica)", async () => {
    const fake = makePrisma();
    fake.season.findUnique.mockResolvedValue(seasonRow);
    fake.rider.findUnique.mockImplementation(async ({ where }) => {
      const byName = new Map([["Rider One", { id: "r1", name: "Rider One" }]]);
      return byName.get(where.name) ?? null;
    });
    // P0 existente con otro valor.
    fake.price.findFirst.mockResolvedValue({ id: "p1", price: 15 });
    fake.price.update.mockResolvedValue({ id: "p1" });
    fake.riderAffiliation.findFirst.mockResolvedValue(null);
    const service = new MarketService({ prisma: fake.prisma });

    const result = await service.calculateP0FromClassification(
      "s1",
      [standings3[0]!],
      meta,
    );

    expect(result).toMatchObject({ ridersPriced: 1 });
    // Se actualiza (no se crea).
    expect(fake.price.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ price: 30, reason: "formula" }),
      }),
    );
    expect(fake.price.create).not.toHaveBeenCalled();
  });
});
