/**
 * Population — 40 jugadores arquetípicos para la simulación + construcción
 * de lineup.
 *
 * Modeliza el comportamiento de los jugadores (NO es un módulo de producto:
 * es una capa de simulación sobre los módulos puros `economy`/`scoring`).
 *
 * Arquetipos (comportamiento de selección de pilotos):
 * - **favoritista**: sigue el mercado (precio actual desc).
 * - **gastador**: sigue la "potencia de estrella" (P0 desc) — compra la misma
 *   estrella aunque caiga su precio.
 * - **equilibrado**: media de ranking de precio y de forma.
 * - **value**: mejor relación forma/precio (valueScore desc).
 * - **ahorrador**: más baratos primero (maximiza el carry).
 * - **malArranque**: ancla un piloto de alto P0 que rinde mal en 2026 y no lo
 *   vende (Bagnaia / Alex Márquez).
 * - **estratega**: casos nombrados P5/P6 (mismo inicio, decisiones distintas)
 *   + ofensivo/defensivo.
 *
 * Reglas de composición (invariantes, game-rules.md §2):
 *   - 4 pilotos (2 oro = los 2 más caros, 2 plata) + 1 constructor + 1 equipo.
 *   - Máx 2 pilotos por constructor y por equipo.
 *   - Coste total ≤ presupuesto.
 *
 * Determinista: sin aleatoriedad. Re-ejecutar produce resultados idénticos.
 */
import type { Lineup } from "../../app/shared/types/index.js";
import {
  weightedPerfAt,
  type Market,
  type MarketGroup,
  type MarketRider,
} from "./dataset.js";

export type Archetype =
  | "favoritista"
  | "gastador"
  | "equilibrado"
  | "value"
  | "ahorrador"
  | "malArranque"
  | "estratega";

export type EstrategaMix = "p5" | "p6" | "ofensivo" | "defensivo";

export interface Player {
  id: string;
  label: string;
  archetype: Archetype;
  /** Variante intra-arquetipo: salta los `variant` primeros de su ranking. */
  variant: number;
  /** Piloto ancla (solo malArranque). */
  anchorRiderId?: string;
  /** Mezcla (solo estratega). */
  mix?: EstrategaMix;
}

// ---------------------------------------------------------------------------
// Ranking de pilotos y grupos
// ---------------------------------------------------------------------------

interface RiderRanking {
  priceRank: Map<string, number>;
  perfRank: Map<string, number>;
  valueScore: Map<string, number>;
}

function computeRiderRanking(market: Market, gpIdx: number): RiderRanking {
  const byPrice = [...market.riders].sort(
    (a, b) => b.price[gpIdx]! - a.price[gpIdx]! || a.name.localeCompare(b.name),
  );
  const byPerf = [...market.riders].sort(
    (a, b) =>
      weightedPerfAt(b.perfByGp, gpIdx) - weightedPerfAt(a.perfByGp, gpIdx) ||
      a.name.localeCompare(b.name),
  );
  const priceRank = new Map(byPrice.map((r, i) => [r.riderId, i + 1]));
  const perfRank = new Map(byPerf.map((r, i) => [r.riderId, i + 1]));
  const valueScore = new Map(
    market.riders.map((r) => [
      r.riderId,
      (perfRank.get(r.riderId) ?? 0) - (priceRank.get(r.riderId) ?? 0),
    ]),
  );
  return { priceRank, perfRank, valueScore };
}

/** Orden de preferencia de pilotos del jugador para el GP `gpIdx`. */
function riderOrder(player: Player, market: Market, gpIdx: number): string[] {
  const { priceRank, perfRank, valueScore } = computeRiderRanking(market, gpIdx);
  const riders = market.riders;
  const byPriceAsc = [...riders].sort(
    (a, b) => (priceRank.get(a.riderId) ?? 0) - (priceRank.get(b.riderId) ?? 0),
  );
  const byPerfAsc = [...riders].sort(
    (a, b) => (perfRank.get(a.riderId) ?? 0) - (perfRank.get(b.riderId) ?? 0),
  );
  const byValueDesc = [...riders].sort(
    (a, b) =>
      (valueScore.get(b.riderId) ?? 0) - (valueScore.get(a.riderId) ?? 0) ||
      (perfRank.get(a.riderId) ?? 0) - (perfRank.get(b.riderId) ?? 0),
  );

  let order: MarketRider[];
  switch (player.archetype) {
    case "favoritista":
      order = byPriceAsc;
      break;
    case "gastador":
      // Sigue el P0 (estrella), no el precio actual.
      order = [...riders].sort(
        (a, b) => b.p0 - a.p0 || (priceRank.get(a.riderId) ?? 0) - (priceRank.get(b.riderId) ?? 0),
      );
      break;
    case "ahorrador":
      order = [...byPriceAsc].reverse();
      break;
    case "value":
      order = byValueDesc;
      break;
    case "equilibrado":
      order = [...riders].sort(
        (a, b) =>
          (priceRank.get(a.riderId) ?? 0) + (perfRank.get(a.riderId) ?? 0) -
          ((priceRank.get(b.riderId) ?? 0) + (perfRank.get(b.riderId) ?? 0)),
      );
      break;
    case "malArranque": {
      const rest = byPriceAsc.filter((r) => r.riderId !== player.anchorRiderId);
      order = [
        market.riderById.get(player.anchorRiderId!)!,
        ...rest.slice(player.variant),
      ];
      break;
    }
    case "estratega": {
      const top = player.mix === "p6" ? 1 : 2;
      const head = byPriceAsc.slice(0, top);
      const tail = byValueDesc.filter((r) => !head.includes(r));
      if (player.mix === "ofensivo") order = byPriceAsc;
      else if (player.mix === "defensivo") order = byPerfAsc;
      else order = [...head, ...tail];
      break;
    }
  }

  // Variante: salta los `variant` primeros (excepto malArranque, ya aplicado).
  if (player.variant > 0 && player.archetype !== "malArranque") {
    order = order.slice(player.variant);
  }
  return order.map((r) => r.riderId);
}

// ---------------------------------------------------------------------------
// Ranking de grupos (constructor / equipo)
// ---------------------------------------------------------------------------

type GroupMode = "priceDesc" | "priceAsc" | "perfDesc" | "valueDesc" | "balanced";

function groupMode(player: Player): GroupMode {
  switch (player.archetype) {
    case "favoritista":
    case "gastador":
      return "priceDesc";
    case "ahorrador":
      return "priceAsc";
    case "value":
      return "valueDesc";
    case "equilibrado":
      return "balanced";
    case "estratega":
      if (player.mix === "p6") return "valueDesc";
      if (player.mix === "defensivo") return "perfDesc";
      return "priceDesc";
    case "malArranque":
      return "priceDesc"; // se sobreescribe con el ancla
  }
}

function groupOrder(player: Player, market: Market, gpIdx: number, kind: "constructor" | "team"): string[] {
  const groups: MarketGroup[] = kind === "constructor" ? market.constructors : market.teams;
  const byPrice = [...groups].sort((a, b) => b.price[gpIdx]! - a.price[gpIdx]!);
  const byPerf = [...groups].sort(
    (a, b) => weightedPerfAt(b.perfByGp, gpIdx) - weightedPerfAt(a.perfByGp, gpIdx),
  );
  const priceRank = new Map(byPrice.map((g, i) => [g.name, i + 1]));
  const perfRank = new Map(byPerf.map((g, i) => [g.name, i + 1]));
  const valueScore = new Map(
    groups.map((g) => [g.name, (perfRank.get(g.name) ?? 0) - (priceRank.get(g.name) ?? 0)]),
  );

  switch (groupMode(player)) {
    case "priceDesc":
      return byPrice.map((g) => g.name);
    case "priceAsc":
      return [...byPrice].reverse().map((g) => g.name);
    case "perfDesc":
      return byPerf.map((g) => g.name);
    case "valueDesc":
      return [...groups]
        .sort((a, b) => (valueScore.get(b.name) ?? 0) - (valueScore.get(a.name) ?? 0))
        .map((g) => g.name);
    case "balanced":
      return [...groups]
        .sort(
          (a, b) =>
            (priceRank.get(a.name) ?? 0) + (perfRank.get(a.name) ?? 0) -
            ((priceRank.get(b.name) ?? 0) + (perfRank.get(b.name) ?? 0)),
        )
        .map((g) => g.name);
  }
}

// ---------------------------------------------------------------------------
// Construcción de lineup
// ---------------------------------------------------------------------------

export interface BuiltLineup {
  lineup: Lineup;
  cost: number;
  riderIds: string[];
}

/**
 * Elige 4 pilotos por orden de preferencia dentro de un presupuesto,
 * respetando las invariantes de concentración (máx 2 por constructor y
 * máx 2 por equipo). Fallback: completa con los más baratos si el
 * presupuesto es muy ajustado.
 */
function pickRiders(
  order: string[],
  market: Market,
  gpIdx: number,
  budget: number,
): MarketRider[] {
  const picked: MarketRider[] = [];
  const ctorCount = new Map<string, number>();
  const teamCount = new Map<string, number>();
  let spend = 0;

  const tryPick = (r: MarketRider): boolean => {
    if (picked.length >= 4) return false;
    const price = r.price[gpIdx]!;
    if (price > budget - spend + 1e-9) return false;
    if ((ctorCount.get(r.constructor) ?? 0) >= 2) return false;
    if ((teamCount.get(r.team) ?? 0) >= 2) return false;
    picked.push(r);
    ctorCount.set(r.constructor, (ctorCount.get(r.constructor) ?? 0) + 1);
    teamCount.set(r.team, (teamCount.get(r.team) ?? 0) + 1);
    spend += price;
    return true;
  };

  for (const id of order) {
    if (picked.length >= 4) break;
    const r = market.riderById.get(id);
    if (r) tryPick(r);
  }
  // Fallback: presupuesto muy ajustado → completa con los más baratos.
  if (picked.length < 4) {
    const byPriceAsc = [...market.riders].sort((a, b) => a.price[gpIdx]! - b.price[gpIdx]!);
    for (const r of byPriceAsc) {
      if (picked.length >= 4) break;
      if (picked.some((p) => p.riderId === r.riderId)) continue;
      tryPick(r);
    }
  }
  return picked;
}

/**
 * Construye el lineup de un jugador para un GP con un presupuesto dado.
 *
 * El presupuesto cubre los 6 activos (4 pilotos + constructor + equipo):
 * el coste total debe ser ≤ presupuesto (invariante game-rules.md §2).
 *
 * Estrategía (determinista):
 *   1. Pilotos: greedy por orden de preferencia dentro de
 *      `presupuesto − (ctor mín + equipo mín)`, para que siempre quede
 *      margen para un par constructor/equipo.
 *   2. Constructor + equipo: la combinación más preferida que quepa en el
 *      resto del presupuesto.
 *
 * El malArranque prioriza el constructor/equipo de su piloto ancla.
 */
export function buildLineup(
  player: Player,
  market: Market,
  gpIdx: number,
  budget: number,
): BuiltLineup {
  const order = riderOrder(player, market, gpIdx);
  const ctorOrder = groupOrder(player, market, gpIdx, "constructor");
  const teamOrder = groupOrder(player, market, gpIdx, "team");

  if (player.archetype === "malArranque") {
    const anchor = market.riderById.get(player.anchorRiderId!)!;
    ctorOrder.splice(ctorOrder.indexOf(anchor.constructor), 1);
    ctorOrder.unshift(anchor.constructor);
    teamOrder.splice(teamOrder.indexOf(anchor.team), 1);
    teamOrder.unshift(anchor.team);
  }

  // 1) Pilotos.
  const minCtor = Math.min(...market.constructors.map((g) => g.price[gpIdx]!));
  const minTeam = Math.min(...market.teams.map((g) => g.price[gpIdx]!));
  const picked = pickRiders(order, market, gpIdx, budget - minCtor - minTeam);
  if (picked.length < 4) {
    throw new Error(`No se pudo completar el lineup (budget=${budget.toFixed(2)})`);
  }
  const ridersCost = picked.reduce((s, r) => s + r.price[gpIdx]!, 0);

  // 2) Constructor + equipo: la combinación más preferida que quepa.
  const remaining = budget - ridersCost;
  let constructor: MarketGroup | null = null;
  let team: MarketGroup | null = null;
  outer: for (const cn of ctorOrder) {
    for (const tn of teamOrder) {
      const c = market.ctorByName.get(cn);
      const t = market.teamByName.get(tn);
      if (!c || !t) continue;
      if (c.price[gpIdx]! + t.price[gpIdx]! <= remaining + 1e-9) {
        constructor = c;
        team = t;
        break outer;
      }
    }
  }
  if (!constructor || !team) {
    throw new Error(`No se pudo completar el lineup (budget=${budget.toFixed(2)})`);
  }

  // Oro = los 2 más caros; plata = los otros 2.
  const sorted = [...picked].sort((a, b) => b.price[gpIdx]! - a.price[gpIdx]!);
  const gold: [string, string] = [sorted[0]!.riderId, sorted[1]!.riderId];
  const silver: [string, string] = [sorted[2]!.riderId, sorted[3]!.riderId];

  return {
    lineup: { gold, silver, constructor: constructor.name, team: team.name },
    cost: ridersCost + constructor.price[gpIdx]! + team.price[gpIdx]!,
    riderIds: picked.map((r) => r.riderId),
  };
}

// ---------------------------------------------------------------------------
// Creación de la población (40 jugadores)
// ---------------------------------------------------------------------------

export function createPopulation(market: Market): Player[] {
  const players: Player[] = [];
  const add = (p: Player) => players.push(p);

  for (let i = 1; i <= 6; i++) add({ id: `F${i}`, label: `Favoritista ${i}`, archetype: "favoritista", variant: i - 1 });
  for (let i = 1; i <= 5; i++) add({ id: `G${i}`, label: `Gastador ${i}`, archetype: "gastador", variant: i - 1 });
  for (let i = 1; i <= 8; i++) add({ id: `E${i}`, label: `Equilibrado ${i}`, archetype: "equilibrado", variant: i - 1 });
  for (let i = 1; i <= 8; i++) add({ id: `V${i}`, label: `Value ${i}`, archetype: "value", variant: i - 1 });
  for (let i = 1; i <= 5; i++) add({ id: `A${i}`, label: `Ahorrador ${i}`, archetype: "ahorrador", variant: i - 1 });

  const bagnaia = market.riders.find((r) => r.name.toLowerCase().includes("bagnaia"));
  const alex = market.riders.find((r) => r.name.toLowerCase().includes("alex marquez"));
  if (!bagnaia || !alex) throw new Error("Anclas malArranque no encontradas (Bagnaia / Alex Márquez)");
  add({ id: "M1", label: `Mal arranque · ${bagnaia.name}`, archetype: "malArranque", variant: 0, anchorRiderId: bagnaia.riderId });
  add({ id: "M2", label: `Mal arranque · ${bagnaia.name} (v2)`, archetype: "malArranque", variant: 1, anchorRiderId: bagnaia.riderId });
  add({ id: "M3", label: `Mal arranque · ${alex.name}`, archetype: "malArranque", variant: 0, anchorRiderId: alex.riderId });
  add({ id: "M4", label: `Mal arranque · ${alex.name} (v2)`, archetype: "malArranque", variant: 1, anchorRiderId: alex.riderId });

  add({ id: "S1", label: "P5 · 2 favoritos + 2 value", archetype: "estratega", variant: 0, mix: "p5" });
  add({ id: "S2", label: "P6 · 1 favorito + 3 value", archetype: "estratega", variant: 0, mix: "p6" });
  add({ id: "S3", label: "Ofensivo (precio)", archetype: "estratega", variant: 0, mix: "ofensivo" });
  add({ id: "S4", label: "Defensivo (forma)", archetype: "estratega", variant: 0, mix: "defensivo" });

  return players;
}
