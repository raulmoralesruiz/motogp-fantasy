/**
 * Validación de lineup — FÓRMULA PURA (sin I/O).
 *
 * Comprueba la composición exacta (2 oro + 2 plata + 1 constructor + 1
 * equipo), la ausencia de pilotos duplicados, la afiliación de cada piloto
 * para el GP y los límites de concentración (game-rules.md §2 y §10;
 * ADR-0017).
 *
 * El trigger de BD (migración 0002) garantiza la composición a nivel de
 * tabla; esta validación la aplica ANTES de escribir, con motivos en
 * español (AGENTS.md §2) para el mensaje de rechazo.
 */

import type {
  ConcentrationLimits,
  LineupSlots,
  RiderAffiliation,
} from "./types";

export type LineupValidation =
  | { ok: true }
  | { ok: false; reasons: string[] };

export function validateLineup(
  slots: LineupSlots,
  affiliations: readonly RiderAffiliation[],
  limits: ConcentrationLimits,
): LineupValidation {
  const reasons: string[] = [];

  // Composición exacta (invariante 1).
  if (slots.gold.length !== 2) {
    reasons.push(
      `El lineup debe tener exactamente 2 pilotos oro (tiene ${slots.gold.length})`,
    );
  }
  if (slots.silver.length !== 2) {
    reasons.push(
      `El lineup debe tener exactamente 2 pilotos plata (tiene ${slots.silver.length})`,
    );
  }
  if (!slots.constructorId) reasons.push("Falta el constructor del lineup");
  if (!slots.teamId) reasons.push("Falta el equipo del lineup");

  // Duplicados: un piloto no puede ocupar dos slots.
  const riderIds = [...slots.gold, ...slots.silver];
  const seen = new Set<string>();
  for (const riderId of riderIds) {
    if (seen.has(riderId)) {
      reasons.push(`Piloto duplicado en el lineup: ${riderId}`);
    }
    seen.add(riderId);
  }

  // Afiliación del GP (ADR-0013): sin afiliación no hay equipo/constructor.
  const byRider = new Map<string, RiderAffiliation>();
  for (const a of affiliations) byRider.set(a.riderId, a);

  const affiliationsUsed: RiderAffiliation[] = [];
  for (const riderId of seen) {
    const a = byRider.get(riderId);
    if (!a) {
      reasons.push(`El piloto ${riderId} no tiene afiliación para este GP`);
    } else {
      affiliationsUsed.push(a);
    }
  }

  // Concentración (PROVISIONAL: máx 2 por constructor y por equipo).
  const perConstructor = new Map<string, number>();
  const perTeam = new Map<string, number>();
  for (const a of affiliationsUsed) {
    perConstructor.set(a.constructorId, (perConstructor.get(a.constructorId) ?? 0) + 1);
    perTeam.set(a.teamId, (perTeam.get(a.teamId) ?? 0) + 1);
  }
  for (const [constructorId, n] of perConstructor) {
    if (n > limits.maxPerConstructor) {
      reasons.push(
        `Concentración excedida: ${n} pilotos del constructor ${constructorId} (máx ${limits.maxPerConstructor})`,
      );
    }
  }
  for (const [teamId, n] of perTeam) {
    if (n > limits.maxPerTeam) {
      reasons.push(
        `Concentración excedida: ${n} pilotos del equipo ${teamId} (máx ${limits.maxPerTeam})`,
      );
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
