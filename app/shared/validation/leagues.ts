/**
 * Schemas de entrada del módulo `leagues` (US-23, leagues.md §3).
 *
 * El cliente usa estos schemas para la UX; el servidor SIEMPRE revalida
 * (AGENTS.md §8): el service revalida el payload completo y aplica las
 * reglas de negocio (límites de miembros desde `shared/config`,
 * consistencia tipo/visibilidad) en el límite del módulo.
 */

import { z } from "zod";

/** Tipo de liga (reflejo del enum `LeagueType`). */
export const leagueTypeSchema = z.enum(["private", "public"]);

/** Visibilidad de liga (reflejo del enum `LeagueVisibility`). */
export const leagueVisibilitySchema = z.enum(["public", "unlisted", "private"]);

/** Modo de entrada (reflejo del enum `LeagueEntryMode`). */
export const leagueEntryModeSchema = z.enum(["code", "invite", "mixed"]);

/**
 * Creación de liga (US-23, leagues.md §3): nombre, descripción, tipo,
 * visibilidad, min/máx miembros, modo de entrada y duración.
 *
 * Aquí se valida el formato; los límites de miembros (PROVISIONAL 2–50)
 * y la consistencia tipo/visibilidad los revalida el servicio (server-side).
 */
export const createLeagueInputSchema = z
  .object({
    name: z
      .string()
      .min(1, "El nombre de la liga es obligatorio")
      .max(80, "El nombre de la liga no puede superar los 80 caracteres"),
    description: z
      .string()
      .max(500, "La descripción de la liga no puede superar los 500 caracteres")
      .nullish(),
    type: leagueTypeSchema,
    visibility: leagueVisibilitySchema,
    minMembers: z
      .number()
      .int("Los miembros mínimos deben ser un entero")
      .positive("Los miembros mínimos deben ser positivos"),
    maxMembers: z
      .number()
      .int("Los miembros máximos deben ser un entero")
      .positive("Los miembros máximos deben ser positivos"),
    entryMode: leagueEntryModeSchema,
    // `.nullish()` (no `.optional()`): `z.coerce.date()` convertiría un
    // `null` explícito en la fecha epoch (1970-01-01); con `.nullish()`
    // `null`/`undefined` significan "sin fecha" (AGENTS.md §8: el servidor
    // manda, y un cliente que envíe `null` no debe crear fechas falsas).
    startDate: z.coerce.date().nullish(),
    endDate: z.coerce.date().nullish(),
  })
  .refine((v) => v.minMembers <= v.maxMembers, {
    message: "El mínimo de miembros no puede superar al máximo",
    path: ["minMembers"],
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "La fecha de fin no puede ser anterior a la de inicio",
    path: ["endDate"],
  });

/** Búsqueda de una liga (US-23). */
export const leagueIdInputSchema = z.object({
  leagueId: z.string().uuid("El identificador de liga no es válido"),
});

/**
 * Ranking de una liga (US-24, leagues.md §8): general (`gpId` ausente) o
 * por GP. El acceso (pública ⇒ cualquiera; privada ⇒ miembro activo) lo
 * revalida el servicio (AGENTS.md §8).
 */
export const leagueRankingInputSchema = z.object({
  leagueId: z.string().uuid("El identificador de liga no es válido"),
  gpId: z.string().uuid("El identificador de GP no es válido").nullish(),
});

/**
 * Unión a una liga (US-25, leagues.md §4/§6, ADR-0025):
 * - **Pública:** entrada abierta — se une por `leagueId` (sin código,
 *   ADR-0024).
 * - **Privada:** por `code` (el código resuelve la liga) o `leagueId` +
 *   `code`.
 *
 * Al menos uno de los dos. Aquí se valida el formato; la elegibilidad
 * (estado, modo de entrada, código activo, membresía, plaza) y el
 * anti-fuerza-bruta los revalida el servicio (AGENTS.md §8).
 */
export const joinLeagueInputSchema = z
  .object({
    leagueId: z.string().uuid("El identificador de liga no es válido").nullish(),
    code: z
      .string()
      .trim()
      .min(1, "Introduce el código de invitación")
      .max(64, "El código de invitación no es válido")
      .nullish(),
  })
  .refine((v) => v.leagueId !== undefined || v.code !== undefined, {
    message: "Indica la liga o el código de invitación",
    path: ["leagueId"],
  });

export type LeagueType = z.infer<typeof leagueTypeSchema>;
export type LeagueVisibility = z.infer<typeof leagueVisibilitySchema>;
export type LeagueEntryMode = z.infer<typeof leagueEntryModeSchema>;
export type CreateLeagueInput = z.infer<typeof createLeagueInputSchema>;
export type LeagueIdInput = z.infer<typeof leagueIdInputSchema>;
export type LeagueRankingInput = z.infer<typeof leagueRankingInputSchema>;
export type JoinLeagueInput = z.infer<typeof joinLeagueInputSchema>;
