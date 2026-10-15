/**
 * Contraseñas (US-01, security.md §1.1): argon2id + salt.
 *
 * Nunca se guarda el texto claro; el hash es autocontenido
 * (parámetros + salt + hash) y se verifica con la misma función.
 */
import { hash, verify } from "@node-rs/argon2";

/**
 * Parámetros recomendados por OWASP para argon2id: 19 MiB, 2 iteraciones,
 * paralelismo 1.
 */
const ARGON2_PARAMS = {
  memoryCost: 19_456, // KiB (19 MiB)
  timeCost: 2,
  parallelism: 1,
} as const;

/** Hashea una contraseña con argon2id (salt aleatorio incrustado en el output). */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMS);
}

/**
 * Verifica una contraseña contra un hash argon2.
 * Devuelve `false` ante cualquier error (hash malformado, etc.).
 */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  try {
    return await verify(encoded, password);
  } catch {
    return false;
  }
}

/**
 * Hash de relleno para igualar el tiempo de respuesta cuando el usuario no
 * existe (anti-enumeración): la ruta "usuario inexistente" ejecuta un
 * verify argon2 idéntico al de "contraseña incorrecta".
 */
let dummyHash: Promise<string> | null = null;

export function getDummyHash(): Promise<string> {
  dummyHash ??= hash("__dummy__", ARGON2_PARAMS);
  return dummyHash;
}
