/**
 * Parámetros de mercado (siembra de precios) — calibración P0 (2026-10-31).
 *
 * El rango P0 (precio de apertura) es un parámetro de **siembra**: lo usa el
 * admin al re-seed los P0 (heurística de ADR-0014, `calculateP0FromClassification`).
 * NO es una regla de juego (no entra en la fórmula de presupuesto ni de
 * puntuación), por lo que no vive en `season_rules` (tabla versionada por
 * temporada); vive aquí, en `shared/config`, como parámetro tipado y
 * testeable (AGENTS.md §1.3: nunca como constante mágica en el código).
 *
 * Calibración (Opción B, 2026-10-31): el rango original 30→10 hacía que el
 * lineup competitivo (mejores 4 riders + mejor constructor + mejor equipo)
 * costase ~173 (~1.7× el presupuesto base B=100, ADR-0030). Se escala por
 * k≈0.58 (30→17.4, 10→5.8) para que ese lineup cueste ~100, es decir, justo
 * el presupuesto base. `B`/`t`/`cmax`/`Pmax` y la fórmula de precios
 * (pricing-v1) no cambian.
 *
 * - `p0.max`: P0 del piloto 1º (posición 1 en la clasificación).
 * - `p0.min`: P0 del piloto último (posición n en la clasificación).
 * - Los P0 de equipos/constructores son la media de los P0 de sus riders
 *   (ADR-0014), por lo que heredan la misma escala.
 */

import { z } from "zod";

export const marketConfigSchema = z
  .object({
    /** Rango P0 (precio de apertura) de los pilotos. */
    p0: z.object({
      /** P0 del piloto 1º (posición 1 en la clasificación). */
      max: z.number().positive("El P0 máximo debe ser positivo"),
      /** P0 del piloto último (posición n en la clasificación). */
      min: z.number().positive("El P0 mínimo debe ser positivo"),
    }),
  })
  .refine((cfg) => cfg.p0.min <= cfg.p0.max, {
    message: "El P0 mínimo no puede superar al máximo",
    path: ["p0", "min"],
  });

export type MarketConfig = z.infer<typeof marketConfigSchema>;

export const PROVISIONAL_MARKET_CONFIG: MarketConfig = {
  p0: {
    max: 17.4,
    min: 5.8,
  },
};

/**
 * Comprueba que los defaults siguen siendo válidos contra el esquema (falla
 * en tiempo de ejecución si se desincronizan).
 */
export function assertProvisionalMarketConfigValid(): void {
  const result = marketConfigSchema.safeParse(PROVISIONAL_MARKET_CONFIG);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `PROVISIONAL_MARKET_CONFIG no pasa marketConfigSchema: ${issues}`,
    );
  }
}
