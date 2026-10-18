/**
 * Estado del GP (US-05): tabla de transiciones pura.
 *
 * Ciclo de vida (CA US-05): `scheduled → locked → finished/cancelled`.
 *
 * - `scheduled → locked`: cierre del lineup (congelamiento de precios —
 *   game-rules.md §6).
 * - `locked → finished`: publicación de los resultados definitivos.
 * - `scheduled → cancelled` / `locked → cancelled`: GP cancelado.
 * - `finished` y `cancelled` son estados terminales.
 *
 * `scheduled → finished` NO está permitido a propósito: el lockout es el
 * punto en el que se congelan precios y lineups, y un GP no puede cerrarse
 * sin pasar por él (aunque no se hayan presentado lineups: el admin lo
 * bloquea y luego lo finaliza).
 *
 * Módulo puro (sin I/O): `GpService` aplica la tabla y reporta el motivo
 * en español. `GpStatusValue` refleja el enum `GpStatus` del schema de
 * Prisma (misma unión de literales, sin dependencia del cliente generado).
 */

/** Estados posibles de un GP (reflejo del enum `GpStatus` de Prisma). */
export const GP_STATUSES = ["scheduled", "locked", "finished", "cancelled"] as const;

export type GpStatusValue = (typeof GP_STATUSES)[number];

/** Transiciones válidas por estado de origen (CA US-05). */
export const GP_TRANSITIONS: Record<GpStatusValue, readonly GpStatusValue[]> = {
  scheduled: ["locked", "cancelled"],
  locked: ["finished", "cancelled"],
  finished: [],
  cancelled: [],
};

/** ¿`value` es un estado de GP conocido? */
export function isGpStatus(value: unknown): value is GpStatusValue {
  return typeof value === "string" && (GP_STATUSES as readonly string[]).includes(value);
}

/** ¿La transición `from → to` está permitida? (mismo estado: no). */
export function canTransitionGpStatus(from: GpStatusValue, to: GpStatusValue): boolean {
  return GP_TRANSITIONS[from].includes(to);
}

/** Estados a los que se puede pasar desde `from` (vacío si es terminal). */
export function allowedGpStatusTransitions(from: GpStatusValue): GpStatusValue[] {
  return [...GP_TRANSITIONS[from]];
}
