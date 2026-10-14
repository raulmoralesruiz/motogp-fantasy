/**
 * Simulación del dataset FICTICIO (economy.md §7) — T-22.
 *
 * Lineups fijos (P1–P6), precios exógenos (serie literal §7.1), opciones
 * B/OFF (cap = valor del equipo + sin usar) y E/REC (base + carry).
 * Imprime las trayectorias de presupuesto por jugador (2 decimales, como el
 * documento) para contrastar con §7.3/§7.4.
 *
 * Uso: npm run simulate:fiction
 */
import { PROVISIONAL_SEASON_RULES } from "../../app/shared/config/season-rules.js";
import type { BudgetParams } from "../../app/modules/economy/index.js";
import { loadFictionDataset } from "../../test/fixtures/fiction/index.js";
import { simulateFiction } from "../../test/fixtures/fiction/simulate.js";

const ds = loadFictionDataset();
// Parámetros PROVISIONAL (en producción viven en `season_rules`); B del dataset.
const econ = PROVISIONAL_SEASON_RULES.economy;
const params: BudgetParams = { B: ds.baseBudget, t: econ.t, cmax: econ.cmax };

const fmt = (x: number): string => x.toFixed(2);
const gpHeaders = Array.from({ length: ds.nGps }, (_, i) => `GP${i + 1}`);

for (const option of ["B", "E"] as const) {
  const res = simulateFiction(ds, option, params);
  const label =
    option === "B"
      ? "OPCIÓN B (OFF: cap = valor del equipo + sin usar)"
      : "OPCIÓN E (REC: base + carry)";
  console.log(`\n=== ${label} ===`);
  const header = ["Jugador", ...gpHeaders, "Puntos"];
  console.log(header.map((h, i) => (i === 0 ? h.padEnd(20) : h.padStart(10))).join(""));
  for (const p of res.players) {
    const row = [
      p.playerName.padEnd(20),
      ...p.byGp.map((g) => fmt(g.budget).padStart(10)),
      fmt(p.totalPoints).padStart(10),
    ];
    console.log(row.join(""));
  }
}
