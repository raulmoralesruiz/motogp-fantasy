/**
 * Tests de `PriceService` (US-07, T-24): las ramas defensivas que la suite
 * de integración no recorre — creación concurrente de P0 (P2002), errores
 * no-P2002 (re-lanzados), NOT_FOUND por tipo de activo y los caminos
 * no-op/sustitución del upsert auditado.
 *
 * `prisma` se inyecta (DI) como un objeto falso: cada método es un
 * `vi.fn()` y `$transaction(fn)` ejecuta `fn` con el propio objeto como
 * `tx` (los tests no necesitan una BD real).
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { PriceService } from "../price-service";

const meta = { actorId: "admin-1", ip: "127.0.0.1" };

/** Prisma falso: los métodos son `vi.fn()` independientes; `tx` = el propio objeto. */
function makePrisma() {
  const rider = { findUnique: vi.fn(), findMany: vi.fn() };
  const constructor = { findUnique: vi.fn(), findMany: vi.fn() };
  const team = { findUnique: vi.fn(), findMany: vi.fn() };
  const price = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const auditLog = { create: vi.fn() };
  const gp = { findUnique: vi.fn(), findMany: vi.fn() };
  const weekendEvent = { findFirst: vi.fn() };
  const result = { count: vi.fn(), findMany: vi.fn() };
  const riderAffiliation = { findMany: vi.fn(), findFirst: vi.fn() };
  const lineupSlot = { findMany: vi.fn() };
  const seasonRule = { findFirst: vi.fn() };
  const prisma = {
    rider,
    constructor,
    team,
    price,
    auditLog,
    gp,
    weekendEvent,
    result,
    riderAffiliation,
    lineupSlot,
    seasonRule,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    rider,
    constructor,
    team,
    price,
    auditLog,
    gp,
    weekendEvent,
    result,
    riderAffiliation,
    lineupSlot,
    seasonRule,
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
const teamRow = { id: "t1", name: "Ducati Lenovo Team", constructorId: "c1" };
const p0Row = {
  id: "p0",
  assetType: "rider",
  assetId: "r1",
  gpId: null,
  price: 20,
  reason: "manual",
  rulesVersion: null,
  createdBy: "admin-1",
  createdAt: new Date("2026-09-01T09:00:00Z"),
};
const gp1Row = {
  id: "p1",
  assetType: "rider",
  assetId: "r1",
  gpId: "g1",
  price: 22,
  reason: "formula",
  rulesVersion: "pricing-v1",
  createdBy: null,
  createdAt: new Date("2026-06-01T09:00:00Z"),
  gp: { round: 1, name: "GP de Qatar" },
};
const gp3Row = {
  id: "p3",
  assetType: "rider",
  assetId: "r1",
  gpId: "g3",
  price: 19,
  reason: "formula",
  rulesVersion: "pricing-v1",
  createdBy: null,
  createdAt: new Date("2026-07-01T09:00:00Z"),
  gp: { round: 3, name: "GP de España" },
};

// ── Fixtures US-08 (fórmula + manual) ──
const gpRow1 = {
  id: "g1",
  seasonId: "s1",
  round: 1,
  name: "GP de Qatar",
  status: "finished",
};
const gpRow2 = {
  id: "g2",
  seasonId: "s1",
  round: 2,
  name: "GP de Argentina",
  status: "scheduled",
};
const raceEvent1 = { id: "e1", gpId: "g1", type: "race", orderNum: 2 };
/** Resultados definitivos de la carrera de g1: r1 gana (30 pts), r2 2º (20). */
const definitiveResults = [
  { riderId: "r1", position: 1 },
  { riderId: "r2", position: 2 },
];
const affiliationsG1 = [
  { riderId: "r1", constructorId: "c1", teamId: "t1", gpId: "g1" },
  { riderId: "r2", constructorId: "c1", teamId: "t1", gpId: "g1" },
];
/** Grid del GP objetivo g2: mismos activos (r3 entra para probar el skip sin P0). */
const affiliationsG2 = [
  { riderId: "r1", constructorId: "c1", teamId: "t1", gpId: "g2" },
  { riderId: "r2", constructorId: "c1", teamId: "t1", gpId: "g2" },
  { riderId: "r3", constructorId: "c1", teamId: "t1", gpId: "g2" },
];
/** P0 de los activos del escenario (r3 queda sin P0 para probar el skip). */
const p0Rows = [
  { assetType: "rider", assetId: "r1", price: 20 },
  { assetType: "rider", assetId: "r2", price: 15 },
  { assetType: "constructor", assetId: "c1", price: 10 },
  { assetType: "team", assetId: "t1", price: 8 },
];
/**
 * Monta el escenario base de `applyFormulaForGp`: g1 (ronda 1) con carrera
 * definitiva, g2 (ronda 2) como objetivo, P0 para 4 activos y r3 sin P0.
 * `nextGp` permite simular el GP objetivo (null = no existe; locked = gate).
 */
function mountFormulaScenario(
  fake: ReturnType<typeof makePrisma>,
  nextGp: typeof gpRow2 | null,
) {
  fake.gp.findUnique.mockImplementation(
    ({ where }: { where: Record<string, unknown> }) => {
      if (where.id === "g1") return Promise.resolve(gpRow1);
      if (where.seasonId_round) return Promise.resolve(nextGp);
      return Promise.resolve(null);
    },
  );
  fake.gp.findMany.mockResolvedValue([gpRow1]);
  fake.weekendEvent.findFirst.mockImplementation(
    ({ where }: { where: { gpId: string } }) =>
      Promise.resolve(where.gpId === "g1" ? raceEvent1 : null),
  );
  fake.result.count.mockResolvedValue(definitiveResults.length);
  fake.result.findMany.mockResolvedValue(definitiveResults);
  // Reglas de la temporada (Pmax — T-25).
  fake.seasonRule.findFirst.mockResolvedValue({
    id: "sr1",
    seasonId: "s1",
    version: "provisional-v1",
    rules: {
      rulesVersion: "provisional-v1",
      economy: { option: "E", B: 100, t: 0.25, cmax: 8 },
      pricing: { pmaxRider: 30, pmaxGroup: 30 },
      scoring: {
        q2: { "1": 12, "2": 8, "3": 8, "4": 5, "5": 5, "6": 5, "7": 3, "8": 3, "9": 3, "10": 3, "11": 3, "12": 3, "13": 1, "14": 1, "15": 1, "16": 1, "17": 1, "18": 1, "19": 1, "20": 1 },
        sprint: { "1": 12, "2": 9, "3": 7, "4": 6, "5": 5, "6": 4, "7": 3, "8": 2, "9": 1 },
        mainRace: { "1": 25, "2": 20, "3": 16, "4": 13, "5": 11, "6": 10, "7": 9, "8": 8, "9": 7, "10": 6, "11": 5, "12": 4, "13": 3, "14": 2, "15": 1 },
        winnerBonus: 5,
        fastestLapBonus: 3,
        poleBonus: 2,
        positionsGainedBonus: 1,
        positionsGainedMax: 3,
        extraordinaryBonus: 5,
        dnfPenalty: 5,
        dqPenalty: 10,
        timePenalty: 2,
        goldWeight: 1.0,
        silverWeight: 0.5,
      },
      limits: { maxPerConstructor: 2, maxPerTeam: 2 },
      transfers: { perGp: 2, injuryExemption: true, wildcardsPerSeason: 1 },
      league: { minMembers: 2, maxMembers: 50 },
    },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  // Dos llamadas: afiliaciones de los GPs fuente (gpId: { in: [...] }) y
  // grid del GP objetivo (gpId: "g2").
  fake.riderAffiliation.findMany.mockImplementation(
    ({ where }: { where: { gpId: unknown } }) =>
      Promise.resolve(where.gpId === "g2" ? affiliationsG2 : affiliationsG1),
  );
  fake.price.findMany.mockImplementation(
    ({ where }: { where: { gpId: string | null } }) => {
      if (where.gpId === null) {
        return Promise.resolve(
          p0Rows.map((p, i) => ({ id: `p0-${i}`, ...p, gpId: null })),
        );
      }
      return Promise.resolve([]);
    },
  );
}

describe("PriceService.setOpeningPrice (US-07)", () => {
  it("crea el P0 si no existe (auditoría price.opening_set con before=null)", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findFirst.mockResolvedValue(null);
    fake.price.create.mockResolvedValue(p0Row);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setOpeningPrice(
      { assetType: "rider", assetId: "r1", price: 20 },
      meta,
    );

    expect(result).toEqual({ price: 20, status: "created" });
    expect(fake.price.create).toHaveBeenCalledWith({
      data: {
        assetType: "rider",
        assetId: "r1",
        gpId: null,
        price: 20,
        reason: "manual",
        rulesVersion: null,
        createdBy: "admin-1",
      },
    });
    expect(fake.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "price.opening_set",
        entity: "price",
        entityId: "p0",
        beforeData: undefined,
        afterData: { assetType: "rider", assetId: "r1", price: 20 },
        ip: "127.0.0.1",
      },
    });
  });

  it("no-op sin auditar si existe con el mismo valor", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findFirst.mockResolvedValue(p0Row);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setOpeningPrice(
      { assetType: "rider", assetId: "r1", price: 20 },
      meta,
    );

    expect(result).toEqual({ price: 20, status: "unchanged" });
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.price.create).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("sustituye con auditoría before/after si existe con otro valor", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findFirst.mockResolvedValue({ ...p0Row, price: 18 });
    fake.price.update.mockResolvedValue({ ...p0Row, price: 20 });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setOpeningPrice(
      { assetType: "rider", assetId: "r1", price: 20 },
      meta,
    );

    expect(result).toEqual({ price: 20, status: "updated" });
    expect(fake.price.update).toHaveBeenCalledWith({
      where: { id: "p0" },
      data: { price: 20, reason: "manual", createdBy: "admin-1" },
    });
    expect(fake.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "price.opening_set",
        entity: "price",
        entityId: "p0",
        beforeData: { price: 18 },
        afterData: { assetType: "rider", assetId: "r1", price: 20 },
        ip: "127.0.0.1",
      },
    });
  });

  it("P2002 (creación concurrente) → re-ejecuta y sustituye si el valor difiere", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findFirst
      .mockResolvedValueOnce(null) // 1ª tx: aún no existe → intenta crear
      .mockResolvedValueOnce({ ...p0Row, price: 15 }); // 2ª tx: ya existe
    fake.price.create.mockRejectedValueOnce(P2002);
    fake.price.update.mockResolvedValue({ ...p0Row, price: 20 });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setOpeningPrice(
      { assetType: "rider", assetId: "r1", price: 20 },
      meta,
    );

    expect(result).toEqual({ price: 20, status: "updated" });
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(fake.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("P2002 (creación concurrente) → re-ejecuta y no-op si el valor coincide", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(p0Row); // 2ª tx: ya existe, mismo valor
    fake.price.create.mockRejectedValueOnce(P2002);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setOpeningPrice(
      { assetType: "rider", assetId: "r1", price: 20 },
      meta,
    );

    expect(result).toEqual({ price: 20, status: "unchanged" });
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findFirst.mockResolvedValue(null);
    const err = boom();
    fake.price.create.mockRejectedValueOnce(err);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.setOpeningPrice({ assetType: "rider", assetId: "r1", price: 20 }, meta),
    ).rejects.toBe(err);
  });

  it("piloto inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.setOpeningPrice({ assetType: "rider", assetId: "nope", price: 20 }, meta),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El piloto no existe.",
    });
  });

  it("constructor inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.constructor.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.setOpeningPrice({ assetType: "constructor", assetId: "nope", price: 20 }, meta),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El constructor no existe.",
    });
  });

  it("equipo inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.team.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.setOpeningPrice({ assetType: "team", assetId: "nope", price: 20 }, meta),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El equipo no existe.",
    });
  });
});

describe("PriceService.listAssetPrices (US-07)", () => {
  it("pilotos con y sin P0, unidos por assetId", async () => {
    const fake = makePrisma();
    const otroRider = { id: "r2", name: "Marc Márquez", number: 93, isActive: true };
    fake.rider.findMany.mockResolvedValue([riderRow, otroRider]);
    fake.price.findMany.mockResolvedValue([p0Row]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listAssetPrices({ assetType: "rider" });

    expect(result).toEqual([
      { assetId: "r1", name: "Francesco Bagnaia", openingPrice: 20 },
      { assetId: "r2", name: "Marc Márquez", openingPrice: null },
    ]);
    expect(fake.price.findMany).toHaveBeenCalledWith({
      where: { assetType: "rider", gpId: null },
    });
  });

  it("constructores sin P0 → openingPrice null", async () => {
    const fake = makePrisma();
    fake.constructor.findMany.mockResolvedValue([constructorRow]);
    fake.price.findMany.mockResolvedValue([]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listAssetPrices({ assetType: "constructor" });

    expect(result).toEqual([
      { assetId: "c1", name: "Ducati", openingPrice: null },
    ]);
  });

  it("equipos con P0 decimal", async () => {
    const fake = makePrisma();
    fake.team.findMany.mockResolvedValue([teamRow]);
    fake.price.findMany.mockResolvedValue([{ ...p0Row, assetType: "team", assetId: "t1", price: 12.5 }]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listAssetPrices({ assetType: "team" });

    expect(result).toEqual([
      { assetId: "t1", name: "Ducati Lenovo Team", openingPrice: 12.5 },
    ]);
  });
});

describe("PriceService.getPriceHistory (US-07)", () => {
  it("ordena P0 → ronda y mapea a la vista", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findMany.mockResolvedValue([gp3Row, p0Row, gp1Row]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.getPriceHistory({
      assetType: "rider",
      assetId: "r1",
    });

    expect(result).toEqual([
      {
        id: "p0",
        gpRound: null,
        gpName: null,
        price: 20,
        reason: "manual",
        createdAt: new Date("2026-09-01T09:00:00Z"),
      },
      {
        id: "p1",
        gpRound: 1,
        gpName: "GP de Qatar",
        price: 22,
        reason: "formula",
        createdAt: new Date("2026-06-01T09:00:00Z"),
      },
      {
        id: "p3",
        gpRound: 3,
        gpName: "GP de España",
        price: 19,
        reason: "formula",
        createdAt: new Date("2026-07-01T09:00:00Z"),
      },
    ]);
  });

  it("activo sin precios → lista vacía", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.price.findMany.mockResolvedValue([]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.getPriceHistory({
      assetType: "rider",
      assetId: "r1",
    });

    expect(result).toEqual([]);
  });

  it("activo inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.getPriceHistory({ assetType: "rider", assetId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PriceService.applyFormulaForGp (US-08)", () => {
  it("crea las filas del GP siguiente con la fórmula pricing-v1", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, gpRow2);
    fake.price.create.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: "new", ...(data as object) }),
    );
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    // Calibración D-02 (PMAX_RIDER=30): r1: P0=20, perf(30,30)=100 → 20
    // · r2: P0=15, perf(20,30)=66,67 → 14.38 · c1/t1: media top-2 (30,20)=25 →
    // perf(25,30)=83,33 → 9.79 / 7.83 · r3: sin P0
    expect(result).toEqual({
      targetGpId: "g2",
      targetGpRound: 2,
      created: 4,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 1,
      skippedLocked: false,
    });
    const created = fake.price.create.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(created).toContainEqual({
      assetType: "rider",
      assetId: "r1",
      gpId: "g2",
      price: 20,
      reason: "formula",
      rulesVersion: "pricing-v1",
      createdBy: null,
    });
    expect(created).toContainEqual({
      assetType: "rider",
      assetId: "r2",
      gpId: "g2",
      price: 14.38,
      reason: "formula",
      rulesVersion: "pricing-v1",
      createdBy: null,
    });
    expect(created).toContainEqual({
      assetType: "constructor",
      assetId: "c1",
      gpId: "g2",
      price: 9.79,
      reason: "formula",
      rulesVersion: "pricing-v1",
      createdBy: null,
    });
    expect(created).toContainEqual({
      assetType: "team",
      assetId: "t1",
      gpId: "g2",
      price: 7.83,
      reason: "formula",
      rulesVersion: "pricing-v1",
      createdBy: null,
    });
    // La fórmula no audita: la fila con rulesVersion es el registro.
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("P2002 (creación concurrente) → re-ejecuta la transacción", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, gpRow2);
    fake.price.create.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve({ id: "new", ...(data as object) }),
    );
    fake.price.create.mockRejectedValueOnce(P2002);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    expect(result).toEqual({
      targetGpId: "g2",
      targetGpRound: 2,
      created: 4,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 1,
      skippedLocked: false,
    });
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("idempotente: filas existentes con el mismo valor → no-op", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, gpRow2);
    fake.price.findMany.mockImplementation(
      ({ where }: { where: { gpId: string | null } }) => {
        if (where.gpId === null) {
          return Promise.resolve(
            p0Rows.map((p, i) => ({ id: `p0-${i}`, ...p, gpId: null })),
          );
        }
        if (where.gpId === "g2") {
          // Mismos valores que produce la fórmula (calibración D-02) → todo no-op.
          return Promise.resolve([
            { id: "x1", assetType: "rider", assetId: "r1", gpId: "g2", price: 20 },
            { id: "x2", assetType: "rider", assetId: "r2", gpId: "g2", price: 14.38 },
            { id: "x3", assetType: "constructor", assetId: "c1", gpId: "g2", price: 9.79 },
            { id: "x4", assetType: "team", assetId: "t1", gpId: "g2", price: 7.83 },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    expect(result).toEqual({
      targetGpId: "g2",
      targetGpRound: 2,
      created: 0,
      updated: 0,
      unchanged: 4,
      skippedNoOpening: 1,
      skippedLocked: false,
    });
    expect(fake.price.create).not.toHaveBeenCalled();
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("corrección: fila existente con otro valor → update + auditoría (sistema)", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, gpRow2);
    fake.price.findMany.mockImplementation(
      ({ where }: { where: { gpId: string | null } }) => {
        if (where.gpId === null) {
          return Promise.resolve(
            p0Rows.map((p, i) => ({ id: `p0-${i}`, ...p, gpId: null })),
          );
        }
        if (where.gpId === "g2") {
          // Solo r1 existe, con un valor antiguo (resultados corregidos).
          return Promise.resolve([
            { id: "x1", assetType: "rider", assetId: "r1", gpId: "g2", price: 21 },
          ]);
        }
        if (where.gpId === "g1") {
          // Precio previo en el GP fuente (ajuste manual): prev = 20 = P0 de r1.
          return Promise.resolve([
            { id: "g1-r1", assetType: "rider", assetId: "r1", gpId: "g1", price: 20 },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    fake.price.update.mockResolvedValue({ id: "x1" });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    expect(result).toEqual({
      targetGpId: "g2",
      targetGpRound: 2,
      created: 3,
      updated: 1,
      unchanged: 0,
      skippedNoOpening: 1,
      skippedLocked: false,
    });
    expect(fake.price.update).toHaveBeenCalledWith({
      where: { id: "x1" },
      data: {
        price: 20,
        reason: "formula",
        rulesVersion: "pricing-v1",
        createdBy: null,
      },
    });
    expect(fake.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: "price.formula_recompute",
        entity: "price",
        entityId: "x1",
        beforeData: { price: 21 },
        afterData: {
          assetType: "rider",
          assetId: "r1",
          gpId: "g2",
          price: 20,
        },
        ip: undefined,
      },
    });
  });

  it("gate de lockout: GP objetivo locked → no se toca nada", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, { ...gpRow2, status: "locked" });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    expect(result).toEqual({
      targetGpId: "g2",
      targetGpRound: 2,
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 0,
      skippedLocked: true,
    });
    expect(fake.price.create).not.toHaveBeenCalled();
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("sin siguiente GP (último de la temporada) → no-op con targetGpId null", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, null);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    expect(result).toEqual({
      targetGpId: null,
      targetGpRound: null,
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 0,
      skippedLocked: false,
    });
    expect(fake.price.create).not.toHaveBeenCalled();
  });

  it("GP objetivo sin grid (sin afiliaciones) → no-op", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, gpRow2);
    fake.riderAffiliation.findMany.mockImplementation(
      ({ where }: { where: { gpId: unknown } }) =>
        Promise.resolve(where.gpId === "g2" ? [] : affiliationsG1),
    );
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.applyFormulaForGp({ gpId: "g1" });

    expect(result).toEqual({
      targetGpId: "g2",
      targetGpRound: 2,
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 0,
      skippedLocked: false,
    });
    expect(fake.price.create).not.toHaveBeenCalled();
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("GP sin resultados definitivos → PRECONDITION_FAILED", async () => {
    const fake = makePrisma();
    mountFormulaScenario(fake, gpRow2);
    fake.result.count.mockResolvedValue(0);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.applyFormulaForGp({ gpId: "g1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fake.price.create).not.toHaveBeenCalled();
  });

  it("GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.applyFormulaForGp({ gpId: "nope" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });
});

describe("PriceService.setManualPrice (US-08)", () => {
  const input = { assetType: "rider" as const, assetId: "r1", gpId: "g1", price: 21 };

  it("crea la fila manual (auditoría price.manual_set, before=null)", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.gp.findUnique.mockResolvedValue(gpRow1);
    fake.price.findFirst.mockResolvedValue(null);
    fake.price.create.mockResolvedValue({ id: "m1" });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setManualPrice(input, meta);

    expect(result).toEqual({ price: 21, status: "created" });
    expect(fake.price.create).toHaveBeenCalledWith({
      data: {
        assetType: "rider",
        assetId: "r1",
        gpId: "g1",
        price: 21,
        reason: "manual",
        rulesVersion: null,
        createdBy: "admin-1",
      },
    });
    expect(fake.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "price.manual_set",
        entity: "price",
        entityId: "m1",
        beforeData: undefined,
        afterData: { assetType: "rider", assetId: "r1", gpId: "g1", price: 21 },
        ip: "127.0.0.1",
      },
    });
  });

  it("no-op sin auditar si existe con el mismo valor", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.gp.findUnique.mockResolvedValue(gpRow1);
    fake.price.findFirst.mockResolvedValue({ id: "m1", price: 21 });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setManualPrice(input, meta);

    expect(result).toEqual({ price: 21, status: "unchanged" });
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("sustituye con auditoría before/after si existe con otro valor", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.gp.findUnique.mockResolvedValue(gpRow1);
    fake.price.findFirst.mockResolvedValue({ id: "m1", price: 19 });
    fake.price.update.mockResolvedValue({ id: "m1" });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setManualPrice(input, meta);

    expect(result).toEqual({ price: 21, status: "updated" });
    expect(fake.price.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: {
        price: 21,
        reason: "manual",
        rulesVersion: null,
        createdBy: "admin-1",
      },
    });
    expect(fake.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-1",
        action: "price.manual_set",
        entity: "price",
        entityId: "m1",
        beforeData: { price: 19 },
        afterData: { assetType: "rider", assetId: "r1", gpId: "g1", price: 21 },
        ip: "127.0.0.1",
      },
    });
  });

  it("P2002 (creación concurrente) → re-ejecuta la transacción", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.gp.findUnique.mockResolvedValue(gpRow1);
    fake.price.findFirst
      .mockResolvedValueOnce(null) // 1ª tx: aún no existe → intenta crear
      .mockResolvedValueOnce({ id: "m1", price: 21 }); // 2ª tx: ya existe (mismo valor)
    fake.price.create.mockRejectedValueOnce(P2002);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.setManualPrice(input, meta);

    expect(result).toEqual({ price: 21, status: "unchanged" });
    expect(fake.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("gate de lockout: GP locked → PRECONDITION_FAILED sin tocar la BD", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.gp.findUnique.mockResolvedValue({ ...gpRow1, status: "locked" });
    const service = new PriceService({ prisma: fake.prisma });

    await expect(service.setManualPrice(input, meta)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "No se pueden cambiar los precios de un GP en lockout.",
    });
    expect(fake.price.findFirst).not.toHaveBeenCalled();
    expect(fake.price.create).not.toHaveBeenCalled();
    expect(fake.price.update).not.toHaveBeenCalled();
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(riderRow);
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(service.setManualPrice(input, meta)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("activo inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.rider.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(service.setManualPrice(input, meta)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El piloto no existe.",
    });
  });
});

// ── Exploración del mercado (US-14) ──────────────────────────────────────────

/**
 * Escenario base de `listMarket`/`marketDetail` (US-14): 3 riders (r1 con
 * afiliación c1/t1, r2 con c2/t2, r3 sin afiliación), precios P0 + J1 + J3
 * para r1 y r2 (r3 sin precios) y lineups L1 (r1+r2) y L2 (r1) del GP g3.
 */
const RIDERS_LIST = [
  riderRow, // r1 "Francesco Bagnaia"
  { id: "r2", name: "Marc Márquez", number: 93, isActive: true },
  { id: "r3", name: "Sin Afiliación", number: 7, isActive: true },
];
const PRICES_LIST = [
  { ...p0Row, assetId: "r1" },
  { ...gp1Row, assetId: "r1" },
  { ...gp3Row, assetId: "r1" },
  { ...p0Row, id: "p0-r2", assetId: "r2", price: 15 },
  { ...gp1Row, id: "p1-r2", assetId: "r2", price: 14 },
  { ...gp3Row, id: "p3-r2", assetId: "r2", price: 25 },
];
const SLOTS_G3 = [
  { assetId: "r1", lineupId: "L1" },
  { assetId: "r2", lineupId: "L1" },
  { assetId: "r1", lineupId: "L2" },
];
const AFFILIATIONS_G3 = [
  { riderId: "r1", constructorId: "c1", teamId: "t1", gpId: "g3" },
  { riderId: "r2", constructorId: "c2", teamId: "t2", gpId: "g3" },
];
const CONSTRUCTORS_LIST = [
  { id: "c1", name: "Ducati" },
  { id: "c2", name: "Repsol" },
];
const TEAMS_LIST = [
  { id: "t1", name: "Ducati Lenovo", constructorId: "c1" },
  { id: "t2", name: "Repsol Honda", constructorId: "c2" },
];

function mountMarketScenario(fake: ReturnType<typeof makePrisma>) {
  fake.gp.findUnique.mockResolvedValue({
    id: "g3",
    seasonId: "s1",
    round: 3,
    name: "GP de España",
    status: "scheduled",
  });
  fake.rider.findMany.mockResolvedValue(RIDERS_LIST);
  fake.price.findMany.mockResolvedValue(PRICES_LIST);
  fake.lineupSlot.findMany.mockResolvedValue(SLOTS_G3);
  fake.riderAffiliation.findMany.mockResolvedValue(AFFILIATIONS_G3);
  fake.constructor.findMany.mockResolvedValue(CONSTRUCTORS_LIST);
  fake.team.findMany.mockResolvedValue(TEAMS_LIST);
}

describe("PriceService.listMarket (US-14)", () => {
  it("precio del GP, tendencia, mini-histórico, afiliación y popularidad", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({ gpId: "g3", assetType: "rider" });

    expect(result).toEqual([
      {
        assetId: "r1",
        name: "Francesco Bagnaia",
        constructorId: "c1",
        constructorName: "Ducati",
        teamId: "t1",
        teamName: "Ducati Lenovo",
        currentPrice: 19,
        isP0Fallback: false,
        trend: "down",
        miniHistory: [
          { gpId: null, gpRound: null, gpName: null, price: 20 },
          { gpId: "g1", gpRound: 1, gpName: "GP de Qatar", price: 22 },
          { gpId: "g3", gpRound: 3, gpName: "GP de España", price: 19 },
        ],
        popularity: 2,
      },
      {
        assetId: "r2",
        name: "Marc Márquez",
        constructorId: "c2",
        constructorName: "Repsol",
        teamId: "t2",
        teamName: "Repsol Honda",
        currentPrice: 25,
        isP0Fallback: false,
        trend: "up",
        miniHistory: [
          { gpId: null, gpRound: null, gpName: null, price: 15 },
          { gpId: "g1", gpRound: 1, gpName: "GP de Qatar", price: 14 },
          { gpId: "g3", gpRound: 3, gpName: "GP de España", price: 25 },
        ],
        popularity: 1,
      },
      {
        assetId: "r3",
        name: "Sin Afiliación",
        constructorId: null,
        constructorName: null,
        teamId: null,
        teamName: null,
        currentPrice: null,
        isP0Fallback: false,
        trend: "flat",
        miniHistory: [],
        popularity: 0,
      },
    ]);
  });

  it("GP sin precio propio → fallback a P0 (isP0Fallback) y tendencia estable", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({ gpId: "g2", assetType: "rider" });

    const r1 = result.find((r) => r.assetId === "r1");
    expect(r1).toMatchObject({
      currentPrice: 20,
      isP0Fallback: true,
      trend: "flat",
      miniHistory: [
        { gpId: null, gpRound: null, gpName: null, price: 20 },
        { gpId: "g1", gpRound: 1, gpName: "GP de Qatar", price: 22 },
        { gpId: "g3", gpRound: 3, gpName: "GP de España", price: 19 },
      ],
    });
    const r2 = result.find((r) => r.assetId === "r2");
    expect(r2).toMatchObject({ currentPrice: 15, isP0Fallback: true, trend: "flat" });
  });

  it("tendencia sube frente al P0 cuando el GP es el primer punto con precio", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({ gpId: "g1", assetType: "rider" });

    expect(result.find((r) => r.assetId === "r1")).toMatchObject({
      currentPrice: 22,
      isP0Fallback: false,
      trend: "up",
    });
    expect(result.find((r) => r.assetId === "r2")).toMatchObject({
      currentPrice: 14,
      trend: "down",
    });
  });

  it("tendencia estable cuando el precio actual iguala al punto anterior", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    // r1: P0=20, J1=22, J3=22 → actual (J3) = anterior (J1) → estable.
    fake.price.findMany.mockResolvedValue([
      { ...p0Row, assetId: "r1" },
      { ...gp1Row, assetId: "r1" },
      { ...gp3Row, assetId: "r1", price: 22 },
    ]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({ gpId: "g3", assetType: "rider" });

    expect(result.find((r) => r.assetId === "r1")).toMatchObject({
      currentPrice: 22,
      isP0Fallback: false,
      trend: "flat",
    });
  });

  it("filtro por constructor: solo riders afiliados a ese constructor en el GP", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({
      gpId: "g3",
      assetType: "rider",
      constructorId: "c1",
    });

    expect(result.map((r) => r.assetId)).toEqual(["r1"]);
  });

  it("filtro por equipo: solo riders afiliados a ese equipo en el GP", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({
      gpId: "g3",
      assetType: "rider",
      teamId: "t2",
    });

    expect(result.map((r) => r.assetId)).toEqual(["r2"]);
  });

  it("rango de precio (inclusivo) sobre el precio actual; excluye los sin precio", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({
      gpId: "g3",
      assetType: "rider",
      priceMin: 19,
      priceMax: 22,
    });

    expect(result.map((r) => r.assetId)).toEqual(["r1"]);
  });

  it("rango de precio con solo mínimo: excluye el activo sin precio", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({
      gpId: "g3",
      assetType: "rider",
      priceMin: 1,
    });

    expect(result.map((r) => r.assetId)).toEqual(["r1", "r2"]);
  });

  it("priceMin excluye los activos por debajo del mínimo", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({
      gpId: "g3",
      assetType: "rider",
      priceMin: 20,
    });

    // r1 (19) queda por debajo del mínimo; r2 (25) pasa; r3 (sin precio) queda fuera.
    expect(result.map((r) => r.assetId)).toEqual(["r2"]);
  });

  it("mini-histórico limitado a los últimos 8 puntos", async () => {
    const fake = makePrisma();
    mountMarketScenario(fake);
    // 10 puntos para r1: P0 + rondas 1..9 (la ronda 3 ya está en gp3Row).
    const extra = [2, 4, 5, 6, 7, 8, 9].map((round, i) => ({
      id: `px-${round}`,
      assetType: "rider",
      assetId: "r1",
      gpId: `gx-${round}`,
      price: 20 + i,
      reason: "formula",
      rulesVersion: "pricing-v1",
      createdBy: null,
      createdAt: new Date(`2026-0${round + 1}-01T09:00:00Z`),
      gp: { id: `gx-${round}`, round, name: `GP ${round}` },
    }));
    fake.price.findMany.mockResolvedValue([
      ...PRICES_LIST.filter((p) => p.assetId === "r1"),
      ...extra,
    ]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({ gpId: "g3", assetType: "rider" });

    const r1 = result.find((r) => r.assetId === "r1");
    expect(r1?.miniHistory).toHaveLength(8);
    // Los 8 últimos de los 10 puntos (P0 + rondas 1..9): rondas 2..9.
    expect(r1?.miniHistory.map((p) => p.gpRound)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("constructores: sin afiliación y sin consultas de riders", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue({ id: "g3", round: 3, name: "GP de España" });
    fake.constructor.findMany.mockResolvedValue([constructorRow]);
    fake.price.findMany.mockResolvedValue([
      { ...p0Row, id: "p0-c1", assetType: "constructor", assetId: "c1", price: 10 },
      { ...gp3Row, id: "p3-c1", assetType: "constructor", assetId: "c1", price: 12 },
    ]);
    fake.lineupSlot.findMany.mockResolvedValue([
      { assetId: "c1", lineupId: "L1" },
    ]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.listMarket({ gpId: "g3", assetType: "constructor" });

    expect(result).toEqual([
      {
        assetId: "c1",
        name: "Ducati",
        constructorId: null,
        constructorName: null,
        teamId: null,
        teamName: null,
        currentPrice: 12,
        isP0Fallback: false,
        trend: "up",
        miniHistory: [
          { gpId: null, gpRound: null, gpName: null, price: 10 },
          { gpId: "g3", gpRound: 3, gpName: "GP de España", price: 12 },
        ],
        popularity: 1,
      },
    ]);
    // No riders: sin afiliaciones ni nombres de constructores/equipos.
    expect(fake.riderAffiliation.findMany).not.toHaveBeenCalled();
    expect(fake.team.findMany).not.toHaveBeenCalled();
  });

  it("GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.listMarket({ gpId: "nope", assetType: "rider" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });
});

describe("PriceService.marketDetail (US-14)", () => {
  function mountDetailScenario(fake: ReturnType<typeof makePrisma>) {
    fake.gp.findUnique.mockResolvedValue({
      id: "g3",
      seasonId: "s1",
      round: 3,
      name: "GP de España",
      status: "scheduled",
    });
    fake.rider.findUnique.mockResolvedValue(riderRow);
    // Entrada desordenada: el servicio ordena P0 → ronda.
    fake.price.findMany.mockResolvedValue([gp3Row, p0Row, gp1Row]);
    fake.lineupSlot.findMany.mockResolvedValue([
      { lineupId: "L1" },
      { lineupId: "L2" },
    ]);
    fake.riderAffiliation.findFirst.mockResolvedValue({
      riderId: "r1",
      constructorId: "c1",
      teamId: "t1",
      gpId: "g3",
    });
    fake.constructor.findUnique.mockResolvedValue({ id: "c1", name: "Ducati" });
    fake.team.findUnique.mockResolvedValue({
      id: "t1",
      name: "Ducati Lenovo",
      constructorId: "c1",
    });
  }

  it("vista del activo (precio, tendencia, popularidad) + histórico completo", async () => {
    const fake = makePrisma();
    mountDetailScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.marketDetail({
      gpId: "g3",
      assetType: "rider",
      assetId: "r1",
    });

    expect(result.asset).toEqual({
      assetId: "r1",
      name: "Francesco Bagnaia",
      constructorId: "c1",
      constructorName: "Ducati",
      teamId: "t1",
      teamName: "Ducati Lenovo",
      currentPrice: 19,
      isP0Fallback: false,
      trend: "down",
      miniHistory: [
        { gpId: null, gpRound: null, gpName: null, price: 20 },
        { gpId: "g1", gpRound: 1, gpName: "GP de Qatar", price: 22 },
        { gpId: "g3", gpRound: 3, gpName: "GP de España", price: 19 },
      ],
      popularity: 2,
    });
    expect(result.history).toEqual([
      {
        id: "p0",
        gpRound: null,
        gpName: null,
        price: 20,
        reason: "manual",
        createdAt: new Date("2026-09-01T09:00:00Z"),
      },
      {
        id: "p1",
        gpRound: 1,
        gpName: "GP de Qatar",
        price: 22,
        reason: "formula",
        createdAt: new Date("2026-06-01T09:00:00Z"),
      },
      {
        id: "p3",
        gpRound: 3,
        gpName: "GP de España",
        price: 19,
        reason: "formula",
        createdAt: new Date("2026-07-01T09:00:00Z"),
      },
    ]);
  });

  it("GP sin precio propio → fallback a P0 en la vista", async () => {
    const fake = makePrisma();
    mountDetailScenario(fake);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.marketDetail({
      gpId: "g2",
      assetType: "rider",
      assetId: "r1",
    });

    expect(result.asset).toMatchObject({
      currentPrice: 20,
      isP0Fallback: true,
      trend: "flat",
    });
  });

  it("rider sin afiliación en el GP → sin constructor ni equipo", async () => {
    const fake = makePrisma();
    mountDetailScenario(fake);
    fake.riderAffiliation.findFirst.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.marketDetail({
      gpId: "g3",
      assetType: "rider",
      assetId: "r1",
    });

    expect(result.asset).toMatchObject({
      constructorId: null,
      constructorName: null,
      teamId: null,
      teamName: null,
    });
  });

  it("afiliación sin constructor ni equipo (rama defensiva): sin nombres", async () => {
    const fake = makePrisma();
    mountDetailScenario(fake);
    // En BD son no-null (ver schema); la rama defensiva se cubre aquí.
    fake.riderAffiliation.findFirst.mockResolvedValue({
      riderId: "r1",
      constructorId: null,
      teamId: null,
      gpId: "g3",
    });
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.marketDetail({
      gpId: "g3",
      assetType: "rider",
      assetId: "r1",
    });

    expect(result.asset).toMatchObject({
      constructorId: null,
      constructorName: null,
      teamId: null,
      teamName: null,
    });
    // Sin ID, no se consulta constructor ni equipo.
    expect(fake.constructor.findUnique).not.toHaveBeenCalled();
    expect(fake.team.findUnique).not.toHaveBeenCalled();
  });

  it("constructor (no rider): sin afiliación", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue({ id: "g3", round: 3, name: "GP de España" });
    fake.constructor.findUnique.mockResolvedValue(constructorRow);
    fake.price.findMany.mockResolvedValue([
      { ...p0Row, id: "p0-c1", assetType: "constructor", assetId: "c1", price: 10 },
    ]);
    fake.lineupSlot.findMany.mockResolvedValue([]);
    const service = new PriceService({ prisma: fake.prisma });

    const result = await service.marketDetail({
      gpId: "g3",
      assetType: "constructor",
      assetId: "c1",
    });

    expect(result.asset).toMatchObject({
      name: "Ducati",
      constructorName: null,
      teamName: null,
      currentPrice: 10,
      isP0Fallback: true,
      trend: "flat",
      popularity: 0,
    });
    expect(result.history).toHaveLength(1);
    expect(fake.riderAffiliation.findFirst).not.toHaveBeenCalled();
  });

  it("GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.marketDetail({ gpId: "nope", assetType: "rider", assetId: "r1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });

  it("activo inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue({ id: "g3", round: 3, name: "GP de España" });
    fake.rider.findUnique.mockResolvedValue(null);
    const service = new PriceService({ prisma: fake.prisma });

    await expect(
      service.marketDetail({ gpId: "g3", assetType: "rider", assetId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El piloto no existe." });
  });
});
