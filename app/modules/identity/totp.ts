/**
 * Retos TOTP (D-07, ADR-0039): el segundo paso del login.
 *
 * Tras validar la contraseña, una cuenta con 2FA activo NO recibe sesión:
 * recibe un reto opaco de vida corta (`issue`) que debe canjear por código
 * de la app de autenticación (`resolve` → verificar → `consume`). Los
 * fallos de código se contabilizan por reto (presupuesto acotado) además
 * de contra el bloqueo por cuenta existente (security.md §1.6).
 *
 * Mismo patrón que `RateLimitStore` (US-01): interfaz de I/O aquí (frontera),
 * implementación Redis en producción (`app/server/totp-redis.ts`) e in-memory
 * con reloj inyectable para tests. El núcleo de los códigos (RFC 6238) vive
 * en el módulo puro `core/totp.ts`.
 */
import { randomBytes } from "node:crypto";

/** Emisor de la app en las URIs `otpauth://` (label de la app de auth). */
export const TOTP_ISSUER = "FantasyMotoGP";

export interface TotpChallengeStore {
  /** Crea un reto para el usuario con vigencia `ttlSec`; devuelve el token opaco. */
  issue(userId: string, ttlSec: number): Promise<string>;
  /** Devuelve el userId del reto si existe y no ha expirado (si no, null). */
  resolve(token: string): Promise<string | null>;
  /** Fallos de código registrados en el reto (0 si ninguno). */
  failureCount(token: string): Promise<number>;
  /** Registra un fallo de código en el reto; devuelve el contador (desde 1). */
  recordFailure(token: string): Promise<number>;
  /** Consume el reto y sus fallos (éxito; idempotente). */
  consume(token: string): Promise<void>;
}

/** Token opaco del reto: 32 bytes aleatorios (256 bits) en hex. */
export function generateTotpChallengeToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Implementación en memoria para tests: mismas semánticas que la de Redis,
 * con reloj inyectable (`setNow`) para hacer expirar los retos sin esperar.
 */
export class InMemoryTotpChallengeStore implements TotpChallengeStore {
  private nowMs = 0;
  private challenges = new Map<string, { userId: string; expiresAtMs: number }>();
  private failures = new Map<string, number>();

  /** Avanza el reloj interno (ms). */
  setNow(ms: number): void {
    this.nowMs = ms;
  }

  private record(token: string): { userId: string; expiresAtMs: number } | undefined {
    const entry = this.challenges.get(token);
    if (!entry || entry.expiresAtMs <= this.nowMs) return undefined;
    return entry;
  }

  async issue(userId: string, ttlSec: number): Promise<string> {
    const token = generateTotpChallengeToken();
    this.challenges.set(token, {
      userId,
      expiresAtMs: this.nowMs + ttlSec * 1000,
    });
    return token;
  }

  async resolve(token: string): Promise<string | null> {
    return this.record(token)?.userId ?? null;
  }

  async failureCount(token: string): Promise<number> {
    return this.failures.get(token) ?? 0;
  }

  async recordFailure(token: string): Promise<number> {
    const count = (this.failures.get(token) ?? 0) + 1;
    this.failures.set(token, count);
    return count;
  }

  async consume(token: string): Promise<void> {
    this.challenges.delete(token);
    this.failures.delete(token);
  }
}
