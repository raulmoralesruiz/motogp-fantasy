/**
 * Código de invitación de liga — FÓRMULA PURA (sin I/O).
 *
 * US-23 (leagues.md §4): el código de liga es una cadena aleatoria de alta
 * entropía (≥8 caracteres, sin ambigüedad 0/O/1/I).
 *
 * La función es pura: recibe una fuente de aleatoriedad (inyectable para
 * tests deterministas) y devuelve el código. La fuente por defecto es el
 * CSPRNG de Node (`node:crypto`): 256 es múltiplo del alfabeto (32), así
 * que `byte % 32` es uniforme (sin sesgo de módulo).
 */
import { randomBytes } from "node:crypto";

/**
 * Alfabeto sin caracteres ambiguos (leagues.md §4): 24 letras (sin I/O) +
 * 8 dígitos (sin 0/1) = 32 caracteres.
 */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Longitud mínima del código (leagues.md §4: ≥8 caracteres). */
export const INVITE_CODE_MIN_LENGTH = 8;

/**
 * Longitud por defecto: 10 caracteres (32^10 ≈ 1,15 × 10^15 combinaciones —
 * entropía suficiente para no ser adivinado, leagues.md §4).
 */
export const INVITE_CODE_DEFAULT_LENGTH = 10;

/**
 * Genera un código de liga (US-23, leagues.md §4).
 *
 * - Longitud: ≥8 caracteres (por defecto 10).
 * - Alfabeto: 32 caracteres sin 0/O/1/I.
 * - Entropía: CSPRNG por defecto; `random` (índice uniforme en
 *   `[0, INVITE_CODE_ALPHABET.length)`) es inyectable para tests.
 *
 * @throws {RangeError} si la longitud no es un entero ≥8.
 */
export function generateLeagueCode(
  length: number = INVITE_CODE_DEFAULT_LENGTH,
  random: () => number = randomIndex,
): string {
  if (!Number.isInteger(length) || length < INVITE_CODE_MIN_LENGTH) {
    throw new RangeError(
      `La longitud del código debe ser un entero de al menos ${INVITE_CODE_MIN_LENGTH} caracteres.`,
    );
  }
  let code = "";
  for (let i = 0; i < length; i++) {
    // `charAt` siempre devuelve string (contrato de `random`: índice en
    // `[0, INVITE_CODE_ALPHABET.length)`).
    code += INVITE_CODE_ALPHABET.charAt(random());
  }
  return code;
}

/**
 * Fuente de aleatoriedad por defecto: índice uniforme en
 * `[0, INVITE_CODE_ALPHABET.length)` a partir del CSPRNG.
 *
 * 256 = 32 × 8, así que `byte % 32` es uniforme sin muestreo por rechazo.
 */
function randomIndex(): number {
  return randomBytes(1).readUInt8(0) % INVITE_CODE_ALPHABET.length;
}
