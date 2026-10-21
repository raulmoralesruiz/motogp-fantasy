/**
 * Dinero en créditos con 2 decimales.
 *
 * Redondeo al céntimo para evitar deriva de punto flotante en sumas: los
 * precios viven en BD como Decimal(10,2) y el coste de un lineup suma 6.
 */

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
