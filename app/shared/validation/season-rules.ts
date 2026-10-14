/**
 * Esquema de las reglas de temporada (`season_rules`) — T-18.
 *
 * Valida el JSONB versionado que vive en la tabla `season_rules`
 * (`docs/architecture/data-model.md` §2). Todos los valores PROVISIONAL
 * (AGENTS.md §1.3) se calibran en las tareas `D-xx` del backlog.
 *
 * Versionado: cada cambio de reglas crea una nueva `rulesVersion`; una
 * versión publicada nunca se muta (AGENTS.md §5).
 *
 * Fuentes de verdad: `docs/product/economy.md` §4, `docs/product/scoring.md`,
 * `docs/product/game-rules.md`.
 */

import { z } from "zod";

/**
 * Tabla de puntos por posición (1-based). Las claves son números de posición
 * como string (restricción de JSON).
 */
const positionTableSchema = z
  .record(z.number().int().nonnegative())
  .refine((table) => Object.keys(table).length > 0, {
    message: "La tabla de puntuación debe tener al menos una posición",
  })
  .refine((table) => Object.keys(table).every((k) => /^\d+$/.test(k) && Number(k) >= 1), {
    message: "Las claves de la tabla deben ser posiciones (enteros positivos)",
  });

export const seasonRulesSchema = z
  .object({
    /** Versión de reglas (p. ej. "2026-v1"). Inmutable una vez publicada. */
    rulesVersion: z.string().min(1, "La versión de reglas es obligatoria"),

    /** Economía (economy.md §4). */
    economy: z.object({
      /** Opción económica: A (fijo), B (ratchet), C (dinámico), E (híbrido, recomendado). */
      option: z.enum(["A", "B", "C", "E"], {
        message: "La opción económica debe ser A, B, C o E",
      }),
      /** Presupuesto base por GP (B). */
      B: z.number().positive("El presupuesto base (B) debe ser positivo"),
      /** Tasa de carry (t) — opción E. */
      t: z
        .number()
        .min(0, "La tasa de carry (t) no puede ser negativa")
        .max(1, "La tasa de carry (t) no puede superar 1"),
      /** Tope de carry (cmax) — opción E. */
      cmax: z.number().nonnegative("El tope de carry (cmax) no puede ser negativo"),
    }),

    /** Precios (economy.md §4.3). */
    pricing: z.object({
      /** Puntuación máxima de referencia de un piloto en un GP (Pmax). */
      pmaxRider: z.number().positive("Pmax de piloto debe ser positivo"),
      /** Puntuación máxima de referencia de un grupo (constructor/equipo). */
      pmaxGroup: z.number().positive("Pmax de grupo debe ser positivo"),
    }),

    /** Puntuación (scoring.md). */
    scoring: z.object({
      /** Puntos por posición en Q2 (clasificación). */
      q2: positionTableSchema,
      /** Puntos por posición en la sprint. */
      sprint: positionTableSchema,
      /** Puntos por posición en la carrera principal. */
      mainRace: positionTableSchema,
      /** Bono por ganar la carrera principal. */
      winnerBonus: z.number().nonnegative("El bono de ganador no puede ser negativo"),
      /** Bono de vuelta rápida. */
      fastestLapBonus: z
        .number()
        .nonnegative("El bono de vuelta rápida no puede ser negativo"),
      /** Bono de pole position. */
      poleBonus: z.number().nonnegative("El bono de pole no puede ser negativo"),
      /** Bono por posición ganada. */
      positionsGainedBonus: z
        .number()
        .int("El bono por posición ganada debe ser entero")
        .nonnegative("El bono por posición ganada no puede ser negativo"),
      /** Tope del bono de posiciones ganadas. */
      positionsGainedMax: z
        .number()
        .int("El tope de posiciones ganadas debe ser entero")
        .nonnegative("El tope de posiciones ganadas no puede ser negativo"),
      /** Bono de resultado extraordinario. */
      extraordinaryBonus: z
        .number()
        .nonnegative("El bono de resultado extraordinario no puede ser negativo"),
      /** Penalización por DNF. */
      dnfPenalty: z.number().nonnegative("La penalización de DNF no puede ser negativa"),
      /** Penalización por descalificación (DQ). */
      dqPenalty: z.number().nonnegative("La penalización de DQ no puede ser negativa"),
      /** Penalización de tiempo aplicada. */
      timePenalty: z
        .number()
        .nonnegative("La penalización de tiempo no puede ser negativa"),
      /** Peso del oro (1.0 = 100%). */
      goldWeight: z.number().positive("El peso del oro debe ser positivo"),
      /** Peso de la plata (0.5 = 50%). */
      silverWeight: z
        .number()
        .min(0, "El peso de la plata no puede ser negativo")
        .max(1, "El peso de la plata no puede superar 1"),
    }),

    /** Límites de concentración (game-rules.md). */
    limits: z.object({
      /** Máximo de pilotos por constructor en un lineup. */
      maxPerConstructor: z
        .number()
        .int("El máximo por constructor debe ser entero")
        .positive("El máximo por constructor debe ser positivo"),
      /** Máximo de pilotos por equipo en un lineup. */
      maxPerTeam: z
        .number()
        .int("El máximo por equipo debe ser entero")
        .positive("El máximo por equipo debe ser positivo"),
    }),

    /** Transfers (game-rules.md). */
    transfers: z.object({
      /** Cambios por GP. */
      perGp: z
        .number()
        .int("Los cambios por GP deben ser enteros")
        .nonnegative("Los cambios por GP no pueden ser negativos"),
      /** Exención por lesión (cambio gratuito). */
      injuryExemption: z.boolean(),
      /** Wildcards por temporada. */
      wildcardsPerSeason: z
        .number()
        .int("Los wildcards deben ser enteros")
        .nonnegative("Los wildcards no pueden ser negativos"),
    }),

    /** Ligas (leagues.md). */
    league: z.object({
      /** Miembros mínimos. */
      minMembers: z
        .number()
        .int("Los miembros mínimos deben ser enteros")
        .min(2, "Una liga necesita al menos 2 miembros"),
      /** Miembros máximos. */
      maxMembers: z
        .number()
        .int("Los miembros máximos deben ser enteros")
        .positive("Los miembros máximos deben ser positivos"),
    }),
  })
  .refine((rules) => rules.league.maxMembers >= rules.league.minMembers, {
    message: "El máximo de miembros de liga no puede ser menor que el mínimo",
    path: ["league", "maxMembers"],
  });

export type SeasonRules = z.infer<typeof seasonRulesSchema>;
