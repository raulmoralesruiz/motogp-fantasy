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

// ── US-05: circuitos, GPs, eventos de fin de semana y calendario ─────────

/**
 * Fecha o `null` explícito. El orden de la unión importa: `z.coerce.date()`
 * "aceptaría" `null` (convierte a 1970, `new Date(null)`), así que
 * `z.null()` va PRIMERO para capturar el borrado explícito.
 */
const dateOrNull = z.union([z.null(), z.coerce.date()]);

/** Tipos de evento de fin de semana (reflejo del enum `WeekendEventType`). */
export const weekendEventTypeSchema = z.enum(["q1", "q2", "sprint", "race"]);

/** Q2 y carrera son obligatorios (CA US-05); Q1 y sprint opcionales. */
const hasQ2AndRace = (events: Array<{ type: string }>) =>
  events.some((e) => e.type === "q2") && events.some((e) => e.type === "race");

/** Un GP no puede declarar dos veces el mismo tipo de evento. */
const noDuplicateEventTypes = (events: Array<{ type: string }>) =>
  new Set(events.map((e) => e.type)).size === events.length;

/** Circuito (US-05): único por `(name, country)` en BD. */
export const createCircuitInputSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del circuito es obligatorio")
    .max(160, "El nombre del circuito no puede superar los 160 caracteres"),
  country: z
    .string()
    .min(1, "El país es obligatorio")
    .max(80, "El país no puede superar los 80 caracteres"),
  location: z
    .string()
    .max(120, "La ubicación no puede superar los 120 caracteres")
    .nullish(),
});

/** Evento de fin de semana (US-05): tipo + hora de inicio opcional. */
export const gpEventInputSchema = z.object({
  type: weekendEventTypeSchema,
  startTime: dateOrNull.optional(),
});

/**
 * Creación de GP (US-05): Q2 y carrera obligatorios, Q1 y sprint opcionales.
 * `lockoutAt` opcional (editable después, auditado — CA US-05).
 */
export const createGpInputSchema = z
  .object({
    seasonId: z.string().uuid("El identificador de temporada no es válido"),
    round: z
      .number()
      .int("La ronda debe ser un entero")
      .min(1, "La ronda empieza en 1")
      .max(100, "La ronda no puede superar 100"),
    name: z
      .string()
      .min(1, "El nombre del GP es obligatorio")
      .max(160, "El nombre del GP no puede superar los 160 caracteres"),
    circuitId: z.string().uuid("El identificador de circuito no es válido"),
    date: z.coerce.date({ required_error: "La fecha del GP es obligatoria" }),
    lockoutAt: dateOrNull.optional(),
    events: z
      .array(gpEventInputSchema)
      .min(2, "Un GP necesita al menos Q2 y la carrera")
      .max(4, "Un GP tiene a lo sumo 4 eventos (Q1, Q2, sprint, carrera)"),
  })
  .refine((gp) => hasQ2AndRace(gp.events), {
    message: "Q2 y la carrera son obligatorias",
    path: ["events"],
  })
  .refine((gp) => noDuplicateEventTypes(gp.events), {
    message: "Hay eventos duplicados (un tipo de evento por GP)",
    path: ["events"],
  });

/** Búsqueda de un GP (US-05). */
export const gpIdInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

/** Añadir un evento faltante a un GP existente (US-05). */
export const addWeekendEventInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  type: weekendEventTypeSchema,
  startTime: dateOrNull.optional(),
});

/**
 * Cambio de estado del GP (US-05): la tabla de transiciones la valida el
 * servicio (`gp-status.ts`); el schema solo garantiza el formato.
 */
export const updateGpStatusInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  status: z.enum(["scheduled", "locked", "finished", "cancelled"]),
});

/** Lockout del GP (US-05): `null` lo borra. */
export const updateGpLockoutInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  lockoutAt: dateOrNull,
});

/** GP normalizado del calendario (US-05, ADR-0012). */
export const calendarGpSchema = z
  .object({
    round: z
      .number()
      .int("La ronda debe ser un entero")
      .min(1, "La ronda empieza en 1")
      .max(100, "La ronda no puede superar 100"),
    name: z
      .string()
      .min(1, "El nombre del GP es obligatorio")
      .max(160, "El nombre del GP no puede superar los 160 caracteres"),
    circuit: z.object({
      name: z.string().min(1, "El nombre del circuito es obligatorio").max(160),
      country: z.string().min(1, "El país es obligatorio").max(80),
      location: z.string().max(120).nullish(),
    }),
    date: z.coerce.date({ required_error: "La fecha del GP es obligatoria" }),
    events: z
      .array(
        z.object({
          type: weekendEventTypeSchema,
          startTime: dateOrNull.optional(),
        }),
      )
      .min(2, "Un GP necesita al menos Q2 y la carrera")
      .max(4, "Un GP tiene a lo sumo 4 eventos (Q1, Q2, sprint, carrera)"),
  })
  .refine((gp) => hasQ2AndRace(gp.events), {
    message: "Q2 y la carrera son obligatorias",
    path: ["events"],
  })
  .refine((gp) => noDuplicateEventTypes(gp.events), {
    message: "Hay eventos duplicados (un tipo de evento por GP)",
    path: ["events"],
  });

/**
 * Calendario normalizado de temporada: lo devuelve `calendar.fetch` y lo
 * recibe `calendar.import` (revalidado server-side — AGENTS.md §8).
 */
export const normalizedSeasonCalendarSchema = z.object({
  year: z
    .number()
    .int("El año debe ser un entero")
    .min(1900, "El año debe ser 1900 o posterior")
    .max(2200, "El año no puede superar 2200"),
  seasonRef: z.string().min(1, "La referencia de temporada de la fuente es obligatoria"),
  source: z.object({
    name: z.string().min(1, "El nombre de la fuente es obligatorio"),
    version: z.string().min(1, "La versión de la fuente es obligatoria"),
  }),
  gps: z.array(calendarGpSchema).min(1, "El calendario no tiene GPs"),
});

/** Obtención de calendario (US-05): año de la temporada en la fuente. */
export const fetchCalendarInputSchema = z.object({
  year: z
    .number()
    .int("El año debe ser un entero")
    .min(1900, "El año debe ser 1900 o posterior")
    .max(2200, "El año no puede superar 2200"),
});

/**
 * Importación de calendario (US-05): el preview normalizado reenviado por
 * el cliente; el servidor lo revalida y exige `calendar.year === season.year`.
 */
export const importCalendarInputSchema = z.object({
  seasonId: z.string().uuid("El identificador de temporada no es válido"),
  calendar: normalizedSeasonCalendarSchema,
});

export type CreateSeasonInput = z.infer<typeof createSeasonInputSchema>;
export type AddRulesVersionInput = z.infer<typeof addRulesVersionInputSchema>;
export type SeasonIdInput = z.infer<typeof seasonIdInputSchema>;
export type CreateCircuitInput = z.infer<typeof createCircuitInputSchema>;
export type GpEventInput = z.infer<typeof gpEventInputSchema>;
export type CreateGpInput = z.infer<typeof createGpInputSchema>;
export type GpIdInput = z.infer<typeof gpIdInputSchema>;
export type AddWeekendEventInput = z.infer<typeof addWeekendEventInputSchema>;
export type UpdateGpStatusInput = z.infer<typeof updateGpStatusInputSchema>;
export type UpdateGpLockoutInput = z.infer<typeof updateGpLockoutInputSchema>;
export type CalendarGp = z.infer<typeof calendarGpSchema>;
export type NormalizedSeasonCalendar = z.infer<typeof normalizedSeasonCalendarSchema>;
export type FetchCalendarInput = z.infer<typeof fetchCalendarInputSchema>;
export type ImportCalendarInput = z.infer<typeof importCalendarInputSchema>;
