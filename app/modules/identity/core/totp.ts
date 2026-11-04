/**
 * TOTP (D-07, ADR-0039) — núcleo puro: RFC 6238 sobre HOTP (RFC 4226).
 *
 * Módulo PURO (misma garantía que `economy`/`scoring`/`lineups/core`):
 * sin I/O (fs/BD/http), sin reloj real — el tiempo llega inyectado en ms —
 * y sin dependencias de la aplicación. `node:crypto` solo aporta la
 * primitiva HMAC-SHA1 (determinista, sin efectos secundarios; el check de
 * pureza no la clasifica como I/O).
 *
 * El reloj inyectado es lo que hace testable la ventana de verificación
 * (±1 paso) y los vectores de prueba del RFC 6238.
 */
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Codifica bytes en base32 (RFC 4648, sin padding — el formato de los
 * secretos TOTP en `otpauth://`).
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
      // Mascara: solo quedan los bits aún no emitidos (sin esto, los bits
      // ya extraídos se re-emiten en el siguiente carácter).
      value &= (1 << bits) - 1;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Decodifica base32 (RFC 4648). Tolerante con minúsculas, espacios y
 * guiones (los secretos se muestran y re-introducen a mano). Lanza si el
 * texto contiene caracteres fuera del alfabeto (dígitos 0, 1, 8, 9 o
 * símbolos: solo existen las letras A–Z y los dígitos 2–7) o si queda
 * vacío tras la limpieza.
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, "");
  if (clean.length === 0) {
    throw new Error("base32: el texto está vacío");
  }
  const invalid = [...clean].find((ch) => !BASE32_ALPHABET.includes(ch));
  if (invalid) {
    throw new Error(`base32: carácter inválido: ${invalid}`);
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch); // ≥ 0: `clean` solo tiene alfabeto
    value = (value << 5) | idx;
    bits += 5;
    while (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
      // Mascara: solo quedan los bits aún no emitidos (sin esto, los bits
      // ya extraídos se re-emiten en el siguiente byte).
      value &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

/** Opciones del algoritmo (defaults RFC 6238: 6 dígitos, paso 30 s). */
export interface TotpOptions {
  /** Paso en segundos (default 30). */
  periodSec?: number;
  /** Dígitos del código, 4–8 (default 6). */
  digits?: number;
}

function assertDigits(digits: number): void {
  if (!(digits >= 4 && digits <= 8)) {
    throw new Error("TOTP: los dígitos deben estar entre 4 y 8");
  }
}

/**
 * PURA: código TOTP (HMAC-SHA1, RFC 6238) para un instante dado (ms).
 *
 * @param secretBase32 Secreto de la cuenta (base32, 160 bits típicos).
 * @param timeMs Instante absoluto en ms (inyectado; `Date.now()` en prod).
 */
export function computeTotp(
  secretBase32: string,
  timeMs: number,
  opts: TotpOptions = {},
): string {
  const periodSec = opts.periodSec ?? 30;
  const digits = opts.digits ?? 6;
  assertDigits(digits);

  const key = base32Decode(secretBase32);
  let counter = Math.floor(timeMs / 1000 / periodSec);
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    msg[i] = counter & 0xff;
    counter >>>= 8;
  }

  const hash = createHmac("sha1", key).update(msg).digest();
  const offset = (hash[hash.length - 1] ?? 0) & 0x0f;
  // Truncación HOTP (RFC 4226 §5.3): los 31 bits de la palabra de 4 bytes.
  // (Cuidado con la precedencia en JS: `&` liga más débil que `+`, así que
  // cada término va entre paréntesis.)
  const bin =
    (((hash[offset] ?? 0) & 0x7f) * 2 ** 24 +
      ((hash[offset + 1] ?? 0) & 0xff) * 2 ** 16 +
      ((hash[offset + 2] ?? 0) & 0xff) * 2 ** 8 +
      ((hash[offset + 3] ?? 0) & 0xff)) &
    0x7fffffff;
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/**
 * PURA: verifica un código TOTP con ventana de tolerancia
 * (desplazamientos `-window..+window` pasos; default ±1 = ±30 s para el
 * desfase de reloj entre dispositivos).
 *
 * Devuelve `false` (no lanza) para códigos o secretos inválidos: el
 * verificador solo necesita sí/no.
 */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  timeMs: number,
  opts: TotpOptions & { window?: number } = {},
): boolean {
  const normalized = code.trim();
  if (!/^\d{4,8}$/.test(normalized)) return false;
  const window = opts.window ?? 1;
  const periodMs = (opts.periodSec ?? 30) * 1000;
  try {
    for (let offset = -window; offset <= window; offset++) {
      if (computeTotp(secretBase32, timeMs + offset * periodMs, opts) === normalized) {
        return true;
      }
    }
  } catch {
    return false; // secreto no decodificable
  }
  return false;
}

/**
 * PURA: monta la URI `otpauth://` (provisioning de apps de autenticación:
 * Google Authenticator, Aegis, 1Password…). El label es `issuer:account`
 * (URL-encoded, como `otplib`).
 */
export function buildOtpAuthUri(params: {
  issuer: string;
  account: string;
  secretBase32: string;
  digits?: number;
  periodSec?: number;
}): string {
  const digits = params.digits ?? 6;
  const periodSec = params.periodSec ?? 30;
  assertDigits(digits);
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = [
    `secret=${encodeURIComponent(params.secretBase32)}`,
    `issuer=${encodeURIComponent(params.issuer)}`,
    "algorithm=SHA1",
    `digits=${digits}`,
    `period=${periodSec}`,
  ].join("&");
  return `otpauth://totp/${label}?${query}`;
}
