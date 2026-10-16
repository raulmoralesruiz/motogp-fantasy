/**
 * Validación de autenticación (US-01) — esquemas compartidos cliente/servidor.
 *
 * Mensajes en español (AGENTS.md §2). El servidor es la fuente de verdad:
 * estos esquemas también se ejecutan en el cliente para una mejor UX, pero
 * el servidor siempre revalida (AGENTS.md §8).
 */
import { z } from "zod";

/** Seudónimo público: 3–20 caracteres, letras/números/guion bajo. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "El nombre de usuario debe tener al menos 3 caracteres")
  .max(20, "El nombre de usuario no puede superar 20 caracteres")
  .regex(
    /^[a-zA-Z0-9_]+$/,
    "El nombre de usuario solo puede usar letras, números y guiones bajos",
  );

/** Email normalizado (trim + minúsculas) para evitar duplicados por mayúsculas. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("El email no es válido")
  .max(254, "El email no puede superar 254 caracteres");

/** Política de contraseña (security.md §1.1: longitud mínima). */
export const passwordSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(128, "La contraseña no puede superar 128 caracteres");

export const registerInputSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  termsAccepted: z.boolean().refine((v) => v, {
    message: "Debes aceptar los términos y la política de privacidad",
  }),
});

/**
 * Login: sin longitud mínima en la contraseña (no filtrar la política y
 * permitir que usuarios con contraseñas antiguas sigan entrando si la
 * política cambia en el futuro).
 */
export const loginInputSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "La contraseña es obligatoria")
    .max(128, "La contraseña no puede superar 128 caracteres"),
});

/** US-02 · Solicitud de recuperación: solo el email. */
export const requestResetInputSchema = z.object({
  email: emailSchema,
});

/**
 * US-02 · Restablecer contraseña con el token del link.
 * Sin validación de formato del token: cualquier valor inválido recibe el
 * mismo error genérico del servidor (no revelar si existe o no).
 */
export const resetPasswordInputSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, "El enlace de recuperación no es válido")
    .max(256, "El enlace de recuperación no es válido"),
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type RequestResetInput = z.infer<typeof requestResetInputSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;
