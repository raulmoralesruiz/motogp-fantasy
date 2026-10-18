/**
 * Glue de producción del router de auth (T-24):
 * - `getDefaultAuthRouter()`: monta el router con los singletons de la app
 *   y el entorno (construcción perezosa, cacheada).
 * - Rama defensiva de `logout` sin `sessionToken` (no puede pasar en
 *   producción: `protectedProcedure` garantiza la sesión; el tipo no lo sabe).
 *
 * Los singletons `../../prisma` y `../../redis` se mockean (excluidos de
 * cobertura por ADR-0011) y el entorno se fija antes del import dinámico.
 */
import { describe, expect, it, vi } from "vitest";

import type { Context } from "../../trpc";

vi.mock("../../prisma", () => ({ prisma: {} }));
vi.mock("../../redis", () => ({ redis: {} }));

// Env válido ANTES de importar el router (getDefaultAuthRouter lee el env).
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.REDIS_URL = "redis://localhost:6379/0";
process.env.SESSION_COOKIE_SECURE = "false";

const { createAuthRouter, getDefaultAuthRouter } = await import("../auth");
const { InMemoryRateLimitStore } = await import("@/modules/identity");

function ctxSinToken(): Context {
  return {
    prisma: {},
    redis: {},
    ip: "1.2.3.4",
    user: { id: "u1", userRoles: [] } as never,
    userRoles: [],
    // Sin sessionToken: el caso defensivo de `logout`.
    pendingCookies: [],
  } as unknown as Context;
}

describe("auth router (glue de producción, T-24)", () => {
  it("getDefaultAuthRouter monta el router (perezoso y cacheado)", () => {
    const r1 = getDefaultAuthRouter();
    const r2 = getDefaultAuthRouter();

    expect(r1).toBe(r2);
    expect(typeof r1.createCaller).toBe("function");
  });

  it("logout sin sessionToken → UNAUTHORIZED (guarda defensiva)", async () => {
    const authRouter = createAuthRouter({
      prisma: {} as never,
      rateLimit: new InMemoryRateLimitStore(),
      sessionTtlSec: 3_600,
      secureCookie: false,
      rateLimitCfg: {
        maxPerWindow: 5,
        windowSec: 60,
        lockoutThreshold: 3,
        lockoutSec: 900,
      },
      emailSender: { sendResetLink: async () => {} },
      appUrl: "http://localhost:3000",
      resetCfg: { tokenTtlSec: 3_600, maxPerWindow: 5, windowSec: 300 },
    });

    // `authRouter` es el router interior: sin el prefijo `auth.` (lo añade
    // el appRouter al anidarlo).
    await expect(authRouter.createCaller(ctxSinToken()).logout()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "No estás autenticado",
    });
  });
});
