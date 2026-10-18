/**
 * Tests de `GpService` (US-05, T-24): las ramas defensivas que la suite de
 * integración no recorre — violaciones de unique concurrentes (P2002),
 * errores no-P2002 (re-lanzados), NOT_FOUND y revalidación del calendario
 * server-side.
 *
 * `prisma` se inyecta (DI) como un objeto falso: cada método es un
 * `vi.fn()` y `$transaction(fn)` ejecuta `fn` con el propio objeto como
 * `tx` (los tests no necesitan una BD real).
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import type { NormalizedSeasonCalendar } from "@/shared/validation/seasons";

import { GpService } from "../gp-service";
import type { AuditMeta } from "../season-service";

const meta: AuditMeta = { actorId: "admin-1", ip: "127.0.0.1" };

/** Prisma falso: los métodos son `vi.fn()` independientes; `tx` = el propio objeto. */
function makePrisma() {
  const circuit = {
    findUnique: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  };
  const season = { findUnique: vi.fn(), create: vi.fn() };
  const gp = {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const weekendEvent = { findFirst: vi.fn(), create: vi.fn() };
  const auditLog = { create: vi.fn() };
  const prisma = {
    circuit,
    season,
    gp,
    weekendEvent,
    auditLog,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    circuit,
    season,
    gp,
    weekendEvent,
    auditLog,
  };
}

const P2002 = { code: "P2002" };

describe("GpService.createCircuit (T-24)", () => {
  it("P2002 (creación concurrente) → reutiliza el existente sin auditar", async () => {
    const fake = makePrisma();
    const row = { id: "c1", name: "Jerez", country: "España", location: null };
    // Primera consulta: aún no existe; tras el P2002: ya existe (la ganó el otro).
    fake.circuit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row);
    fake.circuit.create.mockRejectedValueOnce(P2002);
    const service = new GpService({ prisma: fake.prisma });

    const result = await service.createCircuit(
      { name: "Jerez", country: "España" },
      meta,
    );

    expect(result).toMatchObject({ id: "c1", created: false });
    // Reutilizar no se audita (solo la creación nueva).
    expect(fake.auditLog.create).not.toHaveBeenCalled();
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.circuit.findUnique.mockResolvedValue(null);
    const boom = new Error("caída de BD");
    fake.circuit.create.mockRejectedValue(boom);
    const service = new GpService({ prisma: fake.prisma });

    await expect(
      service.createCircuit({ name: "Jerez", country: "España" }, meta),
    ).rejects.toBe(boom);
  });
});

describe("GpService.createGp (T-24)", () => {
  const input = {
    seasonId: "s1",
    round: 2,
    name: "GP de Francia",
    circuitId: "c1",
    date: new Date("2026-05-31T14:00:00Z"),
    events: [{ type: "q2" as const }, { type: "race" as const }],
  };

  it("P2002 (misma ronda concurrente) → CONFLICT con la ronda y la temporada", async () => {
    const fake = makePrisma();
    fake.season.findUnique.mockResolvedValue({
      id: "s1",
      name: "Temporada 2026",
      year: 2026,
    });
    fake.circuit.findUnique.mockResolvedValue({ id: "c1" });
    fake.gp.findUnique.mockResolvedValue(null); // pre-consulta: ronda libre
    fake.gp.create.mockRejectedValue(P2002);
    const service = new GpService({ prisma: fake.prisma });

    await expect(service.createGp(input, meta)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "La ronda 2 ya está usada en la temporada Temporada 2026.",
    });
  });

  it("error no-P2002 → se re-lanza (no se traga)", async () => {
    const fake = makePrisma();
    fake.season.findUnique.mockResolvedValue({
      id: "s1",
      name: "Temporada 2026",
      year: 2026,
    });
    fake.circuit.findUnique.mockResolvedValue({ id: "c1" });
    fake.gp.findUnique.mockResolvedValue(null);
    const boom = new Error("caída de BD");
    fake.gp.create.mockRejectedValue(boom);
    const service = new GpService({ prisma: fake.prisma });

    await expect(service.createGp(input, meta)).rejects.toBe(boom);
  });
});

describe("GpService.getGp (T-24)", () => {
  it("ordena los eventos por tipo canónico y, en empate, por orderNum", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue({
      id: "gp1",
      seasonId: "s1",
      round: 1,
      name: "GP de España",
      circuitId: "c1",
      date: new Date("2026-04-19T14:00:00Z"),
      status: "scheduled",
      lockoutAt: null,
      circuit: { id: "c1", name: "Jerez", country: "España", location: null },
      // Dos eventos del mismo tipo (carrera reiniciada): el sort debe
      // desempatar por orderNum (1 antes que 2).
      weekendEvents: [
        {
          id: "e2",
          gpId: "gp1",
          type: "race",
          orderNum: 2,
          startTime: null,
          status: "scheduled",
        },
        {
          id: "e1",
          gpId: "gp1",
          type: "race",
          orderNum: 1,
          startTime: null,
          status: "scheduled",
        },
        {
          id: "e0",
          gpId: "gp1",
          type: "q2",
          orderNum: 1,
          startTime: null,
          status: "scheduled",
        },
      ],
    });
    const service = new GpService({ prisma: fake.prisma });

    const gp = await service.getGp("gp1");

    expect(gp.events.map((event) => event.id)).toEqual(["e0", "e1", "e2"]);
  });
});

describe("GpService — NOT_FOUND (T-24)", () => {
  it("updateGpStatus: GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new GpService({ prisma: fake.prisma });

    await expect(
      service.updateGpStatus({ gpId: "gp-x", status: "locked" }, meta),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });

  it("updateGpLockout: GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new GpService({ prisma: fake.prisma });

    await expect(
      service.updateGpLockout({ gpId: "gp-x", lockoutAt: null }, meta),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });
});

describe("GpService.importCalendar (T-24)", () => {
  it("calendario inválido → BAD_REQUEST antes de tocar BD", async () => {
    const fake = makePrisma();
    const service = new GpService({ prisma: fake.prisma });

    await expect(
      service.importCalendar(
        {
          seasonId: "s1",
          calendar: { year: 2026 } as unknown as NormalizedSeasonCalendar,
        },
        meta,
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/Calendario no válido/),
    });
    // La revalidación es la primera barrera: no se consultó nada.
    expect(fake.season.findUnique).not.toHaveBeenCalled();
  });
});
