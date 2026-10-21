/**
 * Núcleo puro del módulo `results` (sin I/O) — Fase 3 (ADR-0018).
 *
 * Derivación del estado (FINISHED/DNF/ABSENT), códigos importables por
 * tipo de evento, diferencia mínima entre re-importaciones y versionado de
 * `results_version` (`rv-<seq>`). La pureza está garantizada por el check
 * de T-03 (`npm run check:purity`); la única dependencia externa permitida
 * es `shared/types`.
 */
export * from "./types";
export * from "./status";
export * from "./codes";
export * from "./diff";
export * from "./version";
