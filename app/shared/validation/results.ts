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

import { RESULT_BONUS_CODES, RESULT_PENALTY_CODES } from "../types/index.js";

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

export type ResultEntryInput = z.infer<typeof resultEntrySchema>;
export type ImportEventInput = z.infer<typeof importEventInputSchema>;
export type GpEventsInput = z.infer<typeof gpEventsInputSchema>;
export type EventResultsInput = z.infer<typeof eventResultsInputSchema>;
