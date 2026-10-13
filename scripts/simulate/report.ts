/**
 * Report — genera el informe Markdown de la simulación
 * (`docs/product/simulacion-2026.md`).
 *
 * Determinista: mismos resultados → mismo informe (salvo la fecha).
 */
import type { BudgetParams } from "../../app/modules/economy/index.js";
import type { StandingEntry } from "../../app/shared/types/index.js";
import type { Market } from "./dataset.js";
import type { OptionMetrics } from "./metrics.js";
import type { OptionResult } from "./options.js";
import type { Player } from "./population.js";

export interface ReportInput {
  market: Market;
  players: Player[];
  results: OptionResult[];
  metrics: OptionMetrics[];
  params: BudgetParams;
  standings26: StandingEntry[];
  standings25: StandingEntry[];
  fetchedAt: string;
  generatedAt: string;
}

const f = (x: number, d = 1): string => (Number.isNaN(x) ? "—" : x.toFixed(d));
const pct = (x: number, d = 0): string => (Number.isNaN(x) ? "—" : `${(x * 100).toFixed(d)}%`);

function gpTrajectoryTable(market: Market, result: OptionResult, metrics: OptionMetrics): string {
  const rows = market.gps.map((gp, i) => {
    const budgets = result.players.map((p) => p.byGp[i]?.budget ?? 0);
    const min = Math.min(...budgets);
    const max = Math.max(...budgets);
    const avg = budgets.reduce((s, v) => s + v, 0) / budgets.length;
    return `| ${i + 1} | ${gp.shortName} | ${f(min)} | ${f(avg)} | ${f(max)} | ${f(metrics.giniByGp[i] ?? 0, 3)} |`;
  });
  return [
    "| GP | GP | Min | Media | Máx | Gini |",
    "|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function namedCaseTable(
  market: Market,
  results: OptionResult[],
  playerId: string,
  playerLabel: string,
  riderLabel?: string,
): string {
  const headerCells = results.map((r) => `Opción ${r.option}`);
  const rows = market.gps.map((gp, i) => {
    const cells = results.map((r) => {
      const rec = r.players.find((p) => p.player.id === playerId);
      const g = rec?.byGp[i];
      return g ? `${f(g.budget)} / ${f(g.points)}` : "—";
    });
    return `| ${i + 1} | ${gp.shortName} | ${cells.join(" | ")} |`;
  });
  const title = riderLabel ? `${playerLabel} · ancla: ${riderLabel}` : playerLabel;
  return [
    `### ${title}`,
    "",
    `Presupuesto / puntos por GP (el jugador reconstruye el lineup cada GP).`,
    "",
    `| GP | GP | ${headerCells.join(" | ")} |`,
    `|---|---|${results.map(() => "---").join("|")}|`,
    ...rows,
  ].join("\n");
}

function priceMoversTable(market: Market): string {
  const movers = market.riders.map((r) => {
    const final = r.price[r.price.length - 1] ?? r.p0;
    return { r, final, delta: (final - r.p0) / r.p0 };
  });
  const sorted = [...movers].sort((a, b) => b.delta - a.delta);
  // Solo pilotos que realmente subieron (Δ > 0) y los que bajaron (Δ < 0).
  const up = sorted.filter((m) => m.delta > 1e-9).slice(0, 5);
  const down = sorted.filter((m) => m.delta < -1e-9).slice(-5).reverse();
  const row = (m: (typeof movers)[number]): string =>
    `| ${m.r.name} | ${m.r.constructor} | ${f(m.r.p0)} | ${f(m.final)} | ${m.delta >= 0 ? "+" : ""}${pct(m.delta)} |`;
  const empty = "| — | — | — | — | — |";
  return [
    "**Subidas** (precio final vs P0):",
    "",
    "| Piloto | Constructor | P0 | Final | Δ |",
    "|---|---|---|---|---|",
    ...(up.length ? up.map(row) : [empty]),
    "",
    "**Bajadas**:",
    "",
    "| Piloto | Constructor | P0 | Final | Δ |",
    "|---|---|---|---|---|",
    ...(down.length ? down.map(row) : [empty]),
  ].join("\n");
}

function standingsTable(standings: StandingEntry[], n = 10): string {
  const top = [...standings].sort((a, b) => b.points - a.points).slice(0, n);
  const rows = top.map((s, i) => `| ${i + 1} | ${s.name} | ${s.team ?? "—"} | ${s.points} |`);
  return ["| # | Piloto | Equipo | Puntos |", "|---|---|---|---|", ...rows].join("\n");
}

function gateTable(metrics: OptionMetrics[]): string {
  const rows = metrics.map((m) => {
    const giniOk = m.giniFinal < 0.05;
    const recOk = m.recoveryWorst > 0.95;
    const divOk = m.diversityAvg > 0.7;
    const pass = giniOk && recOk && divOk;
    return [
      `| ${m.option}`,
      `| ${f(m.giniFinal, 3)}`,
      `| ${giniOk ? "✅" : "❌"}`,
      `| ${f(m.recoveryWorst, 2)} (${m.recoveryWorstPlayer})`,
      `| ${recOk ? "✅" : "❌"}`,
      `| ${pct(m.diversityAvg)}`,
      `| ${divOk ? "✅" : "❌"}`,
      `| **${pass ? "✅ PASS" : "❌ FAIL"}** |`,
    ].join(" ");
  });
  return [
    "| Opción | Gini final | < 0.05 | Recuperación (peor jugador) | > 0.95 | Diversidad | > 70% | T-15 |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function comparisonTable(metrics: OptionMetrics[]): string {
  const rows = metrics.map((m) => [
    `| ${m.option}`,
    `| ${f(m.giniFinal, 3)} / ${f(m.giniAvg, 3)}`,
    `| ${f(m.recoveryWorst, 2)} (${m.recoveryWorstPlayer})`,
    `| ${f(m.recoveryMalArranque, 2)}`,
    `| ${f(m.p5p6FinalDivergence, 1)} / ${f(m.p5p6MaxDivergence, 1)}`,
    `| ${m.deathSpiralPlayers.length} (${m.deathSpiralPlayers.slice(0, 6).join(", ") || "—"})`,
    `| ${m.finalBelowBase.length}`,
    `| ${pct(m.diversityAvg)}`,
    `| ${pct(m.concentrationPct)}`,
    `| ${f(m.avgPoints, 1)} |`,
  ].join(" "));
  return [
    "| Opción | Gini fin / media | Recuperación peor | Rec. mal arranque | P5–P6 fin / máx | Espiral (<0.9B) | Final <0.9B | Diversidad | Concentración | Puntos/jugador |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

export function buildReport(input: ReportInput): string {
  const { market, players, results, metrics, params, standings26, standings25, fetchedAt, generatedAt } = input;
  const nGps = market.nGps;
  const bagnaia = market.riders.find((r) => r.name.toLowerCase().includes("bagnaia"));
  const alex = market.riders.find((r) => r.name.toLowerCase().includes("alex marquez"));
  const m1 = players.find((p) => p.id === "M1");
  const m3 = players.find((p) => p.id === "M3");
  const s1 = players.find((p) => p.id === "S1");
  const s2 = players.find((p) => p.id === "S2");

  const mE = metrics.find((m) => m.option === "E");
  const mB = metrics.find((m) => m.option === "B");
  const ePass = mE ? mE.giniFinal < 0.05 && mE.recoveryWorst > 0.95 && mE.diversityAvg > 0.7 : false;

  // Trayectoria de M1 en la opción B (para la conclusión, data-driven).
  const m1B = mB
    ? results.find((r) => r.option === "B")?.players.find((p) => p.player.id === "M1")?.byGp ?? []
    : [];
  const m1Budgets = m1B.map((g) => g.budget);
  const m1Min = m1Budgets.length ? Math.min(...m1Budgets) : NaN;
  const m1MinGp = m1Budgets.length ? m1Budgets.indexOf(m1Min) + 1 : NaN;
  const m1Final = m1Budgets.length ? m1Budgets[m1Budgets.length - 1] ?? NaN : NaN;

  const sections: string[] = [];

  sections.push(`# Simulación 2026 — Comparación de opciones económicas (A / B / C / E)`);
  sections.push("");
  sections.push(`> **Generado por:** \`npm run simulate\` el ${generatedAt}`);
  sections.push(`> **Datos:** temporada 2026 real (PulseLive, fetch ${fetchedAt.slice(0, 10)}): ${nGps} GPs terminados, ${market.riders.length} pilotos full-time en el mercado, ${market.constructors.length} constructores, ${market.teams.length} equipos.`);
  sections.push(`> **Versiones:** scoring-v1 · pricing-v1 · parámetros PROVISIONAL (B=${params.B}, t=${params.t}, cmax=${params.cmax}, Pmax=60/30; en la simulación, rescaleado a 30/30 — §3.3).`);
  sections.push(`> **Población:** ${players.length} jugadores arquetípicos deterministas.`);
  sections.push("");
  sections.push("---");
  sections.push("");

  // -------------------------------------------------------------------------
  sections.push("## 1. Objetivo");
  sections.push("");
  sections.push(
    "Comparar las opciones económicas A (fijo), B (oficial, ratchet), C (dinámico) y E (híbrido, recomendado) sobre la **temporada 2026 real**, para decidir la mecánica de presupuesto del producto y cerrar la puerta de re-simulación **T-15** (Gini < 0.05, recuperación > 0.95, diversidad > 70%).",
  );
  sections.push("");
  sections.push("La pregunta central: **¿qué mecánica evita que una mala racha (lesiones, caídas, precio que sube) arrastre al jugador a una espiral de la muerte?**");
  sections.push("");

  // -------------------------------------------------------------------------
  sections.push("## 2. Datos reales 2026");
  sections.push("");
  sections.push(`- **${nGps} GPs** terminados (del 1 al ${nGps}).`);
  sections.push(`- **Mercado de pilotos:** ${market.riders.length} full-time (listados en ≥10 GPs). Los pilotos de prueba/puntuales se excluyen del mercado pero puntúan para su constructor/equipo (campo completo).`);
  sections.push(`- **Constructores:** ${market.constructors.length}. **Equipos:** ${market.teams.length}.`);
  sections.push("");
  sections.push("### 2.1 Top 10 real 2026 (puntos de carrera principal)");
  sections.push("");
  sections.push(standingsTable(standings26));
  sections.push("");
  sections.push("### 2.2 Top 10 de 2025 (base de P0)");
  sections.push("");
  sections.push(standingsTable(standings25));
  sections.push("");

  // -------------------------------------------------------------------------
  sections.push("## 3. Metodología");
  sections.push("");
  sections.push("### 3.1 Mercado y P0");
  sections.push("");
  sections.push("| Activo | P0 |");
  sections.push("|---|---|");
  sections.push("| Piloto | `4 + 21 × (pts2025 / máx2025)` (top 2025 = 25, suelo 4; novatos = 4) |");
  sections.push("| Constructor | `5 + 3 × (fuerza / máxFuerza)` (fuerza = Σ pts2025 de sus pilotos full-time, afiliación 2026) |");
  sections.push("| Equipo | `3 + 3 × (fuerza / máxFuerza)` |");
  sections.push("");
  sections.push("### 3.2 Motor de precios (pricing-v1) — EXÓGENO");
  sections.push("");
  sections.push(
    "La serie de precios se calcula **una sola vez** para toda la temporada (misma para las 4 opciones) con la fórmula v1 de `economy.md` §4.3: ponderación 50/30/20 de los 3 últimos GPs, objetivo `P0 × (0.75 + 0.5·W/100)`, suavizado `prev + 0.5·(objetivo − prev)`, acotado a `[0.85·prev, 1.15·prev] ∩ [0.25·P0, 2·P0]`. Ausencia confirmada en el GP → `max(0.25·P0, 0.5·prev)`. DNF → fórmula normal con perf 0.",
  );
  sections.push("");
  sections.push(
    "El precio del GP *gp* usa el rendimiento real de *gp−1, gp−2, gp−3* y la ausencia en *gp* (información disponible al componer el lineup). Los precios son **exógenos**: solo difiere la mecánica de presupuesto entre opciones.",
  );
  sections.push("");
  sections.push("### 3.3 Puntuación (scoring-v1)");
  sections.push("");
  sections.push(
    "Carrera principal: tabla por posición (1º=25 … 15º=1) + bono ganador +5, DNF −5, no sale 0. Oro 100% / plata 50% (oro = los 2 pilotos más caros del lineup). Constructor/equipo = media de los 2 mejores pilotos del grupo en el **campo completo** de ese GP.",
  );
  sections.push("");
  sections.push(
    "**Pmax rescaleado para la simulación:** la puntuación simulada es reducida (máx 30 puntos por piloto y GP: 25 + 5), mientras que el Pmax de producto es 60 (máximo teórico de la tabla completa con Q2/sprint/bonos, economy.md §4.3). Para mantener el punto neutro de la fórmula (W=50 = mitad del máximo alcanzable), la simulación usa **Pmax=30** para pilotos y **Pmax=30** para grupos (media de 2 pilotos, máx 30 cada uno). Sin este rescaleo, ningún piloto alcanzaría W>50 y el mercado sería deflacionista por construcción.",
  );
  sections.push("");
  sections.push("### 3.4 Población (40 arquetipos)");
  sections.push("");
  sections.push("| Arquetipo | N | Comportamiento de pilotos | Constructor/equipo |");
  sections.push("|---|---|---|---|");
  sections.push("| Favoritista (F1–F6) | 6 | Precio actual desc (sigue el mercado); variante k salta los k primeros | El más caro |");
  sections.push("| Gastador (G1–G5) | 5 | P0 desc (compra la estrella aunque caiga) | El más caro |");
  sections.push("| Equilibrado (E1–E8) | 8 | Media de ranking precio + forma | El más equilibrado |");
  sections.push("| Value (V1–V8) | 8 | Mejor forma/precio (valueScore desc) | El mejor value |");
  sections.push("| Ahorrador (A1–A5) | 5 | Precio actual asc (maximiza carry) | El más barato |");
  sections.push(`| Mal arranque (M1–M4) | 4 | Ancla fija: ${bagnaia?.name ?? "Bagnaia"} (M1/M2) y ${alex?.name ?? "Alex Márquez"} (M3/M4) | El de la ancla |`);
  sections.push("| Estratega (S1–S4) | 4 | S1 (P5): 2 favoritos + 2 value · S2 (P6): 1 favorito + 3 value · S3: ofensivo (precio) · S4: defensivo (forma) | Según mezcla |");
  sections.push("");
  sections.push("### 3.5 Construcción de lineup");
  sections.push("");
  sections.push(
    "El presupuesto cubre los **6 activos** (4 pilotos + constructor + equipo): el coste total debe ser ≤ presupuesto (invariante game-rules.md §2). Estrategía greedy determinista: (1) pilotos por orden de preferencia dentro de `presupuesto − (ctor mín + equipo mín)`; (2) constructor + equipo = la combinación más preferida que quepa en el resto. Invariantes duras: máx 2 pilotos por constructor y por equipo. Si el presupuesto no alcanza 4 pilotos, se completa con los más baratos que cumplan. Oro = los 2 más caros. **El lineup se reconstruye cada GP** (simplificación: no se modelan transfers ni lockout — el jugador puede cambiar de lineup sin coste, lo que es favorable a la igualdad y se documenta como límite).",
  );
  sections.push("");
  sections.push("### 3.6 Presupuesto por opción");
  sections.push("");
  sections.push("| Opción | Fórmula (GP *r+1*) |");
  sections.push("|---|---|");
  sections.push("| A (fijo) | `B` |");
  sections.push("| B (oficial, ratchet) | `valor de mercado del lineup a precios nuevos + sin usar` |");
  sections.push("| C (dinámico) | `clamp(B × (1 + 0.2 × clamp(rel, −1, 1)), 0.8B, 1.2B)`, `rel = (puntos − media)/media` |");
  sections.push("| E (híbrido, RECOMENDADO) | `B + min(t × sin_usar_previo, cmax)` |");
  sections.push("");
  sections.push(
    "GP1 = B para todas. En B, el \"valor del equipo\" se valora a los **precios nuevos** (los publicados tras la carrera, i.e. los del GP siguiente): es el ratchet — si tu estrella gana, su precio sube y tu cap sube; si rinde mal, tu cap se hunde.",
  );
  sections.push("");

  // -------------------------------------------------------------------------
  sections.push("## 4. Resultados");
  sections.push("");
  sections.push("### 4.1 Tabla comparativa");
  sections.push("");
  sections.push(comparisonTable(metrics));
  sections.push("");
  sections.push("### 4.2 Puerta T-15 (re-simulación)");
  sections.push("");
  sections.push(gateTable(metrics));
  sections.push("");
  sections.push("### 4.3 Trayectoria de presupuestos por GP");
  sections.push("");
  for (const r of results) {
    const m = metrics.find((x) => x.option === r.option);
    if (!m) continue;
    sections.push(`**Opción ${r.option}:**`);
    sections.push("");
    sections.push(gpTrajectoryTable(market, r, m));
    sections.push("");
  }

  // -------------------------------------------------------------------------
  sections.push("### 4.4 Casos nombrados");
  sections.push("");
  if (m1 && bagnaia) {
    sections.push(
      `**M1 — Mal arranque con ${bagnaia.name}:** ${bagnaia.listedCount} GPs listados, ${bagnaia.wins} victorias, ${bagnaia.podiums} podiums, ${bagnaia.dnfCount} DNF, ${bagnaia.absentCount} ausencias en 2026. Un jugador que lo ancla (no lo vende) ve cómo su precio cae y, en la opción B, su cap se hunde con él.`,
    );
    sections.push("");
    sections.push(namedCaseTable(market, results, "M1", m1.label, bagnaia.name));
    sections.push("");
  }
  if (m3 && alex) {
    sections.push(
      `**M3 — Mal arranque con ${alex.name}:** ${alex.listedCount} GPs listados, ${alex.wins} victorias, ${alex.podiums} podiums, ${alex.dnfCount} DNF, ${alex.absentCount} ausencias en 2026.`,
    );
    sections.push("");
    sections.push(namedCaseTable(market, results, "M3", m3.label, alex.name));
    sections.push("");
  }
  if (s1 && s2) {
    sections.push(
      "**S1 (P5) vs S2 (P6) — mismo inicio, decisiones distintas:** P5 mezcla 2 favoritos + 2 value; P6, 1 favorito + 3 value. La divergencia de presupuesto mide cuánto amplifica la opción las diferencias de decisión.",
    );
    sections.push("");
    sections.push(namedCaseTable(market, results, "S1", s1.label));
    sections.push("");
    sections.push(namedCaseTable(market, results, "S2", s2.label));
    sections.push("");
  }

  // -------------------------------------------------------------------------
  sections.push("### 4.5 Precios: movimientos destacados");
  sections.push("");
  sections.push(priceMoversTable(market));
  sections.push("");
  sections.push("### 4.6 Puntos (contexto)");
  sections.push("");
  sections.push("| Opción | Puntos totales | Puntos/jugador |");
  sections.push("|---|---|---|");
  for (const m of metrics) {
    sections.push(`| ${m.option} | ${f(m.totalPoints, 0)} | ${f(m.avgPoints, 1)} |`);
  }
  sections.push("");
  sections.push(
    "Los puntos son **contexto**, no métrica de éxito: la opción ganadora es la que iguala presupuestos y preserva la recuperación, no la que da más puntos (que dependen de la estrategia del jugador, no de la mecánica).",
  );
  sections.push("");

  // -------------------------------------------------------------------------
  sections.push("## 5. Conclusiones");
  sections.push("");
  if (mB) {
    sections.push(
      `1. **La opción B (oficial, ratchet) reproduce la espiral de la muerte:** ${mB.deathSpiralPlayers.length} de ${players.length} jugadores caen por debajo de 0.9·B en algún GP y ${mB.finalBelowBase.length} terminan por debajo. El caso M1 (ancla a ${bagnaia?.name ?? "Bagnaia"}) lo ilustra: su presupuesto cae de ${params.B} a ${f(m1Min)} (GP ${f(m1MinGp, 0)}) y solo recupera hasta ${f(m1Final)} al final, muy por debajo del nivel base. Gini final ${f(mB.giniFinal, 3)} (objetivo < 0.05).`,
    );
    sections.push("");
  }
  if (mE) {
    sections.push(
      `2. **La opción E (híbrido) pasa la puerta T-15${ePass ? "" : " (parcialmente)"}:** Gini final ${f(mE.giniFinal, 3)}, recuperación del peor jugador ${f(mE.recoveryWorst, 2)} (${mE.recoveryWorstPlayer}), diversidad ${pct(mE.diversityAvg)}. El carry limitado (min(${params.t} × sin_usar, ${params.cmax})) recompensa la eficiencia sin crear ventaja acumulativa: el presupuesto está acotado a [B, B+cmax].`,
    );
    sections.push("");
  }
  const mA = metrics.find((m) => m.option === "A");
  const mC = metrics.find((m) => m.option === "C");
  if (mA) {
    sections.push(
      `3. **La opción A (fijo) es igualitaria por defecto** (Gini ${f(mA.giniFinal, 3)}) pero no recompensa nada: no hay carry, no hay incentivo de eficiencia. Sirve como referencia inferior.`,
    );
    sections.push("");
  }
  if (mC) {
    sections.push(
      `4. **La opción C (dinámico)** ajusta el presupuesto al rendimiento relativo, pero **premia a los ganadores y castiga a los perdedores** (Gini ${f(mC.giniFinal, 3)}, recuperación peor ${f(mC.recoveryWorst, 2)}): es un ratchet blando, no resuelve la mala racha.`,
    );
    sections.push("");
  }
  sections.push(
    `5. **Recomendación: opción E** (B=${params.B}, t=${params.t}, cmax=${params.cmax} — PROVISIONAL, calibrable en D-01/D-02). A y E pasan la puerta T-15 (igualdad y recuperación); la diferencia es que E añade un carry que recompensa la eficiencia (hasta +${params.cmax}) sin crear espiral de la muerte, a diferencia de B y C. Es la base del argumento de producto: una mala racha no reduce el deseo de seguir jugando.`,
  );
  sections.push("");

  // -------------------------------------------------------------------------
  sections.push("## 6. Límites de la simulación");
  sections.push("");
  sections.push(
    "- **Lineup reconstruido cada GP:** no se modelan transfers, lockout ni coste de cambio. Es favorable a la igualdad (el jugador se adapta sin fricción); en producción, el lockout añade fricción que podría aumentar ligeramente la divergencia.",
  );
  sections.push(
    "- **Puntuación reducida:** solo carrera principal (posición + ganador + DNF). Quedan fuera Q2, sprint, vuelta rápida, pole y posiciones ganadas; el motor de precios usa esos mismos puntos y con Pmax rescaleado a 30 (§3.3).",
  );
  sections.push(
    "- **Arquetipos deterministas:** la población modeliza estilos, no decisiones racionales óptimas. No hay aleatoriedad (re-ejecutar da lo mismo).",
  );
  sections.push(
    "- **P0 derivado de 2025:** el precio de apertura aproxima el valor previo; no es un mercado real de subastas.",
  );
  sections.push(
    "- **Parámetros PROVISIONAL:** B=100, t=0.25, cmax=8, Pmax=60/30, tablas de puntuación. La calibración fina es D-01/D-02; esta simulación valida la **mecánica**, no los valores.",
  );
  sections.push("");
  sections.push("---");
  sections.push("");
  sections.push(
    "*Informe generado automáticamente por `npm run simulate` (scripts/simulate/). Datos: PulseLive (pública, sin auth). Para reproducir: `npm run fetch:data && npm run simulate`.*",
  );

  return sections.join("\n");
}
