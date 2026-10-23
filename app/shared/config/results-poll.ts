/**
 * Parámetros PROVISIONAL del job de auto-import de resultados (US-17,
 * ADR-0019).
 *
 * - Ventana de polling: GPs con `date` (carrera) en
 *   `[now − windowBeforeHours, now + windowAfterHours]`. 48 h antes
 *   cubre Q2/sprint de un fin de semana; 24 h después cubre la carrera
 *   y un posible reinicio.
 * - `intervalMinutes`: cadencia del job (5 min, ADR-0019).
 * - `failureAlertThreshold` (N=3): a partir de N fallos consecutivos el
 *   job emite alerta (UI admin, `source_state`).
 *
 * Configurables por temporada (AGENTS.md §1.3): se calibran en las tareas
 * `D-xx` del backlog; nunca como constantes mágicas en el código.
 */

import { z } from "zod";

export const resultsPollConfigSchema = z.object({
  /** Horas antes de la carrera desde las que se empieza a sondear. */
  windowBeforeHours: z.number().int("Debe ser un entero").min(0),
  /** Horas después de la carrera hasta las que se sigue sondeando. */
  windowAfterHours: z.number().int("Debe ser un entero").min(0),
  /** Cadencia del job, en minutos. */
  intervalMinutes: z.number().int("Debe ser un entero").min(1),
  /** Fallos consecutivos que disparan la alerta (N). */
  failureAlertThreshold: z.number().int("Debe ser un entero").min(1),
});

export type ResultsPollConfig = z.infer<typeof resultsPollConfigSchema>;

export const PROVISIONAL_RESULTS_POLL: ResultsPollConfig = {
  windowBeforeHours: 48,
  windowAfterHours: 24,
  intervalMinutes: 5,
  failureAlertThreshold: 3,
};

/**
 * Comprueba que los defaults provisionales siguen siendo válidos contra el
 * esquema (falla en tiempo de ejecución si se desincronizan).
 */
export function assertProvisionalResultsPollValid(): void {
  const result = resultsPollConfigSchema.safeParse(PROVISIONAL_RESULTS_POLL);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `PROVISIONAL_RESULTS_POLL no pasa resultsPollConfigSchema: ${issues}`,
    );
  }
}
