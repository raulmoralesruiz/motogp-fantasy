/**
 * Tokens de recuperación de contraseña (US-02, security.md §1.1).
 *
 * - El token en claro (64 hex, 256 bits de entropía) SOLO viaja en el link
 *   enviado al usuario; en BD se guarda su SHA-256 (único).
 * - Uso único: `usedAt` != null ⇒ consumido (reutilizarlo falla).
 * - Expiración: `expiresAt` configurable por env (default 1 h).
 *
 * `evaluateResetToken` es PURA (sin I/O ni reloj real) para testear la
 * decisión de la misma forma que `evaluateLoginAttempt` (US-01).
 */
import { createHash, randomBytes } from "node:crypto";

/** Genera un token de recuperación aleatorio (32 bytes → 64 hex). */
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 del token en claro (lo que se guarda en BD). */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Estado de un token de recuperación. */
export type ResetTokenState = "valid" | "used" | "expired" | "not_found";

/**
 * PURA: evalúa si un token de recuperación puede usarse ahora.
 *
 * @param record Fila de `password_reset_tokens` (o `null` si no existe).
 * @param now Reloj actual (inyectado para tests).
 */
export function evaluateResetToken(
  record: { usedAt: Date | null; expiresAt: Date } | null,
  now: Date,
): ResetTokenState {
  if (!record) return "not_found";
  if (record.usedAt !== null) return "used";
  if (record.expiresAt <= now) return "expired";
  return "valid";
}
