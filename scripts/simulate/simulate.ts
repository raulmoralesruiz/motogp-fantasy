/**
 * Simulate — punto de entrada de la simulación 2026 (`npm run simulate`).
 *
 * Flujo:
 *   1. Carga los fixtures reales (`data/fixtures/season-2026.json`,
 *      `season-2025.json`) → modelo de mercado (`dataset.ts`).
 *   2. Crea la población de 40 arquetipos (`population.ts`).
 *   3. Simula la temporada para las opciones A/B/C/E (`options.ts`).
 *   4. Calcula las métricas de igualdad/recuperación/diversidad (`metrics.ts`).
 *   5. Genera el informe Markdown en `docs/product/simulacion-2026.md`
 *      (`report.ts`) y muestra un resumen por consola.
 *
 * Determinista: mismos fixtures → mismo informe (salvo la fecha de
 * generación). Para regenerar los fixtures: `npm run fetch:data`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BudgetParams } from "../../app/modules/economy/index.js";
import type {
  PrevSeasonFixture,
  SeasonFixture,
} from "../../app/shared/types/index.js";
import { loadMarket } from "./dataset.js";
import { computeMetrics } from "./metrics.js";
import { runOption } from "./options.js";
import { createPopulation } from "./population.js";
import { buildReport } from "./report.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readJson<T>(path: string): Promise<T> {
  return readFile(path, "utf-8").then((s) => JSON.parse(s) as T);
}

async function main(): Promise<void> {
  const year = 2026;
  const prevYear = 2025;
  // Parámetros PROVISIONAL (calibrables en D-01/D-02; en producción viven
  // en `season_rules`, nunca hardcoded).
  const params: BudgetParams = { B: 100, t: 0.25, cmax: 8 };

  const fixture26 = await readJson<SeasonFixture>(
    join(ROOT, "data", "fixtures", `season-${year}.json`),
  );
  const fixture25 = await readJson<PrevSeasonFixture>(
    join(ROOT, "data", "fixtures", `season-${prevYear}.json`),
  );

  const market = await loadMarket(year, prevYear);
  const players = createPopulation(market);

  console.log(
    `Simulación ${year}: ${market.nGps} GPs · ${market.riders.length} pilotos en el mercado · ` +
      `${market.constructors.length} constructores · ${market.teams.length} equipos · ${players.length} jugadores`,
  );

  const results = (["A", "B", "C", "E"] as const).map((o) =>
    runOption(o, players, market, params),
  );
  const metrics = results.map((r) => computeMetrics(r.option, r, market, params));

  // --- Resumen por consola ---------------------------------------------------
  const line = (m: (typeof metrics)[number]): string =>
    [
      m.option,
      m.giniFinal.toFixed(3),
      `${m.recoveryWorst.toFixed(2)} (${m.recoveryWorstPlayer})`,
      m.recoveryMalArranque.toFixed(2),
      m.p5p6FinalDivergence.toFixed(1),
      `${m.deathSpiralPlayers.length}/${players.length}`,
      `${Math.round(m.diversityAvg * 100)}%`,
      m.avgPoints.toFixed(1),
    ].join("  ");

  console.log("");
  console.log(
    ["Opción", "Gini fin", "Rec. peor", "Rec. malArr", "P5-P6 fin", "Espiral", "Diversidad", "Pts/jug"].join("  "),
  );
  console.log(metrics.map(line).join("\n"));

  const pass = (m: (typeof metrics)[number]): boolean =>
    m.giniFinal < 0.05 && m.recoveryWorst > 0.95 && m.diversityAvg > 0.7;
  console.log("");
  for (const m of metrics) {
    console.log(
      `Opción ${m.option}: T-15 ${pass(m) ? "✅ PASS" : "❌ FAIL"} ` +
        `(Gini ${m.giniFinal.toFixed(3)} < 0.05, recuperación ${m.recoveryWorst.toFixed(2)} > 0.95, diversidad ${Math.round(m.diversityAvg * 100)}% > 70%)`,
    );
  }

  // --- Informe Markdown --------------------------------------------------------
  const generatedAt = new Date().toISOString().slice(0, 10);
  const report = buildReport({
    market,
    players,
    results,
    metrics,
    params,
    standings26: fixture26.standings,
    standings25: fixture25.standings,
    fetchedAt: fixture26.fetchedAt,
    generatedAt,
  });
  const outPath = join(ROOT, "docs", "product", "simulacion-2026.md");
  await writeFile(outPath, report, "utf-8");
  console.log(`\nInforme escrito en ${join("docs", "product", "simulacion-2026.md")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
