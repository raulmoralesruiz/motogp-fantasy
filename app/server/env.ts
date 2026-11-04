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
  // US-02 · Recuperación de contraseña (parámetros operativos, no reglas de
  // juego: no viven en `season_rules`, AGENTS.md §1.3).
  RESET_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(3600),
  RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  RESET_RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().positive().default(300),
  // T-12/ADR-0035 · Rate limit de registro (anti-flood de cuentas,
  // security.md §1.6): una ola de registros bot llenaría la liga de
  // bienvenida (US-31) y bloquearía los registros legítimos. Por IP,
  // parámetro operativo (no vive en `season_rules`).
  AUTH_REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_REGISTER_RATE_LIMIT_WINDOW_SEC: z.coerce.number()
    .int()
    .positive()
    .default(3600),
  // US-03 · Eliminación de cuenta (ADR-0016): rate limit POR USUARIO
  // (parámetro operativo, no regla de juego: no vive en `season_rules`).
  ACCOUNT_DELETE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  ACCOUNT_DELETE_RATE_LIMIT_WINDOW_SEC: z.coerce.number()
    .int()
    .positive()
    .default(3600),
  // US-23 · Creación de ligas (security.md §1.6): rate limit POR USUARIO
  // (parámetro operativo, no regla de juego: no vive en `season_rules`).
  LEAGUE_CREATE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LEAGUE_CREATE_RATE_LIMIT_WINDOW_SEC: z.coerce.number()
    .int()
    .positive()
    .default(3600),
  // US-25 · Unión a ligas (security.md §1.6, ADR-0025): rate limit POR IP
  // (ventana) + bloqueo temporal tras N fallos de código (anti fuerza
  // bruta, leagues.md §4/§10). Parámetros operativos, no reglas de juego.
  LEAGUE_JOIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LEAGUE_JOIN_RATE_LIMIT_WINDOW_SEC: z.coerce.number()
    .int()
    .positive()
    .default(60),
  LEAGUE_JOIN_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  LEAGUE_JOIN_LOCKOUT_SEC: z.coerce.number().int().positive().default(900),
  // URL pública de la app: monta el link de recuperación (US-02). En
  // producción la fija el build (build-arg) y el contenedor.
  NEXT_PUBLIC_APP_URL: z.string().min(1).default("http://localhost:3000"),
  // T-08 · Bootstrap de admin (ADR-0010): el registro con este email
  // (minúsculas) recibe `global_admin`. Vacío → nadie lo recibe. Debe
  // fijarse antes del primer registro con ese email (BD nueva).
  BOOTSTRAP_ADMIN_EMAIL: z.string().default(""),
  // D-07/ADR-0039 · 2FA TOTP: parámetros OPERATIVOS del segundo factor (no
  // reglas de juego: no viven en `season_rules`, AGENTS.md §1.3).
  TOTP_CHALLENGE_TTL_SEC: z.coerce.number().int().positive().default(300),
  TOTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // US-31 · Alta automática en una liga pública de bienvenida. Es un UUID
  // operativo del servidor (nunca un dato del cliente). Vacío = desactivado.
  WELCOME_LEAGUE_ID: z
    .union([z.string().uuid("WELCOME_LEAGUE_ID debe ser un UUID"), z.literal("")])
    .default(""),
  // US-36 · Notificaciones por email (ADR-0033): API key de Resend
  // (SECRETO, solo por env — security.md §1.12). Vacía →
  // `LogNotificationSender` (dev/provisional: loguea en el servidor,
  // mismo espíritu que ADR-0009).
  RESEND_API_KEY: z.string().default(""),
  // US-36 · Remitente verificado en Resend (p. ej.
  // `notificaciones@motogp.raulmorales.eu` tras verificar el dominio).
  EMAIL_FROM: z.string().default("Fantasy MotoGP <onboarding@resend.dev>"),
  // T-14/ADR-0036 · Monitoreo: DSN de Sentry (self-hosted en TrueNAS o
  // sentry.io). VACÍO ⇒ Sentry desactivado (los capturers son no-op;
  // mismo espíritu "modo provisional" que RESEND_API_KEY, ADR-0009/0033).
  // Es una URL pública (la clave del proyecto, no un secreto): se usa el
  // prefijo NEXT_PUBLIC_ para que el SDK de cliente la inlinde en el build
  // (patrón oficial de @sentry/nextjs) y servidor/worker la lean en runtime.
  NEXT_PUBLIC_SENTRY_DSN: z.string().default(""),
  // T-14/ADR-0036 · Destinatario de las alertas operativas (fallo final de
  // job, umbral de fallos del polling/probe). VACÍO ⇒ sin canal de email
  // (solo Sentry + log; el sink nunca lanza).
  OPS_ALERT_EMAIL: z
    .union([z.string().email(), z.literal("")])
    .default(""),
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
