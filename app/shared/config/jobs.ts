/**
 * Parámetros operativos de los jobs de background (T-10, ADR-0034).
 *
 * Son parámetros **operativos** (no reglas de juego): no viven en
 * `season_rules` (AGENTS.md §1.3). Configurables; nunca constantes mágicas
 * en el código.
 *
 * - Nombres de cola BullMQ (estables; el worker y la web deben acordarlos).
 * - Reintentos/backoff si un job falla (BullMQ).
 *
 * La cadencia del polling de resultados vive en `results-poll.ts`
 * (`PROVISIONAL_RESULTS_POLL.intervalMinutes`, US-17/ADR-0019).
 */
import { z } from "zod";

/** Cola de la fórmula de precios por GP (US-08, disparo automático T-10). */
export const JOBS_QUEUE_GP_PRICES = "gp-prices";
/** Cola del polling periódico de resultados (US-17, disparo automático T-10). */
export const JOBS_QUEUE_RESULTS_POLL = "results-poll";

export const jobsConfigSchema = z.object({
  /** Reintentos de BullMQ si un job falla. */
  attempts: z.number().int().min(1),
  /** Backoff base (ms) entre reintentos (exponencial). */
  backoffMs: z.number().int().positive(),
});

export type JobsConfig = z.infer<typeof jobsConfigSchema>;

export const PROVISIONAL_JOBS: JobsConfig = {
  attempts: 3,
  backoffMs: 1000,
};

/**
 * Comprueba que los defaults provisionales siguen siendo válidos contra el
 * esquema (falla en tiempo de ejecución si se desincronizan).
 */
export function assertProvisionalJobsValid(): void {
  const result = jobsConfigSchema.safeParse(PROVISIONAL_JOBS);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `PROVISIONAL_JOBS no pasa jobsConfigSchema: ${issues}`,
    );
  }
}
