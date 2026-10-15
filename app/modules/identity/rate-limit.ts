/**
 * Rate limiting y bloqueo temporal (US-01, security.md §1.1/§1.6).
 *
 * Dos mecanismos independientes:
 * - **Rate limit por IP** (ventana fija): máximo `maxPerWindow` intentos de
 *   login por cada `windowSec` (anti fuerza bruta distribuido).
 * - **Bloqueo por cuenta**: tras `lockoutThreshold` fallos consecutivos, la
 *   cuenta queda bloqueada `lockoutSec` (aunque la contraseña sea correcta).
 *
 * La decisión es una función PURA (testable sin I/O ni reloj real);
 * `RateLimitStore` es la frontera de I/O (Redis en producción,
 * `InMemoryRateLimitStore` en tests).
 */

export interface RateLimitConfig {
  /** Intentos de login máximos por ventana (por IP). */
  maxPerWindow: number;
  /** Duración de la ventana en segundos. */
  windowSec: number;
  /** Fallos consecutivos que disparan el bloqueo (por cuenta). */
  lockoutThreshold: number;
  /** Duración del bloqueo en segundos. */
  lockoutSec: number;
}

export type RateLimitReason = "ok" | "rate_limited" | "locked";

export interface RateLimitDecision {
  allowed: boolean;
  reason: RateLimitReason;
  /** Segundos que hay que esperar para reintentar (0 si está permitido). */
  retryAfterSec: number;
}

/**
 * PURA: decide si se permite un intento de login.
 * El estado lo aporta el store (los TTL ya están aplicados ahí).
 */
export function evaluateLoginAttempt(
  state: {
    /**
     * Intentos registrados en la ventana actual (por IP), INCLUYENDO el que
     * se está evaluando (el store incrementa antes de decidir).
     */
    ipWindowCount: number;
    /** Segundos restantes de la ventana actual. */
    ipWindowRemainingSec: number;
    /** Segundos restantes del bloqueo de la cuenta (0 si no está bloqueada). */
    accountLockRemainingSec: number;
  },
  cfg: Pick<RateLimitConfig, "maxPerWindow">,
): RateLimitDecision {
  // El bloqueo de cuenta tiene prioridad sobre el rate limit.
  if (state.accountLockRemainingSec > 0) {
    return {
      allowed: false,
      reason: "locked",
      retryAfterSec: Math.ceil(state.accountLockRemainingSec),
    };
  }
  // `maxPerWindow` intentos se permiten por ventana: se rechaza el (max+1)º.
  if (state.ipWindowCount > cfg.maxPerWindow && state.ipWindowRemainingSec > 0) {
    return {
      allowed: false,
      reason: "rate_limited",
      retryAfterSec: Math.ceil(state.ipWindowRemainingSec),
    };
  }
  return { allowed: true, reason: "ok", retryAfterSec: 0 };
}

/** PURA: decide si un fallo debe bloquear la cuenta. */
export function shouldLockAccount(
  failureCount: number,
  cfg: Pick<RateLimitConfig, "lockoutThreshold">,
): boolean {
  return failureCount >= cfg.lockoutThreshold;
}

/**
 * Frontera de I/O: contadores con TTL.
 * Implementación de producción: Redis (`app/server/rate-limit-redis.ts`).
 */
export interface RateLimitStore {
  /**
   * Registra un intento de login de la IP (ventana fija).
   * Devuelve el contador de la ventana actual y los segundos restantes.
   */
  recordAttempt(ip: string, windowSec: number): Promise<{ count: number; remainingSec: number }>;
  /** Registra un fallo de la cuenta y devuelve el contador consecutivo. */
  recordFailure(account: string): Promise<number>;
  /** Borra los fallos de la cuenta (login correcto). */
  resetFailures(account: string): Promise<void>;
  /** Bloquea la cuenta durante `lockoutSec` segundos. */
  lockAccount(account: string, lockoutSec: number): Promise<void>;
  /** Segundos restantes del bloqueo de la cuenta (0 si no está bloqueada). */
  lockRemainingSec(account: string): Promise<number>;
}

/**
 * Implementación en memoria para tests: mismas semánticas que la de Redis,
 * con reloj inyectable (`setNow`) para avanzar el tiempo sin esperar.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private nowMs = 0;
  private windows = new Map<string, { count: number; resetAtMs: number }>();
  private failures = new Map<string, number>();
  private locks = new Map<string, number>();

  /** Avanza el reloj interno (ms). */
  setNow(ms: number): void {
    this.nowMs = ms;
  }

  async recordAttempt(ip: string, windowSec: number): Promise<{ count: number; remainingSec: number }> {
    const now = this.nowMs;
    const current = this.windows.get(ip);
    if (!current || now >= current.resetAtMs) {
      this.windows.set(ip, { count: 1, resetAtMs: now + windowSec * 1000 });
      return { count: 1, remainingSec: windowSec };
    }
    current.count += 1;
    return {
      count: current.count,
      remainingSec: Math.ceil((current.resetAtMs - now) / 1000),
    };
  }

  async recordFailure(account: string): Promise<number> {
    const count = (this.failures.get(account) ?? 0) + 1;
    this.failures.set(account, count);
    return count;
  }

  async resetFailures(account: string): Promise<void> {
    this.failures.delete(account);
  }

  async lockAccount(account: string, lockoutSec: number): Promise<void> {
    this.locks.set(account, this.nowMs + lockoutSec * 1000);
  }

  async lockRemainingSec(account: string): Promise<number> {
    const unlockAtMs = this.locks.get(account);
    if (unlockAtMs === undefined) return 0;
    return Math.max(0, Math.ceil((unlockAtMs - this.nowMs) / 1000));
  }
}
