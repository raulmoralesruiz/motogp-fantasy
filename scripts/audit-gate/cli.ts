/**
 * Gate de vulnerabilidades de dependencias (T-21, ADR-0038) — CLI.
 *
 * Ejecuta `npm audit --json`, valida `audit-baseline.json` (excepciones
 * conocidas y justificadas) y falla (exit ≠ 0) si:
 * - aparece una high/critical **no** cubierta por el baseline, o
 * - el baseline contiene una entrada que ya no existe (obsoleta).
 *
 * Las severidades low/moderate no bloquean (las gestiona Dependabot,
 * T-02: patch/minor semanales). El umbral y las excepciones viven en
 * `audit-baseline.json`, en la raíz del repo (revisión explícita).
 *
 * Uso: `npm run audit:ci` (job `quality` del CI).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateAudit, parseAuditBaseline, type AuditReport } from "./lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const baselinePath = path.join(repoRoot, "audit-baseline.json");

function main(): void {
  let rawBaseline: unknown;
  try {
    rawBaseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (err) {
    console.error(`❌ No se pudo leer audit-baseline.json: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const parsed = parseAuditBaseline(rawBaseline);
  if (!parsed.ok || !parsed.baseline) {
    console.error("❌ audit-baseline.json inválido (T-21, ADR-0038):");
    for (const f of parsed.failures) console.error(`  - ${f.message}`);
    process.exitCode = 1;
    return;
  }

  // `npm audit` termina con código ≠ 0 si hay vulnerabilidades (umbral por
  // defecto "low"); eso es esperado: el criterio lo pone el baseline.
  const audit = spawnSync("npm", ["audit", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (audit.error) {
    console.error(`❌ No se pudo ejecutar npm audit: ${audit.error.message}`);
    process.exitCode = 1;
    return;
  }
  let report: AuditReport & { metadata?: { vulnerabilities?: Record<string, number> } };
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error("❌ La salida de npm audit no es JSON válido:\n");
    console.error((audit.stdout ?? "").slice(0, 2000));
    console.error((audit.stderr ?? "").slice(0, 500));
    process.exitCode = 1;
    return;
  }

  const totals = report.metadata?.vulnerabilities;
  if (totals) {
    console.log(
      `npm audit: ${totals.total ?? 0} vulnerabilidades (` +
        `${totals.low ?? 0} low, ${totals.moderate ?? 0} moderate, ` +
        `${totals.high ?? 0} high, ${totals.critical ?? 0} critical).`,
    );
  }

  const result = evaluateAudit(report, parsed.baseline);

  if (result.ok) {
    console.log(
      `✅ Gate de vulnerabilidades (T-21): ${result.counts.inThreshold} hallazgo(s) high/critical ` +
        `cubierto(s) por audit-baseline.json con justificación; 0 nuevos.`,
    );
    for (const a of result.allowed) {
      console.log(`  - ${a.severity} ${a.package} — ${a.reason}${a.closure ? ` [cierre: ${a.closure}]` : ""}`);
    }
    return;
  }

  console.error(`❌ Gate de vulnerabilidades (T-21, ADR-0038): ${result.failures.length} fallo(s):\n`);
  for (const f of result.failures) {
    console.error(`  [${f.kind}] ${f.message}`);
  }
  if (result.counts.allowed > 0) {
    console.error(`\n  (Cubiertos por el baseline: ${result.allowed.map((a) => a.package).join(", ")})`);
  }
  console.error(
    "\nCómo avanzar: arreglar la dependencia (npm audit fix / T-23), o si el hallazgo " +
      "se resuelve, eliminar la entrada obsoleta de audit-baseline.json en el mismo commit.",
  );
  process.exitCode = 1;
}

main();
