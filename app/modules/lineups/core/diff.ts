/**
 * Diferencia mínima entre dos composiciones — FÓRMULA PURA (sin I/O).
 *
 * Un "save" posterior reemplaza la composición completa del GP; la
 * contabilidad consume el MÍNIMO número de cambios (ADR-0017):
 *
 * - Cada piloto de salida emparejado con uno de entrada = `swap` (1
 *   cambio). El emparejado es determinista: ambos conjuntos ordenados por
 *   ID.
 * - Entradas sin emparejar = `add`; salidas sin emparejar = `remove`
 *   (1 cambio cada una).
 * - Constructor o equipo distintos = `swap` (1 cambio cada uno).
 * - Reasignar oro↔plata con el mismo conjunto de pilotos NO consume
 *   cambio (US-11: gratis; el slot de un piloto no cuenta, solo el
 *   conjunto), pero se registra en el historial como `gold_silver`
 *   (una entrada por piloto reasignado, orden determinista por ID).
 *
 * El resultado es la lista de filas de `lineup_changes` a escribir (una
 * por cambio lógico), con `costBefore`/`costAfter` que fija el servicio.
 */

import type { AssetKind, LineupSlots } from "./types";

/** Cambio lógico entre dos composiciones (una fila de `lineup_changes`). */
export interface SlotChange {
  /**
   * `add`/`remove`/`swap` consumen 1 cambio del GP; `gold_silver` es
   * gratuita (US-11) y solo queda registrada en el historial.
   */
  type: "add" | "remove" | "swap" | "gold_silver";
  assetType: AssetKind;
  /**
   * Activo implicado: el nuevo en un `swap`, el añadido en un `add`, el
   * retirado en un `remove`, el reasignado en un `gold_silver`. `null`
   * solo si la composición siguiente no lleva constructor/equipo
   * (composición inválida: la validación previa ya la rechazó).
   */
  assetId: string | null;
}

export function diffSlots(oldSlots: LineupSlots, next: LineupSlots): SlotChange[] {
  const changes: SlotChange[] = [];

  const oldRiders = new Set([...oldSlots.gold, ...oldSlots.silver]);
  const nextRiders = new Set([...next.gold, ...next.silver]);

  const removed = [...oldRiders].filter((id) => !nextRiders.has(id)).sort();
  const added = [...nextRiders].filter((id) => !oldRiders.has(id)).sort();

  const swaps = Math.min(removed.length, added.length);
  for (let i = 0; i < swaps; i += 1) {
    changes.push({ type: "swap", assetType: "rider", assetId: added[i] ?? null });
  }
  for (let i = swaps; i < added.length; i += 1) {
    changes.push({ type: "add", assetType: "rider", assetId: added[i] ?? null });
  }
  for (let i = swaps; i < removed.length; i += 1) {
    changes.push({ type: "remove", assetType: "rider", assetId: removed[i] ?? null });
  }

  // Reasignaciones oro↔plata: el piloto sigue en el lineup pero cambia de
  // tier. No consumen cambio (US-11: gratis), pero se registran en el
  // historial como `gold_silver` (ADR-0017 §4).
  const oldGold = new Set(oldSlots.gold);
  const nextGold = new Set(next.gold);
  const reassigned = [...oldRiders]
    .filter((id) => nextRiders.has(id) && oldGold.has(id) !== nextGold.has(id))
    .sort();
  for (const id of reassigned) {
    changes.push({ type: "gold_silver", assetType: "rider", assetId: id });
  }

  if (oldSlots.constructorId !== next.constructorId) {
    changes.push({
      type: "swap",
      assetType: "constructor",
      assetId: next.constructorId,
    });
  }
  if (oldSlots.teamId !== next.teamId) {
    changes.push({ type: "swap", assetType: "team", assetId: next.teamId });
  }

  return changes;
}
