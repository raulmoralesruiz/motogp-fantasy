/**
 * Schemas de entrada del módulo `results` (US-16, ADR-0018).
 *
 * El cliente usa estos schemas para la UX; el servidor siempre revalida
 * (AGENTS.md §8). La validación SEMÁNTICA por tipo de evento (códigos
 * aplicables, bonos condicionados) la hace el núcleo puro del módulo
 * (`modules/results/core/codes.ts`) porque depende del tipo del evento,
 * que solo se conoce resolviendo `eventId` en BD.
 */

import { z } from "zod";

import {
  RESULT_BONUS_CODES,
  RESULT_EVENT_KINDS,
  RESULT_PENALTY_CODES,
} from "../types";

const bonusCode = z.enum(RESULT_BONUS_CODES);
const penaltyCode = z.enum(RESULT_PENALTY_CODES);

/**
 * Una entrada de resultados (ADR-0018).
 *
 * Coherencia `started`/`finished`/`position`:
 * - `started=false` → non-starter (ABSENT): `finished=false` y `position=null`.
 * - `started=true ∧ finished=false` → DNF: `position=null`.
 * - `finished=true` → FINISHED: `position ≥ 1`.
 *
 * Empates de posición permitidos (scoring.md §6).
 */
export const resultEntrySchema = z
  .object({
    riderId: z.string().uuid("El identificador de piloto no es válido"),
    position: z
      .number()
      .int("La posición debe ser un entero")
      .min(1, "La posición empieza en 1")
      .nullish(),
    started: z.boolean({ message: "started es obligatorio" }),
    finished: z.boolean({ message: "finished es obligatorio" }),
    penalties: z
      .array(penaltyCode)
      .max(5, "Demasiadas penalizaciones para una entrada"),
    bonuses: z.array(bonusCode).max(5, "Demasiados bonos para una entrada"),
    /** Puntos oficiales de la fuente (auditoría); en la importación manual suele ser null. */
    rawPoints: z
      .number()
      .min(0, "Los puntos crudos no pueden ser negativos")
      .max(1000, "Los puntos crudos no pueden superar 1000")
      .nullish(),
  })
  .refine((e) => e.started || !e.finished, {
    message: "Un piloto que no salió no puede haber terminado",
    path: ["started"],
  })
  .refine((e) => e.finished || e.position === null, {
    message: "Solo un piloto que terminó tiene posición",
    path: ["position"],
  })
  .refine((e) => !e.finished || e.position !== null, {
    message: "Un piloto que terminó necesita posición",
    path: ["position"],
  })
  .refine(
    (e) =>
      new Set(e.penalties).size === e.penalties.length &&
      new Set(e.bonuses).size === e.bonuses.length,
    {
      message: "Cada código de bono o penalización aparece una sola vez",
    },
  );

/**
 * Importación manual de resultados de un evento (US-16, ADR-0018).
 *
 * El payload reemplaza las entradas indicadas; las filas que no están en el
 * payload se conservan (los resultados no se borran, se corrigen). `reason`
 * es opcional en creación y obligatorio si la importación produce cambios
 * (lo valida el servicio, que es quien conoce el estado anterior).
 */
export const importEventInputSchema = z
  .object({
    gpId: z.string().uuid("El identificador de GP no es válido"),
    eventId: z.string().uuid("El identificador de evento no es válido"),
    entries: z
      .array(resultEntrySchema)
      .min(1, "Indica al menos un resultado")
      .max(100, "Máximo 100 resultados por importación"),
    reason: z
      .string()
      .min(3, "El motivo debe tener al menos 3 caracteres")
      .max(500, "El motivo no puede superar los 500 caracteres")
      .optional(),
  })
  .refine((v) => new Set(v.entries.map((e) => e.riderId)).size === v.entries.length, {
    message: "Hay pilotos repetidos en los resultados",
    path: ["entries"],
  });

/** Eventos de un GP con su estado de resultados (UI de admin, US-16). */
export const gpEventsInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

/** Filas actuales de un evento (pre-carga de la UI de admin, US-16). */
export const eventResultsInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  eventId: z.string().uuid("El identificador de evento no es válido"),
});

// ── US-17 (ADR-0019): auto-import desde la fuente ────────────────────────────

/** Importación automática de un evento desde la fuente (job + botón admin). */
export const importFromSourceInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  event: z.enum(RESULT_EVENT_KINDS, {
    message: "El evento debe ser q2, sprint o race",
  }),
});

/**
 * Vincula un GP a un evento de la fuente (`Gp.sourceRef`, ADR-0019).
 * `eventRef` explícito o, si se omite, match único por nombre normalizado
 * contra el catálogo de la temporada (lo resuelve el servicio).
 */
export const linkSourceInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  eventRef: z
    .string()
    .min(1, "El identificador de evento de la fuente no puede estar vacío")
    .max(120, "El identificador de evento de la fuente no puede superar los 120 caracteres")
    .optional(),
});

/** Desvincula un GP de la fuente (`Gp.sourceRef = null`, ADR-0019). */
export const unlinkSourceInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

/** Asocia un piloto de la fuente a un piloto del mercado (ADR-0019). */
export const setRiderMappingInputSchema = z.object({
  riderRef: z
    .string()
    .min(1, "La referencia del piloto en la fuente no puede estar vacía")
    .max(120, "La referencia del piloto en la fuente no puede superar los 120 caracteres"),
  riderId: z.string().uuid("El identificador de piloto no es válido"),
});

/** Elimina la asociación de un piloto de la fuente (ADR-0019). */
export const deleteRiderMappingInputSchema = z.object({
  riderRef: z
    .string()
    .min(1, "La referencia del piloto en la fuente no puede estar vacía")
    .max(120, "La referencia del piloto en la fuente no puede superar los 120 caracteres"),
});

/** Estado operativo del auto-import de un GP (UI de admin, US-17). */
export const sourceStateInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

/** Catálogo de eventos de la fuente de la temporada del GP (UI de admin). */
export const sourceEventsInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

// ── US-18 (ADR-0020): definitivo + estados de evento ────────────────────────

/** Marcar el GP como definitivo (primer recálculo, US-18). */
export const markDefinitiveInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

/** Estado de evento (cancelar / neutralizar, US-18). */
export const eventFlagInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  eventId: z.string().uuid("El identificador de evento no es válido"),
});

// ── US-20: mi puntuación con desglose ────────────────────────────────────────

/** Mi puntuación en un GP (desglose por piloto/constructor/equipo, US-20). */
export const myScoreInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

export type ResultEntryInput = z.infer<typeof resultEntrySchema>;
export type ImportEventInput = z.infer<typeof importEventInputSchema>;
export type GpEventsInput = z.infer<typeof gpEventsInputSchema>;
export type EventResultsInput = z.infer<typeof eventResultsInputSchema>;
export type ImportFromSourceInput = z.infer<typeof importFromSourceInputSchema>;
export type LinkSourceInput = z.infer<typeof linkSourceInputSchema>;
export type UnlinkSourceInput = z.infer<typeof unlinkSourceInputSchema>;
export type SetRiderMappingInput = z.infer<typeof setRiderMappingInputSchema>;
export type DeleteRiderMappingInput = z.infer<typeof deleteRiderMappingInputSchema>;
export type SourceStateInput = z.infer<typeof sourceStateInputSchema>;
export type SourceEventsInput = z.infer<typeof sourceEventsInputSchema>;
export type MarkDefinitiveInput = z.infer<typeof markDefinitiveInputSchema>;
export type EventFlagInput = z.infer<typeof eventFlagInputSchema>;
export type MyScoreInput = z.infer<typeof myScoreInputSchema>;
