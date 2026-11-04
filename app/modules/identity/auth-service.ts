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
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import { base32Encode, buildOtpAuthUri, verifyTotpCode } from "./core/totp";
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
import { TOTP_ISSUER, type TotpChallengeStore } from "./totp";

export interface AuthServiceConfig extends RateLimitConfig {
  /** Vigencia de la sesión en segundos. */
  sessionTtlSec: number;
  /** Vigencia del token de recuperación en segundos (US-02, default 1 h). */
  resetTokenTtlSec: number;
  /** Máx. solicitudes de recuperación por IP por ventana (US-02). */
  resetMaxPerWindow: number;
  /** Ventana del rate limit de recuperación en segundos (US-02). */
  resetWindowSec: number;
  /**
   * Máx. registros por IP por ventana (T-12/ADR-0035, anti-flood: una ola
   * de registros bot llenaría la liga de bienvenida — US-31 — y bloquearía
   * a los usuarios legítimos).
   */
  registerMaxPerWindow: number;
  /** Ventana del rate limit de registro en segundos (T-12/ADR-0035). */
  registerWindowSec: number;
  /** URL pública de la app para montar el link de recuperación (US-02). */
  appUrl: string;
  /**
   * Bootstrap de admin (T-08, ADR-0010): el registro con este email
   * (minúsculas) recibe `global_admin` en la misma transacción.
   * Vacío/ausente → nadie lo recibe.
   */
  bootstrapAdminEmail?: string;
  /**
   * 2FA TOTP (D-07, ADR-0039): vigencia en segundos del reto de login
   * (se emite tras validar la contraseña en una cuenta con 2FA activo).
   */
  totpChallengeTtlSec: number;
  /**
   * 2FA TOTP (D-07, ADR-0039): intentos de código por reto antes de
   * invalidar el reto (los fallos además alimentan el bloqueo por cuenta).
   */
  totpMaxAttempts: number;
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
  /**
   * Store de retos TOTP (D-07, ADR-0039): Redis en producción, in-memory en
   * tests. Frontera de I/O inyectable como `rateLimit`.
   */
  totp: TotpChallengeStore;
  /** Enviador de emails (US-02; provisional: `logEmailSender`, ADR-0009). */
  emailSender: EmailSender;
  cfg: AuthServiceConfig;
  /**
   * US-31: hook BFF dentro de la transacción de registro (p. ej. membresía de
   * bienvenida). `identity` no importa `leagues`; el router inyecta la acción.
   * Si falla, usuario/perfil/roles y membresía hacen rollback juntos.
   */
  onRegistered?: (
    tx: Prisma.TransactionClient,
    user: { id: string },
    meta: { ip: string },
  ) => Promise<void>;
}

export interface AuthResult {
  user: PublicUser;
  /** Token opaco para la cookie de sesión. */
  sessionToken: string;
}

/**
 * Login (D-07, ADR-0039): dos formas de terminar.
 * - Sin 2FA (o ya verificado): `sessionToken` listo para la cookie.
 * - 2FA activo: `totpRequired` + reto opaco (`totpToken`) y SIN sesión;
 *   la sesión solo existe tras `verifyTotp`.
 */
export interface LoginResult {
  user: PublicUser;
  /** Token opaco para la cookie de sesión (null si falta el segundo factor). */
  sessionToken: string | null;
  /** true si la cuenta exige el código de la app de autenticación. */
  totpRequired: boolean;
  /** Reto de vida corta para `verifyTotp` (solo si `totpRequired`). */
  totpToken: string | null;
}

const USER_INCLUDE = {
  profile: true,
  userRoles: { include: { role: true } },
} as const;

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * Registro (US-01): email + contraseña + nombre de usuario.
   * US-31: el hook `onRegistered` puede añadir la bienvenida en la misma
   * transacción; la sesión solo se crea después de confirmar todo.
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
    const { prisma, rateLimit, cfg } = this.deps;

    // Anti-flood de registro (T-12/ADR-0035, security.md §1.6): ventana fija
    // por IP. Sin este límite una ola de registros bot consume las plazas de
    // la liga de bienvenida (US-31: el registro se une a ella atómicamente)
    // y bloquea los registros legítimos. El registro NO cuenta para el
    // rate-limit de login (son contadores independientes).
    const { count, remainingSec } = await rateLimit.recordRegistration(
      meta.ip,
      cfg.registerWindowSec,
    );
    if (count > cfg.registerMaxPerWindow && remainingSec > 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Estás enviando demasiadas peticiones. Inténtalo de nuevo en ${Math.ceil(remainingSec)} s.`,
      });
    }

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
      if (bootstrap && input.email === bootstrap) {
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
      }

      // US-31: el alta de bienvenida (si el BFF la configuró) es atómica con
      // el usuario. Un error aquí revierte también el bootstrap de admin.
      await this.deps.onRegistered?.(tx, { id: created.id }, meta);

      // Relectura para incluir cualquier rol añadido en la respuesta.
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
   * 2FA (D-07, ADR-0039): si la cuenta lo tiene activo, el paso 3 emite un
   * reto corto en lugar de sesión; `verifyTotp` canjea el código por sesión.
   */
  async login(
    input: { email: string; password: string },
    meta: { ip: string },
  ): Promise<LoginResult> {
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

    // 3) 2FA (D-07, ADR-0039): la cuenta con TOTP activo no recibe sesión
    //    con la contraseña sola. Se emite un reto opaco de vida corta; la
    //    sesión solo existe tras `verifyTotp` (presupuesto de intentos +
    //    bloqueo por cuenta reutilizando `rateLimit`).
    if (user.totpEnabledAt !== null && user.totpSecret) {
      // Una contraseña correcta NO es autenticación completa mientras el
      // 2.º factor está pendiente: el contador de fallos de la cuenta NO se
      // resetea aquí (lo resetea `verifyTotp` al canjear el código). Si se
      // reseteara, un atacante con la contraseña rotaría retos infinitamente
      // (login → fallo de código → login → …) y haría fuerza bruta del
      // segundo factor sin que la cuenta se bloqueara (ADR-0039).
      const totpToken = await this.deps.totp.issue(user.id, cfg.totpChallengeTtlSec);
      return {
        user: toPublicUser(user),
        sessionToken: null,
        totpRequired: true,
        totpToken,
      };
    }

    // Autenticación completa (sin 2.º factor): la contraseña correcta
    // reinicia el contador de fallos de la cuenta (US-01).
    await rateLimit.resetFailures(account);
    const session = await createSession(prisma, {
      userId: user.id,
      ttlSec: cfg.sessionTtlSec,
      ip: meta.ip,
    });
    return {
      user: toPublicUser(user),
      sessionToken: session.token,
      totpRequired: false,
      totpToken: null,
    };
  }

  /**
   * Segundo factor del login (D-07, ADR-0039): canjea el código TOTP por
   * sesión.
   *
   * - El reto debe existir y no estar expirado (error genérico en cualquier
   *   caso inválido: no se revela cuál fue).
   * - Presupuesto por reto: `totpMaxAttempts` códigos (al agotarse, el reto
   *   se invalida y hay que volver a login).
   * - Los fallos de código TAMBIÉN alimentan el bloqueo por cuenta existente
   *   (`recordFailure`/`shouldLockAccount`, security.md §1.6): un atacante
   *   con la contraseña no puede hacer fuerza bruta del 6 dígitos sin
   *   bloquear la cuenta (5 fallos → 15 min por defecto).
   * - Código correcto: sesión, reto consumido y fallos en cero.
   */
  async verifyTotp(
    token: string,
    code: string,
    meta: { ip: string },
  ): Promise<AuthResult> {
    const { prisma, rateLimit, cfg } = this.deps;

    const userId = await this.deps.totp.resolve(token);
    if (!userId) throw this.invalidCodeError();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: USER_INCLUDE,
    });
    if (!user || user.isAnonymized || !user.totpSecret) {
      throw this.invalidCodeError();
    }

    // Bloqueo por cuenta (reutilizado del login): si los fallos de código
    // la han bloqueado, ni siquiera se evalúa el código.
    const account = user.email;
    const lockRemainingSec = await rateLimit.lockRemainingSec(account);
    if (lockRemainingSec > 0) {
      throw this.lockedError(lockRemainingSec);
    }

    const failures = await this.deps.totp.failureCount(token);
    if (failures >= cfg.totpMaxAttempts) throw this.invalidCodeError();

    if (!verifyTotpCode(user.totpSecret, code, Date.now())) {
      const challengeFailures = await this.deps.totp.recordFailure(token);
      const accountFailures = await rateLimit.recordFailure(account);
      if (shouldLockAccount(accountFailures, cfg)) {
        await rateLimit.lockAccount(account, cfg.lockoutSec);
        await this.deps.totp.consume(token);
        throw this.lockedError(cfg.lockoutSec);
      }
      if (challengeFailures >= cfg.totpMaxAttempts) {
        await this.deps.totp.consume(token);
      }
      throw this.invalidCodeError();
    }

    await rateLimit.resetFailures(account);
    await this.deps.totp.consume(token);
    const session = await createSession(prisma, {
      userId: user.id,
      ttlSec: cfg.sessionTtlSec,
      ip: meta.ip,
    });
    return { user: toPublicUser(user), sessionToken: session.token };
  }

  /**
   * Matricula el 2FA (D-07, ADR-0039): genera el secreto y lo deja en
   * estado PENDIENTE (`totp_enabled_at = null`): solo `confirmTotp` con un
   * código válido lo activa. Requiere la contraseña actual (operación
   * sensible; re-autenticación, security.md §1.11).
   *
   * Re-matricular (ya activo) sustituye el secreto y vuelve a dejarlo
   * pendiente: el dispositivo nuevo debe confirmarse antes de que el 2FA
   * siga protegiendo la cuenta.
   */
  async enrollTotp(
    userId: string,
    password: string,
    meta: { ip: string },
  ): Promise<{ secret: string; otpauthUri: string }> {
    const { prisma } = this.deps;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isAnonymized) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "La contraseña no es correcta.",
      });
    }

    // 20 bytes aleatorios (160 bits) → base32 (32 caracteres).
    const secret = base32Encode(randomBytes(20));
    const wasEnabled = user.totpEnabledAt !== null;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { totpSecret: secret, totpEnabledAt: null },
      });
      // Auditoría (T-09): acción sensible (seguridad de la cuenta).
      await appendAudit(tx, {
        actorId: user.id,
        action: "totp.enrolled",
        entity: "user",
        entityId: user.id,
        beforeData: { totpEnabled: wasEnabled },
        afterData: { totpEnabled: false, hasSecret: true },
        ip: meta.ip,
      });
    });

    const otpauthUri = buildOtpAuthUri({
      issuer: TOTP_ISSUER,
      account: user.email,
      secretBase32: secret,
    });
    return { secret, otpauthUri };
  }

  /**
   * Confirma la matriculación (D-07, ADR-0039): un código TOTP válido
   * activa el 2FA (`totp_enabled_at = now`). Sin secreto pendiente →
   * PRECONDITION_FAILED (matricular primero).
   */
  async confirmTotp(
    userId: string,
    code: string,
    meta: { ip: string },
  ): Promise<{ enabled: true }> {
    const { prisma } = this.deps;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isAnonymized) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
    }
    if (!user.totpSecret) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Matricula primero el segundo factor (escanea el QR o introduce el secreto).",
      });
    }
    if (!verifyTotpCode(user.totpSecret, code, Date.now())) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "El código no es válido.",
      });
    }

    const now = new Date(Date.now());
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { totpEnabledAt: now },
      });
      await appendAudit(tx, {
        actorId: user.id,
        action: "totp.enabled",
        entity: "user",
        entityId: user.id,
        afterData: { totpEnabled: true, enabledAt: now },
        ip: meta.ip,
      });
    });
    return { enabled: true };
  }

  /**
   * Desactiva el 2FA (D-07, ADR-0039): borra secreto y activación. Requiere
   * la contraseña actual (quitar una capa de seguridad exige
   * re-autenticación, como `deleteAccount`, ADR-0016).
   */
  async disableTotp(
    userId: string,
    password: string,
    meta: { ip: string },
  ): Promise<{ enabled: false }> {
    const { prisma } = this.deps;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.isAnonymized) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
    }
    if (!user.totpSecret && user.totpEnabledAt === null) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "La autenticación en dos pasos no está activa.",
      });
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "La contraseña no es correcta.",
      });
    }

    const wasEnabled = user.totpEnabledAt !== null;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { totpSecret: null, totpEnabledAt: null },
      });
      await appendAudit(tx, {
        actorId: user.id,
        action: "totp.disabled",
        entity: "user",
        entityId: user.id,
        beforeData: { totpEnabled: wasEnabled },
        afterData: { totpEnabled: false, hasSecret: false },
        ip: meta.ip,
      });
    });
    return { enabled: false };
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

  /**
   * Error genérico del segundo factor (D-07): el mismo mensaje para reto
   * inexistente/expirado, código incorrecto y presupuesto agotado (no
   * revelar cuál fue el caso).
   */
  private invalidCodeError(): TRPCError {
    return new TRPCError({
      code: "UNAUTHORIZED",
      message: "El código no es válido o ha caducado.",
    });
  }
}
