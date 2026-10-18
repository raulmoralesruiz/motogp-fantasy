/**
 * Glue de tRPC del servidor (T-24): `clientIp`, `createContext`,
 * `errorFormatter` y los procedimientos con guardas (`protectedProcedure`,
 * `adminProcedure`).
 *
 * Los singletons `../prisma` y `../redis` se mockean (están excluidos de
 * cobertura por el ADR-0011); la BD de `createContext` se inyecta como fake
 * (el patrón de deps inyectables de los routers).
 */
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/identity";

vi.mock("../prisma", () => ({ prisma: {} }));
vi.mock("../redis", () => ({ redis: {} }));

import {
  adminProcedure,
  clientIp,
  createContext,
  protectedProcedure,
  publicProcedure,
  router,
  type Context,
} from "../trpc";

/** Request mínimo con cabeceras controlables. */
function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/trpc", { method: "POST", headers });
}

/** BD fake: solo `session.findUnique`, que es lo que usa `findActiveSessionUser`. */
function fakeDb(session: unknown): PrismaClient {
  return {
    session: { findUnique: vi.fn(async () => session) },
  } as unknown as PrismaClient;
}

const SESSION_USER = {
  id: "u1",
  email: "ana@ejemplo.com",
  username: "ana",
  passwordHash: "hash",
  isAnonymized: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  profile: null,
  userRoles: [{ role: { name: "user" } }],
} as unknown as SessionUser;

function activeSession(user: SessionUser = SESSION_USER) {
  return {
    token: "token-opaco",
    revokedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    user,
  };
}

describe("clientIp", () => {
  it("usa la primera IP de X-Forwarded-For", () => {
    const req = requestWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("ignora X-Forwarded-For en blanco y cae a X-Real-IP", () => {
    const req = requestWith({ "x-forwarded-for": "   ", "x-real-ip": "9.9.9.9" });
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("usa X-Real-IP si no hay X-Forwarded-For", () => {
    const req = requestWith({ "x-real-ip": "  8.8.8.8  " });
    expect(clientIp(req)).toBe("8.8.8.8");
  });

  it("devuelve 'desconocida' si no hay ninguna cabecera", () => {
    expect(clientIp(requestWith({}))).toBe("desconocida");
  });
});

describe("createContext", () => {
  it("sin cookie: user null, roles vacíos, sin sessionToken", async () => {
    const db = fakeDb(null);
    const ctx = await createContext(requestWith({ "x-forwarded-for": "1.1.1.1" }), db);

    expect(ctx.user).toBeNull();
    expect(ctx.userRoles).toEqual([]);
    expect(ctx.sessionToken).toBeUndefined();
    expect(ctx.ip).toBe("1.1.1.1");
    expect(ctx.prisma).toBe(db);
    expect(ctx.pendingCookies).toEqual([]);
    expect(db.session.findUnique as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("con cookie de sesión válida: resuelve user y roles", async () => {
    const db = fakeDb(activeSession());
    const req = requestWith({ cookie: "session=token-opaco; otra=1" });

    const ctx = await createContext(req, db);

    expect(ctx.user).toBe(SESSION_USER);
    expect(ctx.userRoles).toEqual(["user"]);
    expect(ctx.sessionToken).toBe("token-opaco");
    expect(db.session.findUnique).toHaveBeenCalledWith({
      where: { token: "token-opaco" },
      include: {
        user: { include: { profile: true, userRoles: { include: { role: true } } } },
      },
    });
  });

  it("con cookie pero sesión revocada/expirada/ausente: user null", async () => {
    const db = fakeDb(null);
    const req = requestWith({ cookie: "session=token-muerto" });

    const ctx = await createContext(req, db);

    expect(ctx.user).toBeNull();
    expect(ctx.userRoles).toEqual([]);
    expect(ctx.sessionToken).toBe("token-muerto");
  });
});

describe("errorFormatter (vía fetchRequestHandler)", () => {
  const errorRouter = router({
    boom: publicProcedure.mutation(() => {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Algo no va" });
    }),
  });

  it("expone code + message en español en el error de la respuesta", async () => {
    const ctx = await createContext(requestWith({}));
    const res = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/boom?batch=1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ 0: { json: {} } }),
      }),
      router: errorRouter,
      createContext: async () => ctx,
    });
    // Formato v11: array JSON-RPC; el error va en `error.json.data`
    // (el errorFormatter añade `code` y `message` a `data`).
    const body = (await res.json()) as Array<{
      error: { json: { data: { code: string; message: string } } };
    }>;

    expect(body).toHaveLength(1);
    const data = body[0]?.error?.json?.data;
    expect(data?.code).toBe("BAD_REQUEST");
    expect(data?.message).toBe("Algo no va");
  });
});

describe("guardas de procedimiento (vía createCaller)", () => {
  const guardRouter = router({
    protected: protectedProcedure.query(() => "ok-protected"),
    admin: adminProcedure.query(() => "ok-admin"),
  });

  function ctxWith(user: SessionUser | null, userRoles: Context["userRoles"]): Context {
    return {
      prisma: {},
      redis: {},
      ip: "1.2.3.4",
      user,
      userRoles,
      sessionToken: user ? "token-opaco" : undefined,
      pendingCookies: [],
    } as unknown as Context;
  }

  it("protectedProcedure: sin sesión → UNAUTHORIZED", async () => {
    const caller = guardRouter.createCaller(ctxWith(null, []));
    await expect(caller.protected()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "No estás autenticado",
    });
  });

  it("protectedProcedure: con sesión → ejecuta", async () => {
    const caller = guardRouter.createCaller(ctxWith(SESSION_USER, ["user"]));
    await expect(caller.protected()).resolves.toBe("ok-protected");
  });

  it("adminProcedure: autenticado sin global_admin → FORBIDDEN (403, no 401)", async () => {
    const caller = guardRouter.createCaller(ctxWith(SESSION_USER, ["user"]));
    await expect(caller.admin()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "No tienes permisos para acceder al panel de administración.",
    });
  });

  it("adminProcedure: con global_admin → ejecuta", async () => {
    const adminUser = {
      ...SESSION_USER,
      userRoles: [{ role: { name: "global_admin" } }],
    } as unknown as SessionUser;
    const caller = guardRouter.createCaller(ctxWith(adminUser, ["global_admin"]));
    await expect(caller.admin()).resolves.toBe("ok-admin");
  });
});
