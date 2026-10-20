/**
 * Validación de perfil (US-03) — esquemas compartidos cliente/servidor.
 *
 * Mensajes en español (AGENTS.md §2). El servidor es la fuente de verdad:
 * estos esquemas también se ejecutan en el cliente para una mejor UX, pero
 * el servidor siempre revalida (AGENTS.md §8).
 */
import { z } from "zod";

/** Actualización de perfil: nombre visible (3–40 caracteres). */
export const updateProfileInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(3, "El nombre visible debe tener al menos 3 caracteres")
    .max(40, "El nombre visible no puede superar 40 caracteres"),
});

/**
 * Eliminación de cuenta: re-introducción de la contraseña (operación
 * destructiva, ADR-0016). Sin política de longitud: solo se compara con el
 * hash guardado.
 */
export const deleteAccountInputSchema = z.object({
  password: z
    .string()
    .min(1, "Introduce tu contraseña para confirmar la eliminación")
    .max(128, "La contraseña no puede superar 128 caracteres"),
});

export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;
