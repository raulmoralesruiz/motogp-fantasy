/**
 * Presupuesto derivado de movimientos — FÓRMULAS PURAS (sin I/O, ADR-0017).
 *
 * El presupuesto por GP se deriva de `budget_movements` (data-model.md §5:
 * el saldo se deriva, no se almacena suelto):
 *
 * - Primer save del GP n: `base(B)` + `carry(min(t·sin_usar_{n-1}, cmax))`
 *   + `spend(−coste)`, con `sin_usar_{n-1} = max(0, saldo_{n-1})`.
 * - Cada cambio posterior: `spend(−Δcoste)` (Δ = coste_after − coste_before;
 *   Δ < 0 → devolución).
 *
 * El carry reutiliza `presupuestoE` de `modules/economy` (opción E,
 * RECOMENDADO) para que la fórmula viva en un único sitio: anti-ratchet —
 * el presupuesto nunca depende del valor de mercado del equipo del usuario
 * (invariante 8, la ventaja central del producto).
 */

import { presupuestoE, type BudgetParams } from "@/modules/economy";

import { round2 } from "./money";
import type { BudgetMovement } from "./types";

/** Saldo = suma de movimientos (derivado, no almacenado). */
export function balanceFromMovements(movements: readonly BudgetMovement[]): number {
  return round2(movements.reduce((acc, m) => acc + m.amount, 0));
}

/**
 * Presupuesto que recibirá el usuario en el GP n si aún no ha guardado
 * (opción E, ADR-0017): `B + min(t·sin_usar_{n-1}, cmax)`.
 *
 * `prevBalance` es el saldo del GP anterior (0 en el primer GP de la
 * temporada → carry 0). Es la MISMA fórmula que `save` valida en el primer
 * save: el presupuesto mostrado (US-10) coincide con el validado.
 * Anti-ratchet: no depende del valor de mercado de los activos (invariante 8).
 */
export function firstSaveBudget(
  params: BudgetParams,
  prevBalance: number,
): number {
  return round2(
    presupuestoE(params, {
      sinUsarPrevio: Math.max(0, prevBalance),
      valorEquipo: 0, // opción E: no se usa
      puntosJugador: 0, // opción E: no se usa
      mediaPuntos: 0, // opción E: no se usa
    }),
  );
}

/**
 * Movimientos del primer save del GP n (opción E, ADR-0017):
 * `base(B)` + `carry` + `spend(−coste)`.
 */
export function firstSaveMovements(
  params: BudgetParams,
  prevBalance: number,
  cost: number,
): BudgetMovement[] {
  const total = firstSaveBudget(params, prevBalance);
  return [
    { type: "base", amount: round2(params.B) },
    { type: "carry", amount: round2(total - params.B) },
    { type: "spend", amount: -round2(cost) },
  ];
}

/**
 * Desglose del presupuesto del GP a partir de los movimientos (US-10):
 * `base` + `carry` (total = B + carry, ADR-0017).
 */
export function budgetBreakdown(
  movements: readonly BudgetMovement[],
): { base: number; carry: number; total: number } {
  const base = round2(
    movements
      .filter((m) => m.type === "base")
      .reduce((acc, m) => acc + m.amount, 0),
  );
  const carry = round2(
    movements
      .filter((m) => m.type === "carry")
      .reduce((acc, m) => acc + m.amount, 0),
  );
  return { base, carry, total: round2(base + carry) };
}

/**
 * Movimiento de un cambio posterior: `spend(−Δcoste)`.
 * Δ < 0 (baja el coste) → devolución (importe positivo).
 * Se calcula como `round2(before − after)` para que Δ = 0 devuelva `+0`
 * (no `-0`).
 */
export function changeSpendMovement(
  costBefore: number,
  costAfter: number,
): BudgetMovement {
  return { type: "spend", amount: round2(costBefore - costAfter) };
}
