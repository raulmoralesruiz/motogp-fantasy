/**
 * Router de health-check (T-24): estado de app, BD y Redis. Se prueba con
 * un contexto fake (prisma/redis inyectados) y sin Docker; el timeout de
 * 3 s se cubre con timers falsos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../prisma", () => ({ prisma: {} }));
vi.mock("../../redis", () => ({ redis: {} }));

import { healthRouter } from "../health";
import type { Context } from "../../trpc";

function ctxWith(prisma: object, redis: object): Context {
  return {
    prisma,
    redis,
    ip: "1.2.3.4",
    user: null,
    userRoles: [],
    pendingCookies: [],
  } as unknown as Context;
}

describe("health.check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("todo OK → status 'ok' con info de la app", async () => {
    const caller = healthRouter.createCaller(
      ctxWith(
        { $queryRawUnsafe: vi.fn(async () => [{ ok: 1 }]) },
        { ping: vi.fn(async () => "PONG") },
      ),
    );

    const res = await caller.check();

    expect(res.status).toBe("ok");
    expect(res.app).toEqual({
      name: "fantasy-motogp",
      version: "0.1.0",
      fase: "Fase 1 (E2)",
    });
    expect(res.database.ok).toBe(true);
    expect(res.redis.ok).toBe(true);
    expect(new Date(res.comprobadoEn).toString()).not.toBe("Invalid Date");
  });

  it("BD caída → status 'degradada' (el error no propaga)", async () => {
    const caller = healthRouter.createCaller(
      ctxWith(
        {
          $queryRawUnsafe: vi.fn(async () => {
            throw new Error("no hay BD");
          }),
        },
        { ping: vi.fn(async () => "PONG") },
      ),
    );

    const res = await caller.check();

    expect(res.status).toBe("degradada");
    expect(res.database.ok).toBe(false);
    expect(res.redis.ok).toBe(true);
  });

  it("Redis caído → status 'degradada' (el error no propaga)", async () => {
    const caller = healthRouter.createCaller(
      ctxWith(
        { $queryRawUnsafe: vi.fn(async () => [{ ok: 1 }]) },
        {
          ping: vi.fn(async () => {
            throw new Error("no hay Redis");
          }),
        },
      ),
    );

    const res = await caller.check();

    expect(res.status).toBe("degradada");
    expect(res.database.ok).toBe(true);
    expect(res.redis.ok).toBe(false);
  });

  it("BD que tarda más de 3 s → timeout → 'degradada' (no bloquea el check)", async () => {
    const caller = healthRouter.createCaller(
      ctxWith(
        { $queryRawUnsafe: () => new Promise(() => {}) }, // nunca resuelve
        { ping: vi.fn(async () => "PONG") },
      ),
    );

    const pending = caller.check();
    await vi.advanceTimersByTimeAsync(3_000);
    const res = await pending;

    expect(res.status).toBe("degradada");
    expect(res.database.ok).toBe(false);
    expect(res.redis.ok).toBe(true);
  });
});
