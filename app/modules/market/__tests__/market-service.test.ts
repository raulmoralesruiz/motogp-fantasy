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
