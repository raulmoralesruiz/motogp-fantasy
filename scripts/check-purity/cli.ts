/**
 * Check de pureza (T-03) — CLI.
 *
 * Audita los módulos puros (`economy`, `scoring` y el núcleo de `lineups`):
 * falla (exit ≠ 0) si alguno importa I/O, infraestructura de la aplicación,
 * módulos externos o usa el reloj. Excluye `__tests__` (los archivos de
 * prueba usan vitest).
 *
 * Uso: `npm run check:purity` (también corre como parte de `npm run build`).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findPurityViolations, type ScannedFile } from "./lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/** Módulos puros a auditar (T-03, AGENTS.md §3). */
const MODULE_ROOTS = ["app/modules/economy", "app/modules/scoring", "app/modules/lineups/core"];
/** Directorios permitidos fuera del módulo. */
const ALLOWED_EXTERNAL_DIRS = ["app/shared/types"];
/**
 * Dependencias puras permitidas por raíz: el núcleo de `lineups` reutiliza el
 * motor de presupuesto de `economy` (opción E) para no duplicar la fórmula
 * del carry (ADR-0017).
 */
const ALLOWED_BY_ROOT: Record<string, string[]> = {
  "app/modules/lineups/core": ["app/modules/economy"],
};

/** Recoge archivos .ts/.tsx de forma recursiva, saltando `__tests__` y directorios de infra. */
function collectFiles(absDir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(absDir).sort()) {
    if (entry === "__tests__" || entry === "node_modules" || entry === ".next") continue;
    const full = path.join(absDir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function main(): void {
  const files: ScannedFile[] = [];
  for (const root of MODULE_ROOTS) {
    for (const abs of collectFiles(path.join(repoRoot, root))) {
      const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
      files.push({ path: rel, content: readFileSync(abs, "utf8") });
    }
  }

  const violations = findPurityViolations(files, {
    moduleRoots: MODULE_ROOTS,
    allowedExternalDirs: ALLOWED_EXTERNAL_DIRS,
    allowedByRoot: ALLOWED_BY_ROOT,
  });

  if (violations.length === 0) {
    console.log(
      `✅ Check de pureza: ${files.length} archivos auditados (economy, scoring, lineups/core) — sin violaciones.`,
    );
    return;
  }

  console.error(
    `❌ Check de pureza: ${violations.length} violación(es) en módulos puros:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.reason}`);
  }
  console.error(
    "\nLos módulos puros (economy/scoring/lineups-core) no pueden usar I/O, " +
      "infraestructura de la aplicación, módulos externos (solo se permite " +
      "app/shared/types y las dependencias puras declaradas por raíz) ni el reloj.",
  );
  process.exitCode = 1;
}

main();
