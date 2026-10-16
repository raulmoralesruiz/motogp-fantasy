/**
 * Servicio de autenticación (US-01): registro y login.
 *
 * - Registro: email/username únicos (rechazo explícito), hash argon2,
 *   creación transaccional de User + Profile + rol `user` + sesión.
 * - Login: rate limit por IP + bloqueo por cuenta (security.md §1.1/§1.6),
 *   verificación argon2 (con hash de relleno anti-enumeración) + sesión.
 *
 * Las dependencias se inyectan (prisma, store, config): el servicio se
 * prueba sin los singletons de la app.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import type { EmailSender } from "./email";
import { getDummyHash, hashPassword, verifyPassword } from "./password";
import { evaluateResetToken, generateResetToken, hashResetToken } from "./reset-tokens";
import { createSession, revokeSession, toPublicUser, type PublicUser } from "./sessions";
import {
  evaluateLoginAttempt,
  shouldLockAccount,
  type RateLimitConfig,
  type RateLimitStore,
} from "./rate-limit";

export interface AuthServiceConfig extends RateLimitConfig {
  /** Vigencia de la sesión en segundos. */
  sessionTtlSec: number;
  /** Vigencia del token de recuperación en segundos (US-02, default 1 h). */
  resetTokenTtlSec: number;
  /** Máx. solicitudes de recuperación por IP por ventana (US-02). */
  resetMaxPerWindow: number;
  /** Ventana del rate limit de recuperación en segundos (US-02). */
  resetWindowSec: number;
  /** URL pública de la app para montar el link de recuperación (US-02). */
  appUrl: string;
  /**
   * Bootstrap de admin (T-08, ADR-0010): el registro con este email
   * (minúsculas) recibe `global_admin` en la misma transacción.
   * Vacío/ausente → nadie lo recibe.
   */
  bootstrapAdminEmail?: string;
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
  /** Enviador de emails (US-02; provisional: `logEmailSender`, ADR-0009). */
  emailSender: EmailSender;
  cfg: AuthServiceConfig;
}

export interface AuthResult {
  user: PublicUser;
  /** Token opaco para la cookie de sesión. */
  sessionToken: string;
}

const USER_INCLUDE = {
  profile: true,
  userRoles: { include: { role: true } },
} as const;

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * Registro (US-01): email + contraseña + nombre de usuario.
   * La liga de bienvenida (US-31) y el onboarding quedan fuera de alcance.
   *
   * Si el email coincide con el admin de bootstrap (T-08, ADR-0010), la
   * concesión de `global_admin` se registra en `audit_log` (T-09).
   */
  async register(
    input: {
      email: string;
      username: string;
      password: string;
    },
    meta: { ip: string },
  ): Promise<AuthResult> {
    const { prisma, cfg } = this.deps;

    // Rechazo explícito de duplicados (la constraint única de BD es la
    // última barrera ante concurrencia).
    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      prisma.user.findUnique({ where: { username: input.username } }),
    ]);
    if (existingEmail) {
      throw new TRPCError({ code: "CONFLICT", message: "El email ya está registrado." });
    }
    if (existingUsername) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "El nombre de usuario ya está en uso.",
      });
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.$transaction(async (tx) => {
      // El rol `user` está sembrado por la migración seed_user_role (antes,
      // con la tabla vacía, dos registros concurrentes competían por el
      // primer INSERT del upsert). El upsert queda como guarda idempotente.
      const role = await tx.role.upsert({
        where: { name: "user" },
        update: {},
        create: { name: "user", description: "Usuario registrado" },
      });
      const created = await tx.user.create({
        data: {
          email: input.email,
          username: input.username,
          passwordHash,
          profile: { create: { displayName: input.username } },
          userRoles: { create: { roleId: role.id } },
        },
        include: USER_INCLUDE,
      });
      // Bootstrap de admin (T-08, ADR-0010): si el email coincide con el
      // configurado, se otorga también `global_admin` (atómico: misma
      // transacción). El email ya viene minúsculas por el esquema Zod.
      const bootstrap = cfg.bootstrapAdminEmail?.trim().toLowerCase();
      if (!bootstrap || input.email !== bootstrap) return created;
      const adminRole = await tx.role.upsert({
        where: { name: "global_admin" },
        update: {},
        create: {
          name: "global_admin",
          description: "Administrador global (panel de admin)",
        },
      });
      await tx.userRole.create({
        data: { userId: created.id, roleId: adminRole.id },
      });
      // Auditoría (T-09): el bootstrap es una acción sensible (roles) y se
      // registra en la misma transacción (append-only, trigger de BD).
      await appendAudit(tx, {
        actorId: created.id,
        action: "role.bootstrap_admin",
        entity: "role",
        entityId: adminRole.id,
        afterData: { userId: created.id, roleId: adminRole.id, email: input.email },
        ip: meta.ip,
      });
      // Relectura para incluir el rol nuevo en la respuesta.
      return tx.user.findUniqueOrThrow({
        where: { id: created.id },
        include: USER_INCLUDE,
      });
    });

    const session = await createSession(prisma, {
      userId: user.id,
      ttlSec: cfg.sessionTtlSec,
    });
    return { user: toPublicUser(user), sessionToken: session.token };
  }

  /**
   * Login con anti fuerza bruta (CA de US-01):
   * 1) bloqueo de cuenta (tiene prioridad), 2) rate limit por IP,
   * 3) verificación de credenciales.
   */
  async login(
    input: { email: string; password: string },
    meta: { ip: string },
  ): Promise<AuthResult> {
    const { prisma, rateLimit, cfg } = this.deps;
    // El email ya viene normalizado (minúsculas) por el esquema Zod.
    const account = input.email;

    // 1) Anti fuerza bruta (decisión pura, security.md §1.6): el bloqueo de
    //    cuenta tiene prioridad sobre el rate limit por IP.
    const lockRemainingSec = await rateLimit.lockRemainingSec(account);
    const { count, remainingSec } = await rateLimit.recordAttempt(meta.ip, cfg.windowSec);
    const decision = evaluateLoginAttempt(
      {
        ipWindowCount: count,
        ipWindowRemainingSec: remainingSec,
        accountLockRemainingSec: lockRemainingSec,
      },
      cfg,
    );
    if (!decision.allowed) {
      if (decision.reason === "locked") {
        throw this.lockedError(decision.retryAfterSec);
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Estás enviando demasiadas peticiones. Inténtalo de nuevo en ${decision.retryAfterSec} s.`,
      });
    }

    // 2) Verificación de credenciales. Anti-enumeración: si el usuario no
    //    existe, se verifica contra un hash de relleno (mismo coste).
    const user = await prisma.user.findUnique({
      where: { email: account },
      include: USER_INCLUDE,
    });
    const hash = user?.passwordHash ?? (await getDummyHash());
    const passwordOk = await verifyPassword(input.password, hash);

    if (!user || !passwordOk) {
      const failures = await rateLimit.recordFailure(account);
      if (shouldLockAccount(failures, cfg)) {
        await rateLimit.lockAccount(account, cfg.lockoutSec);
        throw this.lockedError(cfg.lockoutSec);
      }
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Credenciales incorrectas." });
    }

    await rateLimit.resetFailures(account);
    const session = await createSession(prisma, {
      userId: user.id,
      ttlSec: cfg.sessionTtlSec,
      ip: meta.ip,
    });
    return { user: toPublicUser(user), sessionToken: session.token };
  }

  /**
   * Cierre de sesión (US-02): revoca la sesión en BD (idempotente).
   * La limpieza de la cookie la hace la capa tRPC.
   */
  async logout(sessionToken: string): Promise<void> {
    await revokeSession(this.deps.prisma, sessionToken);
  }

  /**
   * Solicita un enlace de recuperación de contraseña (US-02).
   *
   * - Rate limit por IP (security.md §1.6: "login y recuperación").
   * - Anti-enumeración: la respuesta es idéntica exista o no el usuario;
   *   solo se crea el token y se envía el email si el email está registrado.
   * - Token aleatorio de uso único con expiración; en BD solo su SHA-256.
   * - Cada solicitud caduca los tokens previos sin usar (gana el último).
   */
  async requestPasswordReset(
    email: string,
    meta: { ip: string },
  ): Promise<{ message: string }> {
    const { prisma, rateLimit, cfg, emailSender } = this.deps;

    const { count, remainingSec } = await rateLimit.recordResetRequest(
      meta.ip,
      cfg.resetWindowSec,
    );
    if (count > cfg.resetMaxPerWindow && remainingSec > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Estás enviando demasiadas peticiones. Inténtalo de nuevo en ${Math.ceil(remainingSec)} s.`,
      });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = generateResetToken();
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        // Solo el último token pedido sigue siendo válido.
        await tx.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { expiresAt: new Date(0) },
        });
        await tx.passwordResetToken.create({
          data: {
            tokenHash: hashResetToken(token),
            userId: user.id,
            expiresAt: new Date(now.getTime() + cfg.resetTokenTtlSec * 1000),
          },
        });
      });
      const link = `${cfg.appUrl}/reestablecer-contrasena?token=${token}`;
      await emailSender.sendResetLink({ to: email, link });
    }

    // Anti-enumeración: mismo mensaje en los dos casos.
    return {
      message: "Si el email está registrado, recibirás un enlace de recuperación.",
    };
  }

  /**
   * Restablece la contraseña con un token de recuperación (US-02).
   *
   * - El token debe existir, no estar usado y no estar expirado; cualquier
   *   otro caso devuelve el mismo error genérico (no se revela cuál fue).
   * - El reclamo del token es ATÓMICO (`updateMany` condicional): dos
   *   llamadas concurrentes con el mismo token, solo una gana (uso único).
   * - Tras el cambio se revocan TODAS las sesiones del usuario.
   */
  async resetPassword(token: string, newPassword: string): Promise<{ ok: true }> {
    const { prisma } = this.deps;
    const now = new Date();

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
    });
    // `!record` es redundante lógicamente (evaluateResetToken(null) →
    // "not_found"), pero TS no estrecha a partir de la decisión pura.
    if (!record || evaluateResetToken(record, now) !== "valid") {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "El enlace de recuperación no es válido o ha caducado.",
      });
    }

    // El hash es caro (argon2): se calcula fuera de la transacción.
    const passwordHash = await hashPassword(newPassword);
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (result.count === 0) return false;
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      return true;
    });
    if (!claimed) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "El enlace de recuperación no es válido o ha caducado.",
      });
    }
    return { ok: true };
  }

  private lockedError(remainingSec: number): TRPCError {
    const minutes = Math.max(1, Math.ceil(remainingSec / 60));
    return new TRPCError({
      code: "FORBIDDEN",
      message: `Demasiados intentos fallidos. Vuelve a intentarlo en ${minutes} min.`,
    });
  }
}
