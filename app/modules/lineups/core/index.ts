/**
 * Núcleo puro del módulo `lineups` (sin I/O) — Fase 2 (ADR-0017).
 *
 * Composición exacta (2+2+1+1), coste con precios congelados del GP,
 * presupuesto derivado de movimientos y contabilidad de cambios. La pureza
 * está garantizada por el check de T-03 (`npm run check:purity`); la única
 * dependencia externa permitida es `modules/economy` (fórmula del carry).
 */
export * from "./types";
export * from "./money";
export * from "./validation";
export * from "./cost";
export * from "./budget";
export * from "./changes";
export * from "./diff";
