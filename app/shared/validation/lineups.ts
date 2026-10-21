/**
 * Schemas de input del módulo de lineups (US-09, Fase 2).
 *
 * El cliente envía SOLO los IDs de los activos: nunca coste ni presupuesto
 * (invariante 2 — el servidor recalcula todo con los precios congelados del
 * GP). Las longitudes de `gold`/`silver` no se fuerzan aquí: el núcleo puro
 * (`validateLineup`) las valida con motivos de rechazo en español, para que
 * el mensaje de error sea uno solo y descriptivo.
 */
import { z } from "zod";

/** GP objetivo (mismo contrato que `seasons.gps.*`). */
export const lineupGpIdInputSchema = z.object({
  gpId: z.string().uuid("gpId debe ser un UUID"),
});
export type LineupGpIdInput = z.infer<typeof lineupGpIdInputSchema>;

/** Composición del lineup: 2 oro + 2 plata + 1 constructor + 1 equipo. */
export const saveLineupInputSchema = z.object({
  gpId: z.string().uuid("gpId debe ser un UUID"),
  slots: z.object({
    gold: z.array(z.string().uuid("Cada piloto debe ser un UUID")),
    silver: z.array(z.string().uuid("Cada piloto debe ser un UUID")),
    constructorId: z.string().uuid("constructorId debe ser un UUID"),
    teamId: z.string().uuid("teamId debe ser un UUID"),
  }),
});
export type SaveLineupInput = z.infer<typeof saveLineupInputSchema>;

/**
 * Confirmación de lesión por GP (US-12, ADR-0017): el admin confirma que
 * un piloto no estará en el GP → +1 cambio gratuito a cada usuario que lo
 * tenga en su lineup de ese GP.
 */
export const confirmInjuryInputSchema = z.object({
  gpId: z.string().uuid("gpId debe ser un UUID"),
  assetId: z.string().uuid("assetId debe ser un UUID"),
  reason: z.string().min(1).max(500).optional(),
});
export type ConfirmInjuryInput = z.infer<typeof confirmInjuryInputSchema>;
