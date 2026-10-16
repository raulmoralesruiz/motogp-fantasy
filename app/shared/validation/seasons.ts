/**
 * Schemas de entrada del módulo `seasons` (US-04).
 *
 * La versión de la fila `season_rules` se deriva de `rules.rulesVersion`
 * (fuente única de verdad: ambos no pueden divergir).
 *
 * El cliente usa estos schemas para la UX; el servidor siempre revalida
 * (AGENTS.md §8): el service revalida las reglas contra
 * `seasonRulesSchema` en el límite del módulo.
 */

import { z } from "zod";

import { seasonRulesSchema } from "./season-rules";

/** Creación de temporada (US-04): nombre, año, fechas opcionales y reglas iniciales. */
export const createSeasonInputSchema = z
  .object({
    name: z
      .string()
      .min(1, "El nombre de la temporada es obligatorio")
      .max(120, "El nombre de la temporada no puede superar los 120 caracteres"),
    year: z
      .number()
      .int("El año debe ser un entero")
      .min(1900, "El año debe ser 1900 o posterior")
      .max(2200, "El año no puede superar 2200"),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    /** Versión de reglas inicial (validada en su totalidad por `seasonRulesSchema`). */
    rules: seasonRulesSchema,
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "La fecha de fin no puede ser anterior a la de inicio",
    path: ["endDate"],
  });

/** Alta de una nueva versión de reglas en una temporada existente (US-04). */
export const addRulesVersionInputSchema = z.object({
  seasonId: z.string().uuid("El identificador de temporada no es válido"),
  rules: seasonRulesSchema,
});

/** Búsqueda de una temporada (US-04). */
export const seasonIdInputSchema = z.object({
  seasonId: z.string().uuid("El identificador de temporada no es válido"),
});

export type CreateSeasonInput = z.infer<typeof createSeasonInputSchema>;
export type AddRulesVersionInput = z.infer<typeof addRulesVersionInputSchema>;
export type SeasonIdInput = z.infer<typeof seasonIdInputSchema>;
