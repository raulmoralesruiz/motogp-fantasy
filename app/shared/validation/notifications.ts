/**
 * Validación de notificaciones (US-36, ADR-0033) — esquemas compartidos
 * cliente/servidor.
 *
 * Mensajes en español (AGENTS.md §2). El servidor es la fuente de verdad:
 * estos esquemas también se ejecutan en el cliente para una mejor UX, pero
 * el servidor siempre revalida (AGENTS.md §8).
 */
import { z } from "zod";

/** Ajustes de notificación: email on/off (US-36). */
export const updateNotificationSettingsInputSchema = z.object({
  emailEnabled: z.boolean(),
});

export type UpdateNotificationSettingsInput = z.infer<
  typeof updateNotificationSettingsInputSchema
>;
