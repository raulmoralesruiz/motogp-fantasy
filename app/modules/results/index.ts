/**
 * Módulo `results` — importación, provisional/definitivo y recálculo.
 *
 * Placeholder de Fase 0 (T-03): la estructura existe; el contenido se
 * implementa en Fase 3 (E5: US-16…US-20, T-10 job de recálculo).
 *
 * Responsabilidad:
 * - Importación idempotente por `(gp, event, rider)` (re-importar no duplica).
 * - Estado `provisional → definitive` (o `corrected`); los resultados no se
 *   borran, se corrigen, con histórico en `results_history`.
 * - Cada resultado guarda `source` (fuente+versión) y `raw` (payload original).
 * - Recálculo auditable: nueva `results_version`, lock por GP, misma
 *   `rules_version`.
 */
export {};
