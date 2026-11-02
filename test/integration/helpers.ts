import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import type {
  Constructor,
  Gp,
  LineupSlot,
  Rider,
  Season,
  Team,
  User,
  WeekendEvent,
} from "@prisma/client";

import type { SeasonRules } from "../../app/shared/validation/season-rules";
import type { EmailSender } from "../../app/modules/identity";

/**
 * Archivo donde el global setup registra la URL de la BD efímera
 * (Testcontainers). Los workers de test no comparten proceso con el
 * global setup, así que la comunicación es por archivo (Vitest 2.x).
 */
export const DB_URL_FILE = path.join(os.tmpdir(), "motogp-integration-db-url");

export function integrationDbUrl(): string {
  try {
    return readFileSync(DB_URL_FILE, "utf8").trim();
  } catch {
    throw new Error(
      "No se encontró la URL de la BD de integración. " +
        "Ejecuta la suite completa (npm run test:integration): el global setup arranca el contenedor.",
    );
  }
}

/**
 * URL de Redis efímera (Testcontainers) para los tests que usan el lock por GP
 * (T-10, ADR-0034). El global setup la registra; si no existe, el test puede
 * usar un dummy (lazyConnect, no se conecta).
 */
export const REDIS_URL_FILE = path.join(os.tmpdir(), "motogp-integration-redis-url");

export function integrationRedisUrl(): string | null {
  try {
    return readFileSync(REDIS_URL_FILE, "utf8").trim();
  } catch {
    return null;
  }
}

/** PrismaClient apuntando a la BD efímera de Testcontainers. */
export function createPrisma(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: integrationDbUrl() } } });
}

/**
 * `EmailSender` de captura para tests (US-02): registra los envíos en memoria
 * sin I/O real, para inspeccionar destinatario y link.
 */
export class CapturingEmailSender implements EmailSender {
  sent: { to: string; link: string }[] = [];
  async sendResetLink(mail: { to: string; link: string }): Promise<void> {
    this.sent.push(mail);
  }
}

/**
 * Reglas de temporada para tests (versión `test-v1`): las mismas que
 * `seedWorld` (B=100, t=0.25, cmax=8; Pmax 30/30; tablas scoring-v1).
 * Exportada para reutilizarla en tests que no crean un `World` completo
 * (p. ej. el test de rendimiento de T-10, 1000 lineups).
 */
export const TEST_SEASON_RULES: SeasonRules = {
  rulesVersion: "test-v1",
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
};

/** Mundo mínimo aislado para un test: temporada → GP → evento → 6 pilotos → constructor → equipo → usuario. */
export interface World {
  season: Season;
  gp: Gp;
  event: WeekendEvent;
  riders: [Rider, Rider, Rider, Rider, Rider, Rider];
  ctor: Constructor;
  team: Team;
  user: User;
}

export async function seedWorld(prisma: PrismaClient): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const season = await prisma.season.create({
    data: { name: `Temporada ${suffix}`, year: 2099 },
  });
  // Reglas de la temporada (T-25: Pmax desde season_rules).
  await prisma.seasonRule.create({
    data: {
      seasonId: season.id,
      version: TEST_SEASON_RULES.rulesVersion,
      rules: TEST_SEASON_RULES as Prisma.InputJsonValue,
    },
  });
  const circuit = await prisma.circuit.create({
    data: { name: `Circuito ${suffix}`, country: "Ficticia" },
  });
  const gp = await prisma.gp.create({
    data: {
      seasonId: season.id,
      round: 1,
      name: `GP ${suffix}`,
      circuitId: circuit.id,
      date: new Date("2099-06-01T12:00:00Z"),
    },
  });
  const event = await prisma.weekendEvent.create({
    data: { gpId: gp.id, type: "race", orderNum: 1 },
  });
  const riders: [Rider, Rider, Rider, Rider, Rider, Rider] = [
    await prisma.rider.create({ data: { name: `Piloto ${suffix}-1` } }),
    await prisma.rider.create({ data: { name: `Piloto ${suffix}-2` } }),
    await prisma.rider.create({ data: { name: `Piloto ${suffix}-3` } }),
    await prisma.rider.create({ data: { name: `Piloto ${suffix}-4` } }),
    await prisma.rider.create({ data: { name: `Piloto ${suffix}-5` } }),
    await prisma.rider.create({ data: { name: `Piloto ${suffix}-6` } }),
  ];
  const ctor = await prisma.constructor.create({
    data: { name: `Constructor ${suffix}` },
  });
  const team = await prisma.team.create({
    data: { name: `Equipo ${suffix}`, constructorId: ctor.id },
  });
  const user = await prisma.user.create({
    data: {
      email: `user-${suffix}@test.local`,
      passwordHash: "hash-ficticio",
      username: `user-${suffix}`,
    },
  });
  return { season, gp, event, riders, ctor, team, user };
}

/**
 * Crea un lineup con los 6 slots válidos (2 oro + 2 plata + 1 constructor + 1 equipo)
 * en UNA sola sentencia (createMany → INSERT multi-fila), como exige el trigger
 * de composición (AFTER STATEMENT). Devuelve los slots creados.
 */
export async function createFullLineup(
  prisma: PrismaClient,
  world: World,
): Promise<LineupSlot[]> {
  const lineup = await prisma.lineup.create({
    data: { userId: world.user.id, gpId: world.gp.id },
  });
  await prisma.lineupSlot.createMany({
    data: [
      {
        lineupId: lineup.id,
        slotType: "gold",
        assetType: "rider",
        assetId: world.riders[0].id,
      },
      {
        lineupId: lineup.id,
        slotType: "gold",
        assetType: "rider",
        assetId: world.riders[1].id,
      },
      {
        lineupId: lineup.id,
        slotType: "silver",
        assetType: "rider",
        assetId: world.riders[2].id,
      },
      {
        lineupId: lineup.id,
        slotType: "silver",
        assetType: "rider",
        assetId: world.riders[3].id,
      },
      {
        lineupId: lineup.id,
        slotType: "constructor",
        assetType: "constructor",
        assetId: world.ctor.id,
      },
      {
        lineupId: lineup.id,
        slotType: "team",
        assetType: "team",
        assetId: world.team.id,
      },
    ],
  });
  return prisma.lineupSlot.findMany({ where: { lineupId: lineup.id } });
}

/** GP "pesado" para el test de rendimiento (T-10): N lineups + resultados. */
export interface HeavyGp {
  season: Season;
  gp: Gp;
  event: WeekendEvent;
  riders: Rider[];
  ctor: Constructor;
  team: Team;
  lineupCount: number;
}

/**
 * Siembra un GP con `lineupCount` lineups (1 por usuario — invariante 3),
 * 4 pilotos, 1 constructor, 1 equipo, resultados de carrera (provisionales),
 * afiliaciones y precios. Optimizado para volúmenes: `createMany` + IDs
 * pregenerados (el seed de 1000 lineups no debe dominar el timing).
 *
 * Los slots se insertan en lotes de "lineups completos": el trigger de
 * composición es AFTER STATEMENT y valida TODOS los lineups con slots — cada
 * sentencia debe dejarlos completos (2 oro + 2 plata + 1 constructor + 1 equipo).
 */
export async function seedHeavyGp(
  prisma: PrismaClient,
  lineupCount: number,
): Promise<HeavyGp> {
  const suffix = randomUUID().slice(0, 8);
  const season = await prisma.season.create({
    data: { name: `Temporada ${suffix}`, year: 2099 },
  });
  await prisma.seasonRule.create({
    data: {
      seasonId: season.id,
      version: TEST_SEASON_RULES.rulesVersion,
      rules: TEST_SEASON_RULES as Prisma.InputJsonValue,
    },
  });
  const circuit = await prisma.circuit.create({
    data: { name: `Circuito ${suffix}`, country: "Ficticia" },
  });
  const gp = await prisma.gp.create({
    data: {
      seasonId: season.id,
      round: 1,
      name: `GP ${suffix}`,
      circuitId: circuit.id,
      date: new Date("2099-06-01T12:00:00Z"),
    },
  });
  const event = await prisma.weekendEvent.create({
    data: { gpId: gp.id, type: "race", orderNum: 1 },
  });
  const riders: Rider[] = [];
  for (let i = 0; i < 4; i++) {
    riders.push(
      await prisma.rider.create({ data: { name: `Piloto ${suffix}-${i}` } }),
    );
  }
  const ctor = await prisma.constructor.create({
    data: { name: `Constructor ${suffix}` },
  });
  const team = await prisma.team.create({
    data: { name: `Equipo ${suffix}`, constructorId: ctor.id },
  });

  // N usuarios + N lineups (1 por usuario): IDs pregenerados, insert bulk.
  const userIds: string[] = [];
  const lineupIds: string[] = [];
  for (let i = 0; i < lineupCount; i++) {
    userIds.push(randomUUID());
    lineupIds.push(randomUUID());
  }
  await prisma.user.createMany({
    data: userIds.map((id, i) => ({
      id,
      email: `heavy-${suffix}-${i}@test.local`,
      passwordHash: "hash-ficticio",
      username: `heavy-${suffix}-${i}`,
    })),
  });
  await prisma.lineup.createMany({
    // userIds[i] y lineupIds[i] tienen la misma longitud (se rellenan juntos).
    data: lineupIds.map((id, i) => ({
      id,
      userId: userIds[i]!,
      gpId: gp.id,
    })),
  });

  // Slots: 6 por lineup. Lotes de lineups completos (ver docstring).
  // (Los 4 pilotos existen: se crearon justo arriba, `riders.length === 4`.)
  const goldA = riders[0]!.id;
  const goldB = riders[1]!.id;
  const silverA = riders[2]!.id;
  const silverB = riders[3]!.id;
  const CHUNK = 50;
  for (let start = 0; start < lineupCount; start += CHUNK) {
    const end = Math.min(start + CHUNK, lineupCount);
    const rows: Array<{
      lineupId: string;
      slotType: "gold" | "silver" | "constructor" | "team";
      assetType: "rider" | "constructor" | "team";
      assetId: string;
    }> = [];
    for (let i = start; i < end; i++) {
      const lid = lineupIds[i]!; // i ∈ [start, end) ⊂ [0, lineupCount)
      rows.push(
        { lineupId: lid, slotType: "gold", assetType: "rider", assetId: goldA },
        { lineupId: lid, slotType: "gold", assetType: "rider", assetId: goldB },
        { lineupId: lid, slotType: "silver", assetType: "rider", assetId: silverA },
        { lineupId: lid, slotType: "silver", assetType: "rider", assetId: silverB },
        { lineupId: lid, slotType: "constructor", assetType: "constructor", assetId: ctor.id },
        { lineupId: lid, slotType: "team", assetType: "team", assetId: team.id },
      );
    }
    await prisma.lineupSlot.createMany({ data: rows });
  }

  // Resultados de carrera (1 por piloto, provisional) + afiliaciones + precios.
  await prisma.result.createMany({
    data: riders.map((rider, i) => ({
      gpId: gp.id,
      eventId: event.id,
      riderId: rider.id,
      position: i + 1,
      status: "provisional",
      source: "manual",
    })),
  });
  await prisma.riderAffiliation.createMany({
    data: riders.map((rider) => ({
      riderId: rider.id,
      teamId: team.id,
      constructorId: ctor.id,
      gpId: gp.id,
    })),
  });
  await prisma.price.createMany({
    data: riders.map((rider, i) => ({
      assetType: "rider",
      assetId: rider.id,
      gpId: gp.id,
      price: 10 - i,
      reason: "formula",
    })),
  });

  return { season, gp, event, riders, ctor, team, lineupCount };
}
