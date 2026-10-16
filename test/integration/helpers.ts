import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
