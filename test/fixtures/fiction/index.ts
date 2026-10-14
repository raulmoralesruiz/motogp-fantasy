/**
 * Dataset ficticio canónico — `docs/product/economy.md` §7 (T-22).
 *
 * Todos los datos son FICTICIOS: sin PII ni datos reales de usuarios.
 * Mercado de 11 pilotos / 4 constructores / 4 equipos (§7.1), temporada
 * ficticia de 6 GPs, jugadores P1–P6 con lineups fijos (§7.2) y resultados
 * anonimizados coherentes con la narrativa (lesión de B en GP3–GP4; ascenso
 * de J).
 *
 * Uso:
 * - `simulate.ts` — simula las trayectorias de presupuesto (opciones B/E).
 * - `loader.ts` — siembra el dataset en una BD real (tests de integración).
 * - `__tests__/trajectories.test.ts` — golden de trayectorias exactas.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GpStatus, Lineup } from "../../../app/shared/types/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJson<T>(file: string): T {
  const raw = readFileSync(path.join(HERE, file), "utf-8");
  return JSON.parse(raw) as T;
}

/** Piloto del mercado ficticio (serie de precios literal de §7.1). */
export interface FictionRider {
  id: string;
  name: string;
  constructor: string;
  team: string;
  /** Precio de apertura (P0). */
  p0: number;
  /** Precio vigente por GP (GP1..GPn). */
  prices: number[];
  narrative: string;
}

/** Constructor o equipo del mercado ficticio. */
export interface FictionGroup {
  id: string;
  name: string;
  p0: number;
  prices: number[];
}

export interface FictionTeam extends FictionGroup {
  constructor: string;
}

/** Jugador con lineup FJJO para toda la temporada (§7.2). */
export interface FictionPlayer {
  id: string;
  name: string;
  scenario: string;
  /** Oro = los 2 pilotos más caros a precios GP1. */
  lineup: Lineup;
}

/** Resultado de un piloto en un GP (estado de carrera incluido). */
export interface FictionGpResult {
  riderId: string;
  position: number | null;
  status: GpStatus;
}

/** GP ficticio: datos de temporada + resultados. */
export interface FictionGp {
  round: number;
  name: string;
  circuit: string;
  date: string;
  results: FictionGpResult[];
}

export interface FictionDataset {
  source: string;
  baseBudget: number;
  nGps: number;
  season: { name: string; year: number };
  riders: FictionRider[];
  constructors: FictionGroup[];
  teams: FictionTeam[];
  players: FictionPlayer[];
  gps: FictionGp[];
}

interface MarketJson {
  source: string;
  baseBudget: number;
  nGps: number;
  riders: FictionRider[];
  constructors: FictionGroup[];
  teams: FictionTeam[];
}

interface SeasonJson {
  name: string;
  year: number;
  gps: { round: number; name: string; circuit: string; date: string }[];
}

interface PlayersJson {
  players: FictionPlayer[];
}

interface ResultsJson {
  source: string;
  gps: { round: number; results: FictionGpResult[] }[];
}

/**
 * Carga y valida el dataset ficticio. Falla con un mensaje claro si el
 * fixture no es coherente (series de precios, lineups, resultados).
 */
export function loadFictionDataset(): FictionDataset {
  const market = readJson<MarketJson>("market.json");
  const season = readJson<SeasonJson>("season.json");
  const players = readJson<PlayersJson>("players.json");
  const results = readJson<ResultsJson>("results.json");

  const nGps = market.nGps;
  const assertSeries = (label: string, prices: number[]): void => {
    if (prices.length !== nGps) {
      throw new Error(
        `Fixture: ${label} tiene ${prices.length} precios, se esperan ${nGps}`,
      );
    }
  };
  for (const r of market.riders) assertSeries(`piloto ${r.id}`, r.prices);
  for (const c of market.constructors) assertSeries(`constructor ${c.id}`, c.prices);
  for (const t of market.teams) assertSeries(`equipo ${t.id}`, t.prices);

  const riderIds = new Set(market.riders.map((r) => r.id));
  const ctorIds = new Set(market.constructors.map((c) => c.id));
  const teamIds = new Set(market.teams.map((t) => t.id));
  for (const p of players.players) {
    const riderSlotIds = [...p.lineup.gold, ...p.lineup.silver];
    if (new Set(riderSlotIds).size !== 4) {
      throw new Error(`Fixture: ${p.id} tiene pilotos duplicados en el lineup`);
    }
    for (const id of riderSlotIds) {
      if (!riderIds.has(id)) {
        throw new Error(`Fixture: ${p.id} referencia el piloto desconocido ${id}`);
      }
    }
    if (!ctorIds.has(p.lineup.constructor)) {
      throw new Error(`Fixture: ${p.id} referencia un constructor desconocido`);
    }
    if (!teamIds.has(p.lineup.team)) {
      throw new Error(`Fixture: ${p.id} referencia un equipo desconocido`);
    }
  }

  const gps: FictionGp[] = season.gps.map((gp, i) => {
    const res = results.gps[i];
    if (!res) throw new Error(`Fixture: faltan resultados para el GP ${gp.round}`);
    if (res.round !== gp.round) {
      throw new Error(`Fixture: ronda desincronizada en el GP ${gp.round}`);
    }
    const seen = new Set<string>();
    const positions = new Set<number>();
    for (const r of res.results) {
      if (seen.has(r.riderId)) {
        throw new Error(
          `Fixture: resultado duplicado de ${r.riderId} en el GP ${gp.round}`,
        );
      }
      seen.add(r.riderId);
      if (r.status === "FINISHED") {
        if (r.position == null) {
          throw new Error(
            `Fixture: ${r.riderId} FINISHED sin posición en el GP ${gp.round}`,
          );
        }
        if (positions.has(r.position)) {
          throw new Error(
            `Fixture: posición ${r.position} duplicada en el GP ${gp.round}`,
          );
        }
        positions.add(r.position);
      } else if (r.position != null) {
        throw new Error(
          `Fixture: ${r.riderId} ${r.status} con posición en el GP ${gp.round}`,
        );
      }
    }
    if (seen.size !== riderIds.size) {
      throw new Error(
        `Fixture: el GP ${gp.round} no cubre a los ${riderIds.size} pilotos`,
      );
    }
    return { ...gp, results: res.results };
  });

  return {
    source: market.source,
    baseBudget: market.baseBudget,
    nGps,
    season: { name: season.name, year: season.year },
    riders: market.riders,
    constructors: market.constructors,
    teams: market.teams,
    players: players.players,
    gps,
  };
}
