/**
 * Tests de `LineupService` para US-42 (ADR-0042): la heurística pura
 * `constructorColor` (color de constructor derivado de sus equipos) y el
 * cableado de colores del `builder()`:
 *
 * - rider → color de su EQUIPO afiliado en este GP (`teams.color`);
 * - team → color propio;
 * - constructor → proyección `constructorColor` (no persistida).
 *
 * El `builder` se prueba con `prisma` falso (DI, como en los tests de
 * `MarketService`): cada método es un `vi.fn()`.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { LineupService, constructorColor } from "../lineup-service";

type TeamColorInput = {
  name: string;
  color: string | null;
  textColor: string | null;
  affiliationCount: number;
};

const teamInput = (
  name: string,
  color: string | null,
  affiliationCount = 0,
): TeamColorInput => ({
  name,
  color,
  textColor: color ? "#ffffff" : null,
  affiliationCount,
});

// ── constructorColor (heurística pura, ADR-0042 §2) ─────────────────────────

describe("constructorColor (US-42, ADR-0042)", () => {
  it("coincidencia de nombre case-insensible (CONTIENE)", () => {
    expect(
      constructorColor("DUCATI", [
        teamInput("Ducati Lenovo Team", "#ad0000", 2),
      ]),
    ).toEqual({ color: "#ad0000", textColor: "#ffffff" });
  });

  it("coincidencia de nombre acento-insensible", () => {
    // El nombre del equipo CONTIENE el del constructor: "Áprilia Racing"
    // normaliza a "aprilia racing" → contiene "aprilia" (normalizeText).
    expect(
      constructorColor("Aprilia", [teamInput("Áprilia Racing", "#1a4b8c", 1)]),
    ).toEqual({ color: "#1a4b8c", textColor: "#ffffff" });
    // Constructor con acento, equipo sin: "Áprilia" → "aprilia".
    expect(
      constructorColor("Áprilia", [teamInput("Aprilia", "#1a4b8c", 1)]),
    ).toEqual({ color: "#1a4b8c", textColor: "#ffffff" });
  });

  it("empate por nombre → gana el equipo con MÁS pilotos afiliados", () => {
    const result = constructorColor("Ducati", [
      teamInput("Ducati Pramac", "#112233", 1),
      teamInput("Ducati Lenovo Team", "#ad0000", 2),
    ]);
    expect(result).toEqual({ color: "#ad0000", textColor: "#ffffff" });
  });

  it("empate por nº de pilotos → nombre ascendente (es-ES, base)", () => {
    const result = constructorColor("Ducati", [
      teamInput("Ducati Pramac", "#112233", 2),
      teamInput("Ducati Lenovo Team", "#ad0000", 2),
    ]);
    // "Ducati Lenovo Team" < "Ducati Pramac" (es-ES).
    expect(result).toEqual({ color: "#ad0000", textColor: "#ffffff" });
  });

  it("equipo SIN color no es candidato (aunque el nombre coincida)", () => {
    expect(
      constructorColor("KTM", [teamInput("KTM Tech3", null, 3)]),
    ).toEqual({ color: null, textColor: null });
  });

  it("sin equipos aplicables → null (el picker cae al hash derivado)", () => {
    expect(
      constructorColor("KTM", [
        teamInput("KTM Tech3", null, 3),
        teamInput("Ducati Lenovo Team", "#ad0000", 2),
      ]),
    ).toEqual({ color: null, textColor: null });
  });

  it("lista vacía → null", () => {
    expect(constructorColor("KTM", [])).toEqual({
      color: null,
      textColor: null,
    });
  });

  it("nombre de constructor vacío → null", () => {
    expect(
      constructorColor("", [teamInput("Ducati Lenovo Team", "#ad0000", 2)]),
    ).toEqual({ color: null, textColor: null });
  });
});

// ── builder(): cableado de colores (US-42) ──────────────────────────────────

/** Reglas de temporada mínimas válidas (mismo patrón que price-service.test). */
const RULES = {
  rulesVersion: "provisional-v1",
  economy: { option: "E", B: 100, t: 0.25, cmax: 8 },
  pricing: { pmaxRider: 30, pmaxGroup: 30 },
  scoring: {
    q2: { "1": 12, "2": 8, "3": 8, "4": 5 },
    sprint: { "1": 12, "2": 9, "3": 7 },
    mainRace: { "1": 25, "2": 20, "3": 16 },
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
};

/** Prisma falso del `builder` (tx no se usa: solo lecturas). */
function makePrisma() {
  const gp = { findUnique: vi.fn(), findFirst: vi.fn() };
  const riderAffiliation = { findMany: vi.fn() };
  const price = { findMany: vi.fn() };
  const constructor = { findMany: vi.fn() };
  const team = { findMany: vi.fn() };
  const budgetMovement = { findMany: vi.fn() };
  const seasonRule = { findFirst: vi.fn() };
  const lineupChange = { count: vi.fn() };
  const prisma = {
    gp,
    riderAffiliation,
    price,
    constructor,
    team,
    budgetMovement,
    seasonRule,
    lineupChange,
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    gp,
    riderAffiliation,
    price,
    constructor,
    team,
    budgetMovement,
    seasonRule,
    lineupChange,
  };
}

/** Datos del builder: 2 equipos Ducati (diferentes colores/nº de pilotos). */
function wireBuilder(fake: ReturnType<typeof makePrisma>) {
  const gpRow = {
    id: "g1",
    name: "GP Qatar",
    round: 1,
    status: "scheduled",
    lockoutAt: null,
    seasonId: "s1",
  };
  const teams = [
    {
      id: "t1",
      name: "Ducati Lenovo Team",
      constructorId: "c1",
      color: "#ad0000",
      textColor: "#ffffff",
      constructor: { id: "c1", name: "Ducati" },
    },
    {
      id: "t2",
      name: "VR46 Ducati",
      constructorId: "c1",
      color: "#112233",
      textColor: "#ffffff",
      constructor: { id: "c1", name: "Ducati" },
    },
    {
      id: "t3",
      name: "KTM Tech3",
      constructorId: "c2",
      color: "#ff7e27",
      textColor: "#383838",
      constructor: { id: "c2", name: "KTM" },
    },
    {
      id: "t4",
      name: "Aprilia Raceday",
      constructorId: "c3",
      color: null,
      textColor: null,
      constructor: { id: "c3", name: "Aprilia" },
    },
  ];
  const constructors = [
    { id: "c1", name: "Ducati" },
    { id: "c2", name: "KTM" },
    { id: "c3", name: "Aprilia" },
  ];
  // 2 pilotos en t1, 1 en t2, 0 en t3, 1 en t4.
  const affiliations = [
    {
      riderId: "r1",
      teamId: "t1",
      constructorId: "c1",
      rider: { id: "r1", name: "Marc Marquez", number: 93 },
      team: teams[0],
      constructor: constructors[0],
    },
    {
      riderId: "r2",
      teamId: "t1",
      constructorId: "c1",
      rider: { id: "r2", name: "Francesco Bagnaia", number: 1 },
      team: teams[0],
      constructor: constructors[0],
    },
    {
      riderId: "r3",
      teamId: "t2",
      constructorId: "c1",
      rider: { id: "r3", name: "Franco Morbidelli", number: 43 },
      team: teams[1],
      constructor: constructors[0],
    },
    {
      riderId: "r4",
      teamId: "t4",
      constructorId: "c3",
      rider: { id: "r4", name: "Pedro Acosta", number: 33 },
      team: teams[3],
      constructor: constructors[2],
    },
  ];

  fake.gp.findUnique.mockResolvedValue(gpRow);
  fake.riderAffiliation.findMany.mockResolvedValue(affiliations);
  fake.constructor.findMany.mockResolvedValue(constructors);
  fake.team.findMany.mockResolvedValue(teams);
  fake.budgetMovement.findMany.mockResolvedValue([]);
  fake.gp.findFirst.mockResolvedValue(null); // sin GP anterior → carry 0
  fake.seasonRule.findFirst.mockResolvedValue({
    id: "sr1",
    seasonId: "s1",
    version: "provisional-v1",
    rules: RULES,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  fake.lineupChange.count.mockResolvedValue(0);
  // Solo P0 (sin precio propio del GP → fallback P0, ADR-0015 addendum).
  fake.price.findMany.mockImplementation(({ where }: {
    where: { gpId: string | null };
  }) =>
    Promise.resolve(
      where.gpId === null
        ? [
            { assetType: "rider", assetId: "r1", price: 20 },
            { assetType: "rider", assetId: "r2", price: 15 },
            { assetType: "rider", assetId: "r3", price: 12 },
            { assetType: "rider", assetId: "r4", price: 10 },
            { assetType: "team", assetId: "t1", price: 8 },
            { assetType: "team", assetId: "t2", price: 8 },
            { assetType: "team", assetId: "t3", price: 8 },
            { assetType: "team", assetId: "t4", price: 8 },
            { assetType: "constructor", assetId: "c1", price: 5 },
            { assetType: "constructor", assetId: "c2", price: 4 },
            { assetType: "constructor", assetId: "c3", price: 3 },
          ]
        : [],
    ),
  );
  return { teams, constructors };
}

describe("LineupService.builder (US-42 colores, ADR-0042)", () => {
  it("rider → color de su EQUIPO afiliado en este GP; dorsal pasa tal cual", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    const byId = new Map(view.riders.map((r) => [r.riderId, r]));
    // r1/r2 → t1 (#ad0000); r3 → t2 (#112233).
    expect(byId.get("r1")).toMatchObject({
      number: 93,
      color: "#ad0000",
      textColor: "#ffffff",
      teamName: "Ducati Lenovo Team",
    });
    expect(byId.get("r3")).toMatchObject({
      number: 43,
      color: "#112233",
      textColor: "#ffffff",
    });
  });

  it("equipo SIN color → rider con color null (el picker hará fallback)", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    const r4 = view.riders.find((r) => r.riderId === "r4");
    expect(r4).toMatchObject({ color: null, textColor: null });
  });

  it("constructor → heurística: gana el equipo con más pilotos (Ducati → t1)", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    const byName = new Map(view.constructors.map((c) => [c.name, c]));
    // 2 pilotos en t1 > 1 en t2 → #ad0000.
    expect(byName.get("Ducati")).toMatchObject({
      color: "#ad0000",
      textColor: "#ffffff",
    });
  });

  it("constructor con un solo equipo (KTM → t3, 0 pilotos afiliados)", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    const ktm = view.constructors.find((c) => c.name === "KTM");
    expect(ktm).toMatchObject({
      color: "#ff7e27",
      textColor: "#383838",
    });
  });

  it("constructor sin equipos con color (Aprilia) → null (fallback hash)", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    const aprilia = view.constructors.find((c) => c.name === "Aprilia");
    expect(aprilia).toMatchObject({ color: null, textColor: null });
  });

  it("team → color propio (`teams.color`), incluido el null", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    const byId = new Map(view.teams.map((t) => [t.id, t]));
    expect(byId.get("t3")).toMatchObject({
      color: "#ff7e27",
      textColor: "#383838",
      constructorName: "KTM",
    });
    expect(byId.get("t4")).toMatchObject({ color: null, textColor: null });
  });

  it("presupuesto y precios P0 conviven con los colores (GP 1 sin precio propio)", async () => {
    const fake = makePrisma();
    wireBuilder(fake);
    const service = new LineupService({ prisma: fake.prisma });

    const view = await service.builder("g1", "u1");

    expect(view.budget).toMatchObject({ base: 100, carry: 0, total: 100 });
    const r1 = view.riders.find((r) => r.riderId === "r1");
    expect(r1?.price).toBe(20);
    expect(view.wildcardsUsed).toBe(0);
    expect(view.wildcardsPerSeason).toBe(1);
  });

  it("GP inexistente → NOT_FOUND", async () => {
    const fake = makePrisma();
    fake.gp.findUnique.mockResolvedValue(null);
    const service = new LineupService({ prisma: fake.prisma });

    await expect(service.builder("no-existe", "u1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
