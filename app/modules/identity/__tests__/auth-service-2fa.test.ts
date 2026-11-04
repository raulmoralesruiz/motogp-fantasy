/**
 * Tests de `AuthService` — 2FA TOTP (D-07, ADR-0039):
 * - `login`: cuenta con 2FA activo → reto (sin sesión); sin 2FA → sesión.
 * - `verifyTotp`: presupuesto por reto, bloqueo por cuenta, expiración,
 *   consumo del reto y emisión de sesión solo con código válido.
 * - `enrollTotp` / `confirmTotp` / `disableTotp`: matriculación,
 *   confirmación y desactivación (re-autenticación con contraseña).
 *
 * `prisma` se inyecta como objeto falso (DI, como el resto de los tests del
 * módulo); el reloj se fija con `vi.spyOn(Date, "now")` para calcular los
 * códigos TOTP sin race de paso de 30 s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { AuthService } from "../auth-service";
import { computeTotp } from "../core/totp";
import { LogEmailSender } from "../email";
import { hashPassword } from "../password";
import { InMemoryRateLimitStore } from "../rate-limit";
import { InMemoryTotpChallengeStore } from "../totp";

const PASSWORD = "clave-de-prueba-123";
const IP = "203.0.113.5";

/** Instante fijo para calcular códigos (el reloj se pincha con Date.now). */
const T0 = 1_750_000_000_000;
const T_ALIGNED = Math.floor(T0 / 30_000) * 30_000 + 1_000;

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-admin",
    email: "admin@liga.com",
    username: "admin_gp",
    passwordHash: "", // se rellena por test (argon2 real)
    isAnonymized: false,
    anonymizedAt: null,
    createdAt: new Date(T0),
    updatedAt: new Date(T0),
    profile: null,
    userRoles: [],
    totpSecret: null as string | null,
    totpEnabledAt: null as Date | null,
    ...overrides,
  };
}

function makePrisma(user: ReturnType<typeof makeUser>) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async ({ data }: { data: unknown }) => {
        Object.assign(user, data);
        return user;
      }),
    },
    session: {
      create: vi.fn(async () => ({ token: "sesion-1", revokedAt: null })),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma as unknown as PrismaClient & {
    user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    session: { create: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

function makeService(
  user: ReturnType<typeof makeUser>,
  cfgOverride: Partial<Record<string, number>> = {},
) {
  const prisma = makePrisma(user);
  const rateLimit = new InMemoryRateLimitStore();
  const totp = new InMemoryTotpChallengeStore();
  const service = new AuthService({
    prisma,
    rateLimit,
    totp,
    emailSender: new LogEmailSender(),
    cfg: {
      maxPerWindow: 100,
      windowSec: 60,
      lockoutThreshold: 5,
      lockoutSec: 900,
      sessionTtlSec: 3600,
      resetTokenTtlSec: 3600,
      resetMaxPerWindow: 5,
      resetWindowSec: 60,
      registerMaxPerWindow: 100,
      registerWindowSec: 3600,
      appUrl: "https://app.test",
      totpChallengeTtlSec: 300,
      totpMaxAttempts: 5,
      ...cfgOverride,
    },
  });
  return { service, prisma, rateLimit, totp, user };
}

describe("AuthService · 2FA TOTP (D-07, ADR-0039)", () => {
  let passwordHash: string;

  beforeEach(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pinClock() {
    vi.spyOn(Date, "now").mockReturnValue(T_ALIGNED);
  }
  function codeFor(user: { totpSecret: string | null }): string {
    return computeTotp(user.totpSecret ?? "", T_ALIGNED);
  }

  describe("login", () => {
    it("sin 2FA: emite sesión como antes", async () => {
      const { service, user } = makeService(makeUser({ passwordHash }));
      const result = await service.login(
        { email: "admin@liga.com", password: PASSWORD },
        { ip: IP },
      );
      expect(result.sessionToken).toBe("sesion-1");
      expect(result.totpRequired).toBe(false);
      expect(result.totpToken).toBeNull();
      expect(result.user.totpEnabled).toBe(false);
      expect(user.id).toBe("u-admin");
    });

    it("con 2FA activo: reto opaco y SIN sesión (la cookie se emite en verifyTotp)", async () => {
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, prisma } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
      );
      const result = await service.login(
        { email: "admin@liga.com", password: PASSWORD },
        { ip: IP },
      );
      expect(result.sessionToken).toBeNull();
      expect(result.totpRequired).toBe(true);
      expect(result.totpToken).toMatch(/^[0-9a-f]{64}$/);
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(result.user.totpEnabled).toBe(true);
    });

    it("matriculado sin confirmar (secret + enabledAt null): NO exige código (2FA aún no activo)", async () => {
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, prisma } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: null }),
      );
      const result = await service.login(
        { email: "admin@liga.com", password: PASSWORD },
        { ip: IP },
      );
      expect(result.totpRequired).toBe(false);
      expect(prisma.session.create).toHaveBeenCalled();
    });
  });

  describe("verifyTotp (segundo factor)", () => {
    it("código válido: sesión + reto consumido + fallos en cero", async () => {
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, totp, user } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
      );
      const token = await totp.issue("u-admin", 300);
      await totp.recordFailure(token);

      const result = await service.verifyTotp(token, codeFor(user), { ip: IP });
      expect(result.sessionToken).toBe("sesion-1");
      expect(await totp.resolve(token)).toBeNull(); // consumido
      expect(await totp.failureCount(token)).toBe(0);
    });

    it("reto inexistente/expirado: error genérico (no se revela cuál fue)", async () => {
      const { service } = makeService(makeUser({ passwordHash }));
      await expect(
        service.verifyTotp("token-fantasma", "123456", { ip: IP }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "El código no es válido o ha caducado.",
      });
    });

    it("código incorrecto: fallo en el reto Y en el bloqueo por cuenta", async () => {
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, totp } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
      );
      const token = await totp.issue("u-admin", 300);

      await expect(
        service.verifyTotp(token, "000000", { ip: IP }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      // Fallo contabilizado en el reto (presupuesto) — y también en la cuenta
      // (el 5º fallo la bloquea: test siguiente).
      expect(await totp.failureCount(token)).toBe(1);
      expect(await totp.resolve(token)).toBe("u-admin"); // el reto sigue vivo
    });

    it("presupuesto por reto agotado: el reto se invalida y hay que volver a login", async () => {
      // totpMaxAttempts=3 < lockoutThreshold=10: el presupuesto del reto
      // dispara ANTES que el bloqueo de cuenta (se testea por separado).
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, totp, user } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
        { totpMaxAttempts: 3, lockoutThreshold: 10 },
      );
      const token = await totp.issue("u-admin", 300);

      await expect(service.verifyTotp(token, "000000", { ip: IP })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(service.verifyTotp(token, "000000", { ip: IP })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      // 3er fallo: presupuesto agotado → reto consumido (ni el código bueno pasa).
      await expect(service.verifyTotp(token, "000000", { ip: IP })).rejects.toBeTruthy();
      expect(await totp.resolve(token)).toBeNull();

      // Un reto NUEVO (re-login) sí funciona con el código correcto.
      const fresh = await totp.issue("u-admin", 300);
      const result = await service.verifyTotp(fresh, codeFor(user), { ip: IP });
      expect(result.sessionToken).toBe("sesion-1");
    });

    it("el 5º fallo de código bloquea la cuenta (lockout 15 min) — fuerza bruta contenida", async () => {
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, totp, rateLimit, user } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
      );
      const token = await totp.issue("u-admin", 300);

      for (let i = 0; i < 4; i++) {
        await service.verifyTotp(token, "000000", { ip: IP }).catch(() => {});
      }
      await expect(service.verifyTotp(token, "000000", { ip: IP })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("Demasiados intentos"),
      });
      // Cuenta bloqueada: ni el código válido pasa ahora.
      expect(await rateLimit.lockRemainingSec("admin@liga.com")).toBeGreaterThan(0);
      const goodToken = await totp.issue("u-admin", 300);
      await expect(
        service.verifyTotp(goodToken, codeFor(user), { ip: IP }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("cuenta bloqueada: error FORBIDDEN sin evaluar el código", async () => {
      const { service, totp, rateLimit } = makeService(
        makeUser({
          passwordHash,
          totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
          totpEnabledAt: new Date(T0),
        }),
      );
      await rateLimit.lockAccount("admin@liga.com", 900);
      const token = await totp.issue("u-admin", 300);
      await expect(service.verifyTotp(token, "123456", { ip: IP })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("login 2FA con contraseña correcta NO resetea el contador de la cuenta (no rota retos en bucle)", async () => {
      // lockoutThreshold=2: el 2.º fallo de código debe bloquear la cuenta.
      // Si el login (contraseña correcta) reseteara el contador — como pasa
      // con los logins sin 2FA — el atacante rotaría retos infinitamente
      // (login → fallo de código → login → …) sin bloquearse (ADR-0039).
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, rateLimit } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
        { lockoutThreshold: 2 },
      );
      const account = "admin@liga.com";
      await rateLimit.recordFailure(account); // fallo previo (p. ej. código malo)

      const login = await service.login({ email: account, password: PASSWORD }, { ip: IP });
      expect(login.totpRequired).toBe(true);
      expect(login.totpToken).not.toBeNull();

      // El fallo previo pervive: este 2.º fallo de código bloquea la cuenta.
      await expect(
        service.verifyTotp(login.totpToken!, "000000", { ip: IP }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("Demasiados intentos"),
      });
      expect(await rateLimit.lockRemainingSec(account)).toBeGreaterThan(0);
      // Y el login siguiente queda bloqueado (ni la contraseña correcta pasa).
      await expect(
        service.login({ email: account, password: PASSWORD }, { ip: IP }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("enrollTotp (matriculación)", () => {
    it("genera secreto base32 de 32 caracteres + URI otpauth, y deja el 2FA PENDIENTE", async () => {
      const { service, prisma, user } = makeService(makeUser({ passwordHash }));
      const { secret, otpauthUri } = await service.enrollTotp(
        "u-admin",
        PASSWORD,
        { ip: IP },
      );
      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(otpauthUri).toContain("otpauth://totp/");
      expect(user.totpSecret).toBe(secret);
      expect(user.totpEnabledAt).toBeNull(); // pendiente hasta confirm
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "totp.enrolled" }) }),
      );
    });

    it("contraseña incorrecta: UNAUTHORIZED y sin secreto generado", async () => {
      const { service, user } = makeService(makeUser({ passwordHash }));
      await expect(
        service.enrollTotp("u-admin", "contraseña-mala", { ip: IP }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(user.totpSecret).toBeNull();
    });

    it("re-matricula sobre uno activo: sustituye el secreto y vuelve a pendiente", async () => {
      const oldSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, user } = makeService(
        makeUser({ passwordHash, totpSecret: oldSecret, totpEnabledAt: new Date(T0) }),
      );
      const { secret } = await service.enrollTotp("u-admin", PASSWORD, { ip: IP });
      expect(secret).not.toBe(oldSecret);
      expect(user.totpEnabledAt).toBeNull(); // debe confirmarse de nuevo
    });
  });

  describe("confirmTotp (activación)", () => {
    it("código válido: activa el 2FA (totpEnabledAt = now)", async () => {
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, user } = makeService(makeUser({ passwordHash, totpSecret: secret }));
      const result = await service.confirmTotp("u-admin", codeFor(user), { ip: IP });
      expect(result).toEqual({ enabled: true });
      expect(user.totpEnabledAt).toEqual(new Date(T_ALIGNED));
    });

    it("código incorrecto: UNAUTHORIZED y sigue sin activar", async () => {
      pinClock();
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, user } = makeService(makeUser({ passwordHash, totpSecret: secret }));
      await expect(
        service.confirmTotp("u-admin", "000000", { ip: IP }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(user.totpEnabledAt).toBeNull();
    });

    it("sin matricular: PRECONDITION_FAILED (matricular primero)", async () => {
      const { service } = makeService(makeUser({ passwordHash }));
      await expect(
        service.confirmTotp("u-admin", "123456", { ip: IP }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  describe("disableTotp (desactivación)", () => {
    it("contraseña correcta: borra secreto y activación + auditoría", async () => {
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, prisma, user } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
      );
      const result = await service.disableTotp("u-admin", PASSWORD, { ip: IP });
      expect(result).toEqual({ enabled: false });
      expect(user.totpSecret).toBeNull();
      expect(user.totpEnabledAt).toBeNull();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "totp.disabled" }) }),
      );
    });

    it("contraseña incorrecta: UNAUTHORIZED y el 2FA sigue activo", async () => {
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const { service, user } = makeService(
        makeUser({ passwordHash, totpSecret: secret, totpEnabledAt: new Date(T0) }),
      );
      await expect(
        service.disableTotp("u-admin", "mala", { ip: IP }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(user.totpSecret).toBe(secret);
      expect(user.totpEnabledAt).not.toBeNull();
    });

    it("sin matricular: PRECONDITION_FAILED", async () => {
      const { service } = makeService(makeUser({ passwordHash }));
      await expect(
        service.disableTotp("u-admin", PASSWORD, { ip: IP }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });
});
