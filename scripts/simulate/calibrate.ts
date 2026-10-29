/**
 * Calibrate — búsqueda de parámetros (grid search) para D-01.
 *
 * Explora el rango razonable de `B`, `t`, `cmax` (economy.md §4.1) sobre la
 * temporada 2026 real y la opción E (recomendada), y muestra qué combinaciones
 * pasan las métricas de equilibrio T-15 (Gini < 0.05, recuperación > 0.95,
 * diversidad > 70%). Determinista: mismos fixtures → misma tabla.
 *
 * Uso: `npm run calibrate`.
 */
import type { BudgetParams } from "../../app/modules/economy/index.js";
import { computeMetrics } from "./metrics.js";
import { runOption } from "./options.js";
import { createPopulation } from "./population.js";
import { loadMarket } from "./dataset.js";

interface GridPoint {
  params: BudgetParams;
  giniFinal: number;
  recoveryWorst: number;
  diversityAvg: number;
  deathSpiral: number;
  pass: boolean;
}

/** Metas T-15 (economy.md §6, backlog T-15). */
const GINI_MAX = 0.05;
const RECOVERY_MIN = 0.95;
const DIVERSITY_MIN = 0.7;

async function main(): Promise<void> {
  const market = await loadMarket(2026, 2025);
  const players = createPopulation(market);
  const nPlayers = players.length;

  // Rango razonable (economy.md §4.1). B=100 es la referencia; t y cmax se
  // varían sobre ella. Se incluye B=110/120 para ver el efecto en diversidad.
  const Bs = [100, 110, 120];
  const ts = [0.1, 0.2, 0.25, 0.3];
  const cmaxs = [5, 8, 10];

  const points: GridPoint[] = [];
  for (const B of Bs) {
    for (const t of ts) {
      for (const cmax of cmaxs) {
        const params: BudgetParams = { B, t, cmax };
        const result = runOption("E", players, market, params);
        const m = computeMetrics("E", result, market, params);
        const pass =
          m.giniFinal < GINI_MAX &&
          m.recoveryWorst > RECOVERY_MIN &&
          m.diversityAvg > DIVERSITY_MIN;
        points.push({
          params,
          giniFinal: m.giniFinal,
          recoveryWorst: m.recoveryWorst,
          diversityAvg: m.diversityAvg,
          deathSpiral: m.deathSpiralPlayers.length,
          pass,
        });
      }
    }
  }

  // --- Tabla por consola -------------------------------------------------------
  const header =
    "B     t     cmax  Gini fin  Rec. peor  Diversidad  Espiral  T-15";
  console.log(header);
  console.log("-".repeat(header.length));
  for (const p of points) {
    console.log(
      [
        String(p.params.B).padEnd(5),
        p.params.t.toFixed(2).padEnd(5),
        String(p.params.cmax).padEnd(5),
        p.giniFinal.toFixed(3).padEnd(9),
        p.recoveryWorst.toFixed(2).padEnd(10),
        `${Math.round(p.diversityAvg * 100)}%`.padEnd(11),
        `${p.deathSpiral}/${nPlayers}`.padEnd(9),
        p.pass ? "PASS" : "fail",
      ].join("  "),
    );
  }

  const nPass = points.filter((p) => p.pass).length;
  console.log("");
  console.log(
    `${nPass}/${points.length} combinaciones pasan T-15 ` +
      `(Gini < ${GINI_MAX}, recuperación > ${RECOVERY_MIN}, diversidad > ${DIVERSITY_MIN * 100}%)`,
  );

  // --- Recomendación: la combinación con mejor margen -------------------------
  // Margen = mínimo de (cuánto sobra en cada métrica), normalizado.
  const margin = (p: GridPoint): number =>
    Math.min(
      (GINI_MAX - p.giniFinal) / GINI_MAX,
      (p.recoveryWorst - RECOVERY_MIN) / RECOVERY_MIN,
      (p.diversityAvg - DIVERSITY_MIN) / DIVERSITY_MIN,
    );
  const passing = points.filter((p) => p.pass).sort((a, b) => margin(b) - margin(a));
  if (passing.length > 0) {
    const best = passing[0]!;
    console.log(
      `\nMejor margen: B=${best.params.B}, t=${best.params.t}, cmax=${best.params.cmax} ` +
        `(Gini ${best.giniFinal.toFixed(3)}, recuperación ${best.recoveryWorst.toFixed(2)}, ` +
        `diversidad ${Math.round(best.diversityAvg * 100)}%)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
