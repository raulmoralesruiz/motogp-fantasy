/**
 * Módulo `results` — importación, provisional/definitivo y recálculo.
 *
 * Fase 3 (E5, US-16, ADR-0018):
 * - `core/` — FÓRMULAS PURAS (sin I/O): derivación del estado
 *   (FINISHED/DNF/ABSENT), códigos importables por tipo de evento,
 *   diferencia mínima entre re-importaciones y versionado de
 *   `results_version` (`rv-<seq>`). Auditado por el check de pureza (T-03).
 * - `results-service` — orquestación con Prisma: importación manual por
 *   evento (gates, diff, correcciones con histórico, efectos de estado y
 *   auditoría atómica) + consultas de solo lectura para la UI de admin.
 *
 * Responsabilidad:
 * - Importación idempotente por `(gp, event, rider)` (re-importar no
 *   duplica; invariante 6).
 * - Estado `provisional → definitive` (o `corrected`); los resultados no se
 *   borran, se corrigen, con histórico en `results_history`.
 * - Cada resultado guarda `source` (fuente+versión) y `raw` (payload
 *   original) para auditoría.
 * - Recálculo auditable: nueva `results_version`, lock por GP, misma
 *   `rules_version` (US-18/US-19, T-10 job de recálculo).
 */
export * from "./core";
export * from "./results-service";
export * from "./pulselive-source";
