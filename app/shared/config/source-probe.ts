/**
 * Parámetros PROVISIONAL del health-check de la fuente de datos (T-14,
 * ADR-0036): cada ciclo del worker de polling (US-17, cada 5 min) sondea
 * el endpoint ligero de PulseLive AUNQUE no haya GPs en la ventana, para
 * detectar "la fuente ha dejado de responder" también fuera de fines de
 * semana.
 *
 * - `timeoutMs`: límite de respuesta del probe (5 s; la fuente responde en
 *   <1 s normalmente).
 * - `failureAlertThreshold`: fallos consecutivos del probe que disparan la
 *   alerta (mismo umbral que el polling, `PROVISIONAL_RESULTS_POLL`).
 *
 * Configurables (AGENTS.md §1.3: nunca constantes mágicas; son parámetros
 * operativos, no reglas de juego → no viven en `season_rules`).
 */
import { z } from "zod";

export const sourceProbeConfigSchema = z.object({
  /** Límite de respuesta del probe, en milisegundos. */
  timeoutMs: z.number().int("Debe ser un entero").positive(),
  /** Fallos consecutivos del probe que disparan la alerta (N). */
  failureAlertThreshold: z.number().int("Debe ser un entero").min(1),
});

export type SourceProbeConfig = z.infer<typeof sourceProbeConfigSchema>;

export const PROVISIONAL_SOURCE_PROBE: SourceProbeConfig = {
  timeoutMs: 5000,
  failureAlertThreshold: 3,
};

/**
 * Comprueba que los defaults provisionales siguen siendo válidos contra el
 * esquema (falla en tiempo de ejecución si se desincronizan).
 */
export function assertProvisionalSourceProbeValid(): void {
  const result = sourceProbeConfigSchema.safeParse(PROVISIONAL_SOURCE_PROBE);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `PROVISIONAL_SOURCE_PROBE no pasa sourceProbeConfigSchema: ${issues}`,
    );
  }
}
