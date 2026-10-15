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

import { getDummyHash, hashPassword, verifyPassword } from "./password";
import { createSession, toPublicUser, type PublicUser } from "./sessions";
import {
  evaluateLoginAttempt,
  shouldLockAccount,
  type RateLimitConfig,
  type RateLimitStore,
} from "./rate-limit";

export interface AuthServiceConfig extends RateLimitConfig {
  /** Vigencia de la sesión en segundos. */
  sessionTtlSec: number;
}

export interface AuthServiceDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
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
   */
  async register(input: {
    email: string;
    username: string;
    password: string;
  }): Promise<AuthResult> {
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
      // El rol `user` es idempotente (la tabla nace vacía; no hay seed).
      const role = await tx.role.upsert({
        where: { name: "user" },
        update: {},
        create: { name: "user", description: "Usuario registrado" },
      });
      return tx.user.create({
        data: {
          email: input.email,
          username: input.username,
          passwordHash,
          profile: { create: { displayName: input.username } },
          userRoles: { create: { roleId: role.id } },
        },
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

  private lockedError(remainingSec: number): TRPCError {
    const minutes = Math.max(1, Math.ceil(remainingSec / 60));
    return new TRPCError({
      code: "FORBIDDEN",
      message: `Demasiados intentos fallidos. Vuelve a intentarlo en ${minutes} min.`,
    });
  }
}
