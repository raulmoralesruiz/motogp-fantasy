/**
 * Loader del dataset ficticio (economy.md §7) → BD real (T-22).
 *
 * Siembra la temporada ficticia completa para los tests de integración:
 * - temporada + 6 GPs (circuito propio por GP) + evento de carrera;
 * - mercado: 11 pilotos, 4 constructores, 4 equipos;
 * - afiliaciones (rider, gp) — el mercado ficticio es estable;
 * - precios: P0 (gpId NULL) + precio por GP para cada activo;
 * - 6 usuarios anonimizados con lineups fijos por GP (los 6 slots se
 *   insertan en UNA sola sentencia, como exige el trigger de composición);
 * - resultados anonimizados en estado `provisional` (el estado de carrera
 *   FINISHED/DNF/ABSENT se conserva en `raw`, payload original de la fuente).
 *
 * Todo es ficticio: sin PII ni datos reales de usuarios.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  Constructor,
  Gp,
  Lineup,
  Rider,
  Season,
  Team,
  User,
  WeekendEvent,
} from "@prisma/client";
import { loadFictionDataset, type FictionDataset } from "./index.js";

/** Nombre+versión de la fuente de los resultados sembrados (auditoría). */
export const FICTION_SOURCE_NAME = "fixture-ficticio-v1";
/** Versión de resultados de la siembra inicial. */
export const FICTION_RESULTS_VERSION = "fiction-v1";

export interface FictionWorld {
  season: Season;
  gps: Gp[];
  events: WeekendEvent[];
  riders: Rider[];
  constructors: Constructor[];
  teams: Team[];
  users: User[];
  lineups: Lineup[];
  /** Id de fixture → id de BD. */
  riderDbId: Map<string, string>;
  ctorDbId: Map<string, string>;
  teamDbId: Map<string, string>;
  userDbId: Map<string, string>;
}

/** Extrae un id de un mapa de siembra (falla claro si falta). */
function requireId(map: Map<string, string>, id: string, label: string): string {
  const value = map.get(id);
  if (!value) throw new Error(`Loader: ${label} "${id}" no está sembrado`);
  return value;
}

/** Busca un GP sembrado por ronda (falla claro si falta). */
function requireGp(gps: Gp[], round: number): Gp {
  const gp = gps.find((g) => g.round === round);
  if (!gp) throw new Error(`Loader: el GP ${round} no está sembrado`);
  return gp;
}

/** Filas de precio: P0 (gpId NULL) + una por GP. */
function priceRows(
  assetType: "rider" | "constructor" | "team",
  assetDbId: string,
  p0: number,
  prices: number[],
  gps: Gp[],
): Prisma.PriceCreateManyInput[] {
  const rows: Prisma.PriceCreateManyInput[] = [
    { assetType, assetId: assetDbId, gpId: null, price: p0, reason: "formula" },
  ];
  for (let i = 0; i < gps.length; i++) {
    const gp = gps[i];
    if (!gp) throw new Error("Loader: GP no disponible");
    rows.push({
      assetType,
      assetId: assetDbId,
      gpId: gp.id,
      price: prices[i] ?? 0,
      reason: "formula",
    });
  }
  return rows;
}

/** Siembra el dataset ficticio completo en la BD. */
export async function seedFictionalSeason(
  prisma: PrismaClient,
  ds: FictionDataset = loadFictionDataset(),
): Promise<FictionWorld> {
  // 1. Temporada + GPs (circuito propio por GP) + evento de carrera.
  const season = await prisma.season.create({
    data: { name: ds.season.name, year: ds.season.year },
  });
  const gps: Gp[] = [];
  const events: WeekendEvent[] = [];
  for (const gp of ds.gps) {
    const circuit = await prisma.circuit.create({
      data: { name: gp.circuit, country: "Ficticia" },
    });
    const created = await prisma.gp.create({
      data: {
        seasonId: season.id,
        round: gp.round,
        name: gp.name,
        circuitId: circuit.id,
        date: new Date(gp.date),
      },
    });
    const event = await prisma.weekendEvent.create({
      data: { gpId: created.id, type: "race", orderNum: 1 },
    });
    gps.push(created);
    events.push(event);
  }

  // 2. Mercado: constructores → equipos → pilotos.
  const ctorDbId = new Map<string, string>();
  const constructors: Constructor[] = [];
  for (const c of ds.constructors) {
    const created = await prisma.constructor.create({ data: { name: c.name } });
    ctorDbId.set(c.id, created.id);
    constructors.push(created);
  }
  const teamDbId = new Map<string, string>();
  const teams: Team[] = [];
  for (const t of ds.teams) {
    const created = await prisma.team.create({
      data: {
        name: t.name,
        constructorId: requireId(ctorDbId, t.constructor, "constructor"),
      },
    });
    teamDbId.set(t.id, created.id);
    teams.push(created);
  }
  const riderDbId = new Map<string, string>();
  const riders: Rider[] = [];
  for (const r of ds.riders) {
    const created = await prisma.rider.create({ data: { name: r.name } });
    riderDbId.set(r.id, created.id);
    riders.push(created);
  }

  // 3. Afiliaciones (rider, gp) — mercado ficticio estable.
  await prisma.riderAffiliation.createMany({
    data: ds.riders.flatMap((r) =>
      ds.gps.map((gp) => ({
        riderId: requireId(riderDbId, r.id, "piloto"),
        teamId: requireId(teamDbId, r.team, "equipo"),
        constructorId: requireId(ctorDbId, r.constructor, "constructor"),
        gpId: requireGp(gps, gp.round).id,
      })),
    ),
  });

  // 4. Precios: P0 (gpId NULL) + precio por GP para cada activo.
  await prisma.price.createMany({
    data: [
      ...ds.riders.flatMap((r) =>
        priceRows("rider", requireId(riderDbId, r.id, "piloto"), r.p0, r.prices, gps),
      ),
      ...ds.constructors.flatMap((c) =>
        priceRows(
          "constructor",
          requireId(ctorDbId, c.id, "constructor"),
          c.p0,
          c.prices,
          gps,
        ),
      ),
      ...ds.teams.flatMap((t) =>
        priceRows("team", requireId(teamDbId, t.id, "equipo"), t.p0, t.prices, gps),
      ),
    ],
  });

  // 5. Usuarios anonimizados + lineups fijos (6 slots en UNA sentencia).
  const userDbId = new Map<string, string>();
  const users: User[] = [];
  const lineups: Lineup[] = [];
  for (const p of ds.players) {
    const user = await prisma.user.create({
      data: {
        email: `${p.id}@ficticio.test`,
        passwordHash: "hash-ficticio",
        username: p.id,
      },
    });
    userDbId.set(p.id, user.id);
    users.push(user);
    for (const gp of gps) {
      const lineup = await prisma.lineup.create({
        data: { userId: user.id, gpId: gp.id },
      });
      await prisma.lineupSlot.createMany({
        data: [
          {
            lineupId: lineup.id,
            slotType: "gold",
            assetType: "rider",
            assetId: requireId(riderDbId, p.lineup.gold[0], "piloto"),
          },
          {
            lineupId: lineup.id,
            slotType: "gold",
            assetType: "rider",
            assetId: requireId(riderDbId, p.lineup.gold[1], "piloto"),
          },
          {
            lineupId: lineup.id,
            slotType: "silver",
            assetType: "rider",
            assetId: requireId(riderDbId, p.lineup.silver[0], "piloto"),
          },
          {
            lineupId: lineup.id,
            slotType: "silver",
            assetType: "rider",
            assetId: requireId(riderDbId, p.lineup.silver[1], "piloto"),
          },
          {
            lineupId: lineup.id,
            slotType: "constructor",
            assetType: "constructor",
            assetId: requireId(ctorDbId, p.lineup.constructor, "constructor"),
          },
          {
            lineupId: lineup.id,
            slotType: "team",
            assetType: "team",
            assetId: requireId(teamDbId, p.lineup.team, "equipo"),
          },
        ],
      });
      lineups.push(lineup);
    }
  }

  // 6. Resultados anonimizados (provisional; estado de carrera en `raw`).
  await prisma.result.createMany({
    data: ds.gps.flatMap((gp, i) => {
      const created = gps[i];
      const event = events[i];
      if (!created || !event) {
        throw new Error(`Loader: el GP ${gp.round} no está sembrado`);
      }
      return gp.results.map((res) => ({
        gpId: created.id,
        eventId: event.id,
        riderId: requireId(riderDbId, res.riderId, "piloto"),
        position: res.position,
        status: "provisional" as const,
        resultsVersion: FICTION_RESULTS_VERSION,
        source: "manual" as const,
        sourceName: FICTION_SOURCE_NAME,
        raw: { riderId: res.riderId, position: res.position, status: res.status },
      }));
    }),
  });

  return {
    season,
    gps,
    events,
    riders,
    constructors,
    teams,
    users,
    lineups,
    riderDbId,
    ctorDbId,
    teamDbId,
    userDbId,
  };
}
