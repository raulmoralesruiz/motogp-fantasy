/**
 * Validación del entorno del servidor (Zod).
 * Falla rápido y con mensaje claro si falta o es inválida una variable.
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  REDIS_URL: z.string().min(1, "REDIS_URL es obligatoria"),
  // US-01 · Sesiones y anti fuerza bruta. Son parámetros OPERATIVOS (no
  // reglas de juego): no viven en `season_rules` (AGENTS.md §1.3).
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_SEC: z.coerce.number().int().positive().default(900),
  SESSION_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Entorno del servidor inválido — ${details}`);
  }
  cached = parsed.data;
  return parsed.data;
}

/**
 * Flag Secure de la cookie de sesión (US-01): variable explícita, o por
 * defecto true en producción (la cookie sin Secure solo tiene sentido en
 * dev local por HTTP).
 */
export function isSessionCookieSecure(): boolean {
  const env = getServerEnv();
  if (env.SESSION_COOKIE_SECURE) {
    return env.SESSION_COOKIE_SECURE === "true";
  }
  return process.env.NODE_ENV === "production";
}
