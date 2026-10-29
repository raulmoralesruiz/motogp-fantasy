/**
 * Motor de precios — FÓRMULAS PURAS (pricing-v1).
 *
 * Convierte el rendimiento (puntos) de un activo en su serie de precios a
 * lo largo de la temporada. Sin I/O.
 *
 * Fuente de verdad: `docs/product/economy.md` §4.3.
 *
 *   perf(r)      = clamp(puntos(r)/Pmax × 100, 0, 100)
 *   W(r)         = 0.5·perf(r) + 0.3·perf(r−1) + 0.2·perf(r−2)
 *   objetivo(r+1)= P0 × (0.75 + 0.5 × W(r)/100)
 *   precio(r+1)  = precio(r) + 0.5 × (objetivo − precio(r))
 *   precio(r+1)  ← acotado a [0.85·precio(r), 1.15·precio(r)] ∩ [0.25·P0, 2.00·P0]
 *   Lesión:      precio(r+1) = max(0.25·P0, 0.5·precio(r))
 *   Baja temp.:  precio = 0.25·P0
 */

export const PRICING_VERSION = "pricing-v1" as const;

/**
 * Pmax = puntuación máxima de referencia de un activo en un GP.
 *
 * Calibración D-02 (2026-10-29): el motor de precios puntúa solo la carrera
 * principal (ADR-0015), cuyo máximo es 30 (25 por victoria + 5 bono ganador).
 * PMAX_RIDER=30 y PMAX_GROUP=30 (media top-2, máx 30 cada uno) hacen que el
 * punto neutro W=50 corresponda a un podio (15 pts) y una victoria → perf 100.
 * Antes (PMAX_RIDER=60, máx de fin de semana completo) ningún piloto
 * alcanzaba perf > 50 y el mercado era deflacionista por construcción.
 */
export const PMAX_RIDER = 30;
export const PMAX_GROUP = 30; // constructor/equipo (media de 2 pilotos)

/** perf(r) = clamp(puntos/Pmax × 100, 0, 100). */
export function perf(puntos: number, Pmax: number): number {
  return Math.max(0, Math.min(100, (puntos / Pmax) * 100));
}

export interface NextPriceArgs {
  prevPrice: number;
  P0: number;
  /** perf del último GP disputado (perf(r)). */
  perfCurrent: number;
  /** perf(r−1). 0 si no existe. */
  perfPrev1: number;
  /** perf(r−2). 0 si no existe. */
  perfPrev2: number;
}

/**
 * Precio siguiente por fórmula (sin lesión), con acotaciones.
 * Ejemplos verificables (economy.md §7 / AGENTS.md):
 *   P0=20, prev=20, W=50 → 20 · lesión P0=20, prev=20 → 10.
 */
export function computeNextPrice(a: NextPriceArgs): number {
  const { prevPrice, P0, perfCurrent, perfPrev1, perfPrev2 } = a;
  const W = 0.5 * perfCurrent + 0.3 * perfPrev1 + 0.2 * perfPrev2;
  const objetivo = P0 * (0.75 + 0.5 * (W / 100));
  const suavizado = prevPrice + 0.5 * (objetivo - prevPrice);
  const lo = Math.max(0.85 * prevPrice, 0.25 * P0);
  const hi = Math.min(1.15 * prevPrice, 2.0 * P0);
  return Math.max(lo, Math.min(hi, suavizado));
}

/** Lesión confirmada para el GP: precio = max(0.25·P0, 0.5·prev). */
export function injuryPrice(prevPrice: number, P0: number): number {
  return Math.max(0.25 * P0, 0.5 * prevPrice);
}

/** Baja por temporada: precio = 0.25·P0. */
export function seasonAbsencePrice(P0: number): number {
  return 0.25 * P0;
}

/**
 * Serie de precios de un activo a lo largo de la temporada.
 *
 * @param P0        Precio de apertura.
 * @param perfByGp  perfByGp[gp−1] = perf del activo en el GP gp (0..N).
 * @param outByGp   outByGp[gp−1] = true si el activo está fuera (lesionado/baja) en el GP gp.
 * @returns precio[gp−1] = precio vigente en el GP gp. precio[0] = P0.
 *
 * Para gp≥2: si el activo está fuera en el GP gp → regla de lesión; si no,
 * fórmula normal con el perf de los 3 GPs anteriores (gp−1, gp−2, gp−3).
 */
export function buildPriceSeries(
  P0: number,
  perfByGp: number[],
  outByGp: boolean[],
): number[] {
  const N = perfByGp.length;
  const precio: number[] = new Array(N);
  precio[0] = P0;
  for (let gp = 2; gp <= N; gp++) {
    const prevPrice = precio[gp - 2];
    if (prevPrice === undefined) {
      throw new Error(`buildPriceSeries: índice de precio inválido (gp=${gp})`);
    }
    if (outByGp[gp - 1]) {
      precio[gp - 1] = injuryPrice(prevPrice, P0);
    } else {
      const perfCurrent = perfByGp[gp - 2] ?? 0;
      const perfPrev1 = perfByGp[gp - 3] ?? 0;
      const perfPrev2 = perfByGp[gp - 4] ?? 0;
      precio[gp - 1] = computeNextPrice({
        prevPrice,
        P0,
        perfCurrent,
        perfPrev1,
        perfPrev2,
      });
    }
  }
  return precio;
}
