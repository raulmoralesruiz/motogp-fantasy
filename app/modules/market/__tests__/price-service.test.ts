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
  const prisma = {
    rider,
    constructor,
    team,
    price,
    auditLog,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    rider,
    constructor,
    team,
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
