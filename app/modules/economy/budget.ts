/**
 * Motor de presupuesto — FÓRMULAS PURAS.
 *
 * Define cómo evoluciona el presupuesto de un jugador GP a GP para cada
 * opción económica (A, B, C, E). Sin I/O.
 *
 * Fuente de verdad: `docs/product/economy.md` §2–§4.
 *
 * - A (fijo): presupuesto = B.
 * - B (oficial, ratchet): cap = valor de mercado del equipo + sin usar.
 * - C (dinámico): cap = B ajustado ±20% por rendimiento relativo, suelo 0.8B / techo 1.2B.
 * - E (híbrido, RECOMENDADO): presupuesto = B + min(t × sin_usar_previo, cmax).
 */

export type BudgetOption = "A" | "B" | "C" | "E";

/** Parámetros de la economía (PROVISIONAL, configurables por temporada). */
export interface BudgetParams {
  /** Presupuesto base por GP (B). */
  B: number;
  /** Tasa de carry (t) — solo opción E. */
  t: number;
  /** Tope de carry (cmax) — solo opción E. */
  cmax: number;
}

/**
 * Contexto del GP anterior necesario para calcular el presupuesto del
 * siguiente GP.
 */
export interface BudgetContext {
  /** Dinero sin usar del GP anterior (presupuesto − coste). */
  sinUsarPrevio: number;
  /** Valor de mercado del lineup a los precios nuevos (opción B). */
  valorEquipo: number;
  /** Puntos del jugador en el GP anterior (opción C). */
  puntosJugador: number;
  /** Puntos medios del campo en el GP anterior (opción C). */
  mediaPuntos: number;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Opción A — presupuesto fijo. */
export function presupuestoA(params: BudgetParams): number {
  return params.B;
}

/** Opción E — base + carry limitado (RECOMENDADO). */
export function presupuestoE(params: BudgetParams, ctx: BudgetContext): number {
  return params.B + Math.min(params.t * ctx.sinUsarPrevio, params.cmax);
}

/** Opción B — oficial: valor de mercado + sin usar (ratchet). */
export function presupuestoB(ctx: BudgetContext): number {
  return ctx.valorEquipo + ctx.sinUsarPrevio;
}

/**
 * Opción C — dinámico con límites.
 * cap = B × (1 + 0.2 × clamp(desviación relativa, −1, 1)), acotado a [0.8B, 1.2B].
 * La desviación relativa = (puntosJugador − media) / media.
 */
export function presupuestoC(params: BudgetParams, ctx: BudgetContext): number {
  const media = Math.max(1, ctx.mediaPuntos);
  const rel = (ctx.puntosJugador - ctx.mediaPuntos) / media;
  const ajustado = params.B * (1 + 0.2 * clamp(rel, -1, 1));
  return clamp(ajustado, 0.8 * params.B, 1.2 * params.B);
}

/**
 * Presupuesto del siguiente GP según la opción.
 * (El presupuesto del GP1 es `B` para todas las opciones; se gestiona en el orquestador.)
 */
export function presupuesto(
  opcion: BudgetOption,
  params: BudgetParams,
  ctx: BudgetContext,
): number {
  switch (opcion) {
    case "A":
      return presupuestoA(params);
    case "E":
      return presupuestoE(params, ctx);
    case "B":
      return presupuestoB(ctx);
    case "C":
      return presupuestoC(params, ctx);
  }
}
