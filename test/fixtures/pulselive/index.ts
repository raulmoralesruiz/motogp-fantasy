/**
 * Fixtures grabados en vivo de PulseLive (US-17, ADR-0019) — GP de
 * Indonesia 2026 (Q2, sprint y carrera principal), grabados el 2026-10-21.
 *
 * Son datos reales de la API pública (sin PII de usuarios del juego); el
 * origen, los endpoints y los checksums están en `README.md`.
 *
 * Uso:
 * - `app/modules/results/__tests__/pulselive-source.test.ts` — tests de
 *   contrato del normalizador puro (`normalizePulseLiveClassification`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PulseLiveClassification } from "../../../app/modules/results/pulselive-source.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJson<T>(file: string): T {
  const raw = readFileSync(path.join(HERE, file), "utf-8");
  return JSON.parse(raw) as T;
}

/** Q2 del GP de Indonesia 2026 (12 entradas `INSTND`; sin campo `points`). */
export const indonesiaQ2 = readJson<PulseLiveClassification>(
  "q2-indonesia-2026.json",
);

/** Sprint del GP de Indonesia 2026 (20 terminados + 2 DNF `NOTFINISHFIRST`). */
export const indonesiaSprint = readJson<PulseLiveClassification>(
  "spr-indonesia-2026.json",
);

/** Carrera del GP de Indonesia 2026 (17 terminados + 4 DNF `OUTSTND`). */
export const indonesiaRace = readJson<PulseLiveClassification>(
  "rac-indonesia-2026.json",
);
