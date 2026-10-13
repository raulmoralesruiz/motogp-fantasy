/**
 * Viz — genera la visualización interactiva de la simulación 2026.
 *
 * Re-ejecuta la simulación (misma pipeline que `simulate.ts`), volca los
 * datos en JSON y los incrusta en la plantilla autocontenida
 * `viz-template.html` (sin dependencias externas: se abre con doble click).
 *
 * Salida: `docs/product/simulacion-2026.html` (regenerar con
 * `npm run simulate:viz`).
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BudgetParams } from "../../app/modules/economy/index.js";
import { loadMarket } from "./dataset.js";
import { createPopulation } from "./population.js";
import { runOption } from "./options.js";
import { computeMetrics } from "./metrics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TEMPLATE_PATH = join(ROOT, "scripts", "simulate", "viz-template.html");
const OUTPUT_PATH = join(ROOT, "docs", "product", "simulacion-2026.html");

const PARAMS: BudgetParams = { B: 100, t: 0.25, cmax: 8 };
const OPTIONS = ["A", "B", "C", "E"] as const;

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

interface VizPlayer {
  id: string;
  label: string;
  archetype: string;
  anchor?: string;
  byOption: Record<string, unknown>;
}

interface VizData {
  generatedAt: string;
  params: BudgetParams;
  gps: Array<{ order: number; shortName: string; name: string; date: string }>;
  options: Record<string, unknown>;
  players: VizPlayer[];
  priceMovers: Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  const market = await loadMarket(2026, 2025);
  const players = createPopulation(market);
  const runs = OPTIONS.map((option) => {
    const res = runOption(option, players, market, PARAMS);
    return { option, res, met: computeMetrics(option, res, market, PARAMS) };
  });
  const n = market.nGps;

  const data: VizData = {
    generatedAt: new Date().toISOString().slice(0, 10),
    params: PARAMS,
    gps: market.gps.map((g) => ({
      order: g.order,
      shortName: g.shortName,
      name: g.name,
      date: g.date,
    })),
    options: {},
    players: players.map((p) => ({
      id: p.id,
      label: p.label,
      archetype: p.archetype,
      anchor: p.anchorRiderId ? market.riderById.get(p.anchorRiderId)?.name : undefined,
      byOption: {},
    })),
    priceMovers: [],
  };

  for (const { option, res, met } of runs) {
    const maxByGp: number[] = [];
    for (let i = 0; i < n; i++) {
      let mx = -Infinity;
      for (const p of res.players) mx = Math.max(mx, p.byGp[i]?.budget ?? 0);
      maxByGp.push(mx);
    }

    data.options[option] = {
      avgByGp: met.avgBudgetByGp.map(r1),
      minByGp: met.minBudgetByGp.map(r1),
      maxByGp: maxByGp.map(r1),
      giniByGp: met.giniByGp.map(r3),
      metrics: {
        giniFinal: met.giniFinal,
        giniAvg: met.giniAvg,
        recoveryWorst: met.recoveryWorst,
        recoveryWorstPlayer: met.recoveryWorstPlayer,
        recoveryMalArranque: met.recoveryMalArranque,
        p5p6FinalDivergence: met.p5p6FinalDivergence,
        p5p6MaxDivergence: met.p5p6MaxDivergence,
        deathSpiralPlayers: met.deathSpiralPlayers,
        finalBelowBase: met.finalBelowBase,
        diversityAvg: met.diversityAvg,
        concentrationPct: met.concentrationPct,
        avgPoints: met.avgPoints,
      },
    };

    for (const rec of res.players) {
      const p = data.players.find((x) => x.id === rec.player.id);
      if (!p) continue;
      p.byOption[option] = {
        budgets: rec.byGp.map((g) => r1(g.budget)),
        points: rec.byGp.map((g) => r1(g.points)),
        totalPoints: r1(rec.totalPoints),
        minBudget: r1(rec.minBudget),
        finalBudget: r1(rec.finalBudget),
      };
    }
  }

  // Movimientos de precio: los 12 pilotos con mayor |Δ| inicio → final.
  data.priceMovers = market.riders
    .map((r) => {
      const start = r.price[0] ?? r.p0;
      const end = r.price[n - 1] ?? r.p0;
      return {
        name: r.name,
        constructor: r.constructor,
        p0: r.p0,
        start: r1(start),
        end: r1(end),
        delta: r1(end - start),
        wins: r.wins,
        podiums: r.podiums,
        dnf: r.dnfCount,
        absent: r.absentCount,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12);

  const template = await readFile(TEMPLATE_PATH, "utf-8");
  if (!template.includes("/*__DATA__*/")) {
    throw new Error("La plantilla viz-template.html no contiene el marcador /*__DATA__*/");
  }
  const html = template.replace("/*__DATA__*/", JSON.stringify(data));
  await writeFile(OUTPUT_PATH, html, "utf-8");
  console.log(
    `✔ Visualización generada: ${OUTPUT_PATH} (${(html.length / 1024).toFixed(0)} KB)`,
  );
}

main().catch((err) => {
  console.error("Fallo al generar la visualización:", err);
  process.exit(1);
});
