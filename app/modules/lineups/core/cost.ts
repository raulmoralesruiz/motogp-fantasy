/**
 * Coste del lineup — FÓRMULA PURA (sin I/O).
 *
 * El coste se recalcula SIEMPRE en el servidor con la lista de precios
 * congelada del GP (invariante 2, ADR-0015): el cliente nunca envía un
 * coste ni un presupuesto de confianza. Un activo sin precio para el GP →
 * rechazado con la lista de activos faltantes (motivo).
 */

import { round2 } from "./money";
import type { AssetKind, GpPrice, LineupSlots } from "./types";

export type LineupCostResult =
  | { ok: true; cost: number }
  | { ok: false; missing: { assetType: AssetKind; assetId: string }[] };

export function lineupCost(
  slots: LineupSlots,
  prices: readonly GpPrice[],
): LineupCostResult {
  const byKey = new Map<string, number>();
  for (const p of prices) byKey.set(`${p.assetType}:${p.assetId}`, p.price);

  const assets: { assetType: AssetKind; assetId: string }[] = [
    ...slots.gold.map(
      (id): { assetType: AssetKind; assetId: string } => ({
        assetType: "rider",
        assetId: id,
      }),
    ),
    ...slots.silver.map(
      (id): { assetType: AssetKind; assetId: string } => ({
        assetType: "rider",
        assetId: id,
      }),
    ),
  ];
  if (slots.constructorId) {
    assets.push({ assetType: "constructor", assetId: slots.constructorId });
  }
  if (slots.teamId) {
    assets.push({ assetType: "team", assetId: slots.teamId });
  }

  const missing: { assetType: AssetKind; assetId: string }[] = [];
  let cost = 0;
  for (const a of assets) {
    const price = byKey.get(`${a.assetType}:${a.assetId}`);
    if (price === undefined) {
      missing.push(a);
    } else {
      cost += price;
    }
  }

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, cost: round2(cost) };
}
