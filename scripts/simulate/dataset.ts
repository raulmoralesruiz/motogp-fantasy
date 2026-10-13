/**
 * Dataset — normaliza los fixtures en el modelo de mercado de la simulación.
 *
 * Decisiones (documentadas en `docs/product/simulacion-2026.md`):
 *
 * - **Mercado de pilotos:** solo pilotos *full-time* (listados en ≥10 de los
 *   17 GPs). Los pilotos de prueba/puntuales se excluyen del mercado (no son
 *   activos estables), aunque SÍ puntúan para su constructor/equipo (campo
 *   completo en el top-2 de grupo).
 * - **P0 de pilotos:** `4 + 21 × (pts2025 / maxPts2025)` (top 2025 = 25,
 *   suelo 4). Novatos (sin pts2025) → 4.
 * - **P0 de constructor/equipo:** fuerza = Σ pts2025 de sus pilotos
 *   full-time (afiliación 2026). Constructor: `5 + 3 × (fuerza/máx)`;
 *   equipo: `3 + 3 × (fuerza/máx)`.
 * - **Perf por GP:** pilotos → `perf(puntos, 60)`; grupos →
 *   `perf(puntosGrupo, 30)`, donde puntosGrupo = media top-2 del grupo.
 * - **Precio por GP:** `buildPriceSeries` (pricing-v1). El precio del GP gp
 *   usa el rendimiento real de gp−1, gp−2, gp−3 y la ausencia en gp.
 * - **Ausencia (ABSENT) en el GP gp** → regla de lesión para precio(gp).
 *   DNF → fórmula normal con perf 0.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPriceSeries,
  perf,
  PMAX_GROUP,
} from "../../app/modules/economy/index.js";
import {
  groupTopTwoAverage,
  riderMainPoints,
} from "../../app/modules/scoring/index.js";
import type {
  Gp,
  PrevSeasonFixture,
  SeasonFixture,
} from "../../app/shared/types/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES_DIR = join(ROOT, "data", "fixtures");

/** Mínimo de GPs listados para ser full-time (mercado). */
export const FULL_TIME_MIN_GPS = 10;

/**
 * Pmax de la simulación (rescaleado).
 *
 * La simulación usa puntuación reducida: solo carrera principal (25 por
 * victoria + bono de ganador 5 = 30 puntos máx.; no se modelan Q2, sprint,
 * vuelta rápida, pole ni posiciones ganadas — simplificación documentada en
 * el informe, §3.3). El Pmax del motor de precios (60, máximo teórico de la
 * tabla provisional completa, economy.md §4.3) se rescalea a 30 para
 * mantener el punto neutro de la fórmula: W=50 = mitad del máximo
 * alcanzable en la puntuación simulada. `PMAX_GROUP` (30) ya es consistente:
 * un grupo puntúa la media de sus 2 mejores pilotos (máx 30 cada uno).
 */
export const PMAX_RIDER_SIM = 30;

/** Rango de P0 de pilotos: [P0_RIDER_MIN, P0_RIDER_MIN + P0_RIDER_SPAN]. */
export const P0_RIDER_MIN = 4;
export const P0_RIDER_SPAN = 21;
/** Rango de P0 de constructor: [5, 8]. */
export const P0_CTOR_MIN = 5;
export const P0_CTOR_SPAN = 3;
/** Rango de P0 de equipo: [3, 6]. */
export const P0_TEAM_MIN = 3;
export const P0_TEAM_SPAN = 3;

export interface MarketRider {
  riderId: string;
  name: string;
  team: string;
  constructor: string;
  number: number;
  /** Puntos de 2025 (0 si novato). */
  pts25: number;
  /** Precio de apertura. */
  p0: number;
  /** perfByGp[i] = perf en el GP i (0-based). */
  perfByGp: number[];
  /** outByGp[i] = true si está ausente (lesionado) en el GP i. */
  outByGp: boolean[];
  /** price[i] = precio vigente en el GP i. */
  price: number[];
  /** Estadísticas 2026 (para el informe). */
  listedCount: number;
  wins: number;
  podiums: number;
  dnfCount: number;
  absentCount: number;
}

export interface MarketGroup {
  name: string;
  kind: "constructor" | "team";
  /** Fuerza = Σ pts2025 de sus pilotos full-time. */
  strength25: number;
  p0: number;
  perfByGp: number[];
  price: number[];
  /** riderIds full-time del grupo. */
  riderIds: string[];
}

export interface GpMarketData {
  /** riderId → puntos en la carrera principal (campo completo). */
  riderPoints: Map<string, number>;
  /** constructor → puntos (media top-2). */
  ctorPoints: Map<string, number>;
  /** equipo → puntos (media top-2). */
  teamPoints: Map<string, number>;
}

export interface Market {
  year: number;
  nGps: number;
  gps: Gp[];
  riders: MarketRider[];
  constructors: MarketGroup[];
  teams: MarketGroup[];
  byGp: GpMarketData[];
  riderById: Map<string, MarketRider>;
  ctorByName: Map<string, MarketGroup>;
  teamByName: Map<string, MarketGroup>;
}

function readJson<T>(path: string): Promise<T> {
  return readFile(path, "utf-8").then((s) => JSON.parse(s) as T);
}

/**
 * W ponderado (50/30/20) del rendimiento de un activo en el momento de
 * componer el lineup del GP `gpIdx` (0-based): usa los 3 GPs anteriores.
 */
export function weightedPerfAt(perfByGp: number[], gpIdx: number): number {
  const p0 = perfByGp[gpIdx - 1] ?? 0;
  const p1 = perfByGp[gpIdx - 2] ?? 0;
  const p2 = perfByGp[gpIdx - 3] ?? 0;
  return 0.5 * p0 + 0.3 * p1 + 0.2 * p2;
}

export async function loadMarket(
  year = 2026,
  prevYear = 2025,
): Promise<Market> {
  const fixture26 = await readJson<SeasonFixture>(
    join(FIXTURES_DIR, `season-${year}.json`),
  );
  const fixture25 = await readJson<PrevSeasonFixture>(
    join(FIXTURES_DIR, `season-${prevYear}.json`),
  );
  const { gps, roster } = fixture26;
  const nGps = gps.length;

  // --- Puntos 2025 (base de P0) -------------------------------------------
  const pts25 = new Map<string, number>();
  for (const s of fixture25.standings) pts25.set(s.riderId, s.points);
  const maxPts25 = Math.max(1, ...fixture25.standings.map((s) => s.points));

  // --- Apariciones por piloto ----------------------------------------------
  const listedCount = new Map<string, number>();
  for (const gp of gps) {
    for (const r of gp.results) {
      listedCount.set(r.riderId, (listedCount.get(r.riderId) ?? 0) + 1);
    }
  }

  // --- Puntos por piloto por GP (campo completo) ---------------------------
  const riderPointsByGp: Map<string, number>[] = gps.map((gp) => {
    const m = new Map<string, number>();
    for (const r of gp.results) {
      m.set(r.riderId, riderMainPoints(r.status, r.position));
    }
    return m;
  });

  // --- Grupos: puntos por GP (media top-2 del campo completo) --------------
  const ctorPointsByGp: Map<string, number>[] = [];
  const teamPointsByGp: Map<string, number>[] = [];
  for (let i = 0; i < nGps; i++) {
    const gp = gps[i];
    if (!gp) throw new Error(`GP ${i} no encontrado`);
    const entries = gp.results.map((r) => ({
      riderId: r.riderId,
      points: riderPointsByGp[i]!.get(r.riderId) ?? 0,
    }));
    const rosterById = new Map(roster.map((r) => [r.riderId, r]));
    ctorPointsByGp.push(
      groupTopTwoAverage(entries, (id) => rosterById.get(id)?.constructor ?? "?"),
    );
    teamPointsByGp.push(
      groupTopTwoAverage(entries, (id) => rosterById.get(id)?.team ?? "?"),
    );
  }

  // --- Pilotos full-time → mercado -----------------------------------------
  const marketRiders: MarketRider[] = roster
    .filter((r) => (listedCount.get(r.riderId) ?? 0) >= FULL_TIME_MIN_GPS)
    .map((r) => {
      const p25 = pts25.get(r.riderId) ?? 0;
      const p0 =
        p25 > 0
          ? P0_RIDER_MIN + P0_RIDER_SPAN * (p25 / maxPts25)
          : P0_RIDER_MIN;
      const perfByGp: number[] = [];
      const outByGp: boolean[] = [];
      let wins = 0;
      let podiums = 0;
      let dnfCount = 0;
      let absentCount = 0;
      for (let i = 0; i < nGps; i++) {
        const res = gps[i]!.results.find((x) => x.riderId === r.riderId);
        const status = res?.status ?? "ABSENT";
        const position = res?.position ?? null;
        const pts = res ? riderMainPoints(status, position) : 0;
        if (status === "FINISHED") {
          if (position === 1) wins++;
          if (position !== null && position <= 3) podiums++;
        } else if (status === "DNF") {
          dnfCount++;
        } else {
          absentCount++;
        }
        perfByGp.push(perf(pts, PMAX_RIDER_SIM));
        outByGp.push(status === "ABSENT");
      }
      return {
        riderId: r.riderId,
        name: r.name,
        team: r.team,
        constructor: r.constructor,
        number: r.number,
        pts25: p25,
        p0,
        perfByGp,
        outByGp,
        price: buildPriceSeries(p0, perfByGp, outByGp),
        listedCount: listedCount.get(r.riderId) ?? 0,
        wins,
        podiums,
        dnfCount,
        absentCount,
      };
    });

  const riderById = new Map(marketRiders.map((r) => [r.riderId, r]));

  // --- Grupos: fuerza 2025 y P0 --------------------------------------------
  function buildGroups(kind: "constructor" | "team"): MarketGroup[] {
    const names = new Set<string>();
    for (const r of marketRiders) {
      if (kind === "constructor") names.add(r.constructor);
      else names.add(r.team);
    }
    const groups: MarketGroup[] = [...names].map((name) => {
      const riderIds = marketRiders
        .filter((r) => (kind === "constructor" ? r.constructor : r.team) === name)
        .map((r) => r.riderId);
      const strength25 = riderIds.reduce(
        (s, id) => s + (pts25.get(id) ?? 0),
        0,
      );
      return { name, kind, strength25, p0: 0, perfByGp: [], price: [], riderIds };
    });
    const maxStrength = Math.max(1, ...groups.map((g) => g.strength25));
    for (const g of groups) {
      const p0 =
        kind === "constructor"
          ? P0_CTOR_MIN + P0_CTOR_SPAN * (g.strength25 / maxStrength)
          : P0_TEAM_MIN + P0_TEAM_SPAN * (g.strength25 / maxStrength);
      const perfByGp = Array.from({ length: nGps }, (_, i) =>
        perf((kind === "constructor" ? ctorPointsByGp[i] : teamPointsByGp[i])!.get(g.name) ?? 0, PMAX_GROUP),
      );
      g.p0 = p0;
      g.perfByGp = perfByGp;
      // Los grupos no tienen "lesión": si todo su plantel está ausente,
      // puntúan 0 y la fórmula normal ya deprime el precio.
      g.price = buildPriceSeries(p0, perfByGp, new Array(nGps).fill(false));
    }
    return groups.sort((a, b) => b.strength25 - a.strength25);
  }

  const constructors = buildGroups("constructor");
  const teams = buildGroups("team");

  return {
    year,
    nGps,
    gps,
    riders: marketRiders,
    constructors,
    teams,
    byGp: gps.map((_, i) => ({
      riderPoints: riderPointsByGp[i]!,
      ctorPoints: ctorPointsByGp[i]!,
      teamPoints: teamPointsByGp[i]!,
    })),
    riderById,
    ctorByName: new Map(constructors.map((g) => [g.name, g])),
    teamByName: new Map(teams.map((g) => [g.name, g])),
  };
}
