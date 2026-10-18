/**
 * Glue de calendario del router de seasons (T-24):
 * - `toCalendarTrpcError`: traduce los fallos de la fuente (red/HTTP y
 *   normalización) a `TRPCError INTERNAL_SERVER_ERROR` con el motivo en
 *   español; cualquier otro error se re-lanza tal cual.
 * - `getDefaultSeasonsRouter()`: router por defecto con el singleton de BD
 *   (construcción perezosa, cacheada).
 *
 * `calendarSource` se inyecta como fake (el patrón de deps inyectables del
 * router); los singletons `../../prisma` y `../../redis` se mockean
 * (excluidos de cobertura por ADR-0011).
 */
import { describe, expect, it, vi } from "vitest";

import type { Context } from "../../trpc";

vi.mock("../../prisma", () => ({ prisma: {} }));
vi.mock("../../redis", () => ({ redis: {} }));

// Env válido ANTES de importar el router (por los singletons de la app).
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.REDIS_URL = "redis://localhost:6379/0";

const { createSeasonsRouter, getDefaultSeasonsRouter } = await import("../seasons");
const { CalendarNormalizationError, CalendarSourceError } =
  await import("@/modules/seasons");

/** Contexto de un `global_admin` (las mutaciones del router son `adminProcedure`). */
function ctxAdmin(): Context {
  return {
    prisma: {},
    redis: {},
    ip: "1.2.3.4",
    user: { id: "admin1", userRoles: [{ role: { name: "global_admin" } }] } as never,
    userRoles: ["global_admin"],
    sessionToken: "token-opaco",
    pendingCookies: [],
  } as unknown as Context;
}

function routerConFuente(fetchSeasonCalendar: (year: number) => Promise<unknown>) {
  return createSeasonsRouter({
    prisma: {} as never,
    calendarSource: { fetchSeasonCalendar } as never,
  });
}

describe("seasons.calendar.fetch (traducción de errores de la fuente, T-24)", () => {
  it("CalendarSourceError → INTERNAL_SERVER_ERROR con el motivo", async () => {
    const caller = routerConFuente(async () => {
      throw new CalendarSourceError("PulseLive no responde (HTTP 503)");
    }).createCaller(ctxAdmin());

    await expect(caller.calendar.fetch({ year: 2026 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "PulseLive no responde (HTTP 503)",
    });
  });

  it("CalendarNormalizationError → INTERNAL_SERVER_ERROR con el motivo", async () => {
    const caller = routerConFuente(async () => {
      throw new CalendarNormalizationError("La ronda 3 no tiene fecha");
    }).createCaller(ctxAdmin());

    await expect(caller.calendar.fetch({ year: 2026 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "La ronda 3 no tiene fecha",
    });
  });

  it("un error ajeno a la fuente no se traduce (llega como INTERNAL_SERVER_ERROR)", async () => {
    const caller = routerConFuente(async () => {
      throw new Error("boom interno");
    }).createCaller(ctxAdmin());

    // `toCalendarTrpcError` lo re-lanza sin traducir (línea `throw error`);
    // la maquinaria de tRPC lo envuelve en TRPCError conservando el mensaje.
    await expect(caller.calendar.fetch({ year: 2026 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "boom interno",
    });
  });
});

describe("seasons router (glue de producción, T-24)", () => {
  it("getDefaultSeasonsRouter monta el router (perezoso y cacheado)", () => {
    const r1 = getDefaultSeasonsRouter();
    const r2 = getDefaultSeasonsRouter();

    expect(r1).toBe(r2);
    expect(typeof r1.createCaller).toBe("function");
  });
});
