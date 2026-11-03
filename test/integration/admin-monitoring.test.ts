/**
 * T-14 · Monitoreo: router `admin` — `jobsStatus` + `sourceHealth`
 * (ADR-0036, PostgreSQL real).
 *
 * Mismo patrón que `rbac.test.ts`: `DATABASE_URL`/`REDIS_URL` antes del
 * `import()` dinámico; el admin se crea por bootstrap (ADR-0010).
 *
 * Semánticas cubiertas:
 * - RBAC: `jobsStatus` y `sourceHealth` son solo `global_admin`
 *   (403/401) — la UI es una vista (AGENTS.md §8).
 * - `jobsStatus` (admin): colas BullMQ (counts + último fallo), alertas
 *   activas (`source_state` por encima del umbral), estado del probe de la
 *   fuente (Redis) y `sentryEnabled` (sin DSN ⇒ false en tests).
 * - `sourceHealth` (admin): probe inyectado (fake, sin red) — ok y fallo.
 *
 * La suite requiere Redis real (counts de colas + estado del probe): si no
 * hay (el global setup no lo arrancó), se saltan los tests que lo necesitan
 * (patrón `jobs-lock.test.ts`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CapturingEmailSender,
  createPrisma,
  integrationDbUrl,
  integrationRedisUrl,
} from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL = integrationRedisUrl() ?? "redis://localhost:6379/0";
delete process.env.NEXT_PUBLIC_SENTRY_DSN; // tests: Sentry desactivado

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { adminRouter, createAdminRouter } = await import(
  "../../app/server/routers/admin"
);
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");
const { redisProbeStateStore } = await import(
  "../../app/server/probe-state-redis"
);
const { PROVISIONAL_RESULTS_POLL } = await import("../../app/shared/config");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const BOOTSTRAP_EMAIL = email("admin");

const skipNoRedis = integrationRedisUrl() === null;

describe("T-14 · admin.jobsStatus + admin.sourceHealth (ADR-0036)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let adminEmail: string;
  let userEmail: string;
  let gpId: string;

  beforeAll(async () => {
    prisma = createPrisma();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      sessionTtlSec: 3600,
      secureCookie: true,
      rateLimitCfg: {
        maxPerWindow: 5,
        windowSec: 60,
        lockoutThreshold: 3,
        lockoutSec: 900,
      },
      emailSender: new CapturingEmailSender(),
      appUrl: "http://localhost:3000",
      resetCfg: { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 },
      registerCfg: { maxPerWindow: 100, windowSec: 3600 },
      bootstrapAdminEmail: BOOTSTRAP_EMAIL,
    });

    // Admin + user de prueba.
    adminEmail = BOOTSTRAP_EMAIL;
    userEmail = email("maria");
    for (const [em, uname] of [
      [adminEmail, username("admin")],
      [userEmail, username("maria")],
    ] as const) {
      const caller = authRouter.createCaller(await ctxFor("198.51.100.1"));
      await caller.register({
        email: em,
        username: uname,
        password: PASSWORD,
        termsAccepted: true,
      });
    }

    // GP de prueba (FK de source_state).
    const season = await prisma.season.create({
      data: { name: `Temporada T14 ${suffix}`, year: 2026 },
    });
    const circuit = await prisma.circuit.create({
      data: { name: `Circuito T14 ${suffix}`, country: "ES" },
    });
    const gp = await prisma.gp.create({
      data: {
        seasonId: season.id,
        round: 1,
        name: `GP de pruebas ${suffix}`,
        circuitId: circuit.id,
        date: new Date("2026-11-02T14:00:00Z"),
      },
    });
    gpId = gp.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto tRPC (IP + cookie opcional) para montadores createCaller. */
  async function ctxFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/admin", {
      method: "POST",
      headers,
    });
    return createContext(req, prisma);
  }

  /** Token de sesión emitido en `pendingCookies` (login). */
  function tokenFrom(pending: string[]): string {
    const token = /^session=([0-9a-f]{64});/.exec(pending[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie inesperada: ${pending[0]}`);
    return token;
  }

  /**
   * Ctx con sesión activa de admin/user + caller del router admin.
   * Cada login usa SU IP (patrón rbac.test.ts): el rate-limit anti fuerza
   * bruta es 5 intentos/min/IP, y esta suite vuelve a loguear por test —
   * compartir IP dispararía "Estás enviando demasiadas peticiones.".
   */
  let loginIp = 10;
  async function callerAs(isAdmin: boolean) {
    const em = isAdmin ? adminEmail : userEmail;
    const ip = `198.51.100.${loginIp++}`;
    const loginCtx = await ctxFor(ip);
    await authRouter.createCaller(loginCtx).login({ email: em, password: PASSWORD });
    const token = tokenFrom(loginCtx.pendingCookies);
    const ctx = await ctxFor(ip, token);
    return { ctx, admin: adminRouter.createCaller(ctx) };
  }

  describe("RBAC (403/401, solo global_admin)", () => {
    it("un user: jobsStatus 403 FORBIDDEN", async () => {
      const { admin } = await callerAs(false);
      await expect(admin.jobsStatus()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("un user: sourceHealth 403 FORBIDDEN", async () => {
      const { admin } = await callerAs(false);
      await expect(admin.sourceHealth()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("sin sesión: jobsStatus 401 UNAUTHORIZED", async () => {
      const ctx = await ctxFor("198.51.100.3");
      await expect(
        adminRouter.createCaller(ctx).jobsStatus(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("sin sesión: sourceHealth 401 UNAUTHORIZED", async () => {
      const ctx = await ctxFor("198.51.100.3");
      await expect(
        adminRouter.createCaller(ctx).sourceHealth(),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("admin.jobsStatus (admin global)", () => {
    it.skipIf(skipNoRedis)(
      "colas: names + counts numéricos + sin fallidos en la BD efímera",
      async () => {
        const { admin } = await callerAs(true);
        const status = await admin.jobsStatus();

        expect(status.queues.map((q) => q.name).sort()).toEqual([
          "gp-prices",
          "results-poll",
        ]);
        for (const queue of status.queues) {
          expect(queue.waiting).toBeTypeOf("number");
          expect(queue.failed).toBeTypeOf("number");
          expect(queue.lastFailedJob).toBeNull();
        }
      },
      20_000,
    );

    it("sentryEnabled: false sin DSN (modo provisional en tests)", async () => {
      const { admin } = await callerAs(true);
      const status = await admin.jobsStatus();
      expect(status.sentryEnabled).toBe(false);
    });

    it("alertas activas: source_state ≥ umbral aparece con fechas ISO", async () => {
      const threshold = PROVISIONAL_RESULTS_POLL.failureAlertThreshold;
      const lastAttempt = new Date("2026-11-02T09:00:00Z");
      const lastSuccess = new Date("2026-11-01T22:00:00Z");
      const row = await prisma.sourceState.create({
        data: {
          gpId,
          event: "race",
          source: "pulselive",
          consecutiveFailures: threshold,
          lastError: "HTTP 503 (test)",
          lastAttemptAt: lastAttempt,
          lastSuccessAt: lastSuccess,
        },
      });

      const { admin } = await callerAs(true);
      const status = await admin.jobsStatus();

      const alert = status.activeAlerts.find((a) => a.gpId === gpId);
      expect(alert).toMatchObject({
        event: "race",
        source: "pulselive",
        consecutiveFailures: threshold,
        lastError: "HTTP 503 (test)",
        lastAttemptAt: lastAttempt.toISOString(),
        lastSuccessAt: lastSuccess.toISOString(),
      });

      // Limpiamos la fila (nuestra) para no contaminar otros tests.
      await prisma.sourceState.delete({
        where: {
          gpId_event_source: {
            gpId: row.gpId,
            event: row.event,
            source: row.source,
          },
        },
      });
    });

    it.skipIf(skipNoRedis)(
      "probe: el estado que escribe el worker (Redis) se lee en el panel",
      async () => {
        const at = new Date("2026-11-02T10:00:00Z");
        await redisProbeStateStore.recordAttempt({
          ok: false,
          error: "timeout (test)",
          latencyMs: null,
          at,
        });

        const { admin } = await callerAs(true);
        const status = await admin.jobsStatus();

        expect(status.probe).toMatchObject({
          consecutiveFailures: expect.any(Number),
          lastError: "timeout (test)",
          lastAttemptAt: at.toISOString(),
        });
      },
      20_000,
    );
  });

  describe("admin.sourceHealth (probe inyectado, sin red)", () => {
    const fakeOk = () =>
      createAdminRouter({
        probeSourceImpl: async () => ({
          ok: true,
          latencyMs: 120,
          error: null,
          probedAt: new Date("2026-11-02T10:00:00Z"),
        }),
      });
    const fakeFail = () =>
      createAdminRouter({
        probeSourceImpl: async () => ({
          ok: false,
          latencyMs: null,
          error: "PulseLive no es alcanzable: fetch failed",
          probedAt: new Date("2026-11-02T10:00:00Z"),
        }),
      });

    it("fuente ok: ok + latencia, sin error", async () => {
      const { ctx } = await callerAs(true);
      const out = await fakeOk().createCaller(ctx).sourceHealth();
      expect(out).toMatchObject({ ok: true, latencyMs: 120, error: null });
    });

    it("fuente caída: ok=false + motivo del fallo", async () => {
      const { ctx } = await callerAs(true);
      const out = await fakeFail().createCaller(ctx).sourceHealth();
      expect(out.ok).toBe(false);
      expect(out.error).toContain("fetch failed");
    });

    it("probe por defecto: la implementación real con el fetch global", async () => {
      // `adminRouter` se creó SIN `probeSourceImpl`: la mutación usa la
      // implementación por defecto (`probeSource`) con el fetch global —
      // el camino que recorre la app en producción. Solo se simula fetch.
      const urls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          urls.push(url);
          return new Response(JSON.stringify([{ id: "s2026" }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      );
      try {
        const { ctx } = await callerAs(true);
        const out = await adminRouter.createCaller(ctx).sourceHealth();
        expect(out).toMatchObject({ ok: true, error: null });
        expect(out.latencyMs).toBeTypeOf("number");
        // Sondeó el endpoint ligero del adapter (no otro).
        expect(urls[0]).toContain("/results/seasons");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
