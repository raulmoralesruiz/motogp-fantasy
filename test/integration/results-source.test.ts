/**
 * US-17 · Importación automática de resultados desde la fuente (PulseLive)
 * (PostgreSQL real).
 *
 * Mismo patrón que `results.test.ts`: los módulos de la app leen el entorno
 * al importarse (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan antes de los `import()` dinámicos. El router `results`
 * es inyectable: se monta con la BD efímera y una **fuente fake**
 * (`ResultsSource & SourceEventCatalog`) que replica la cadena de producción
 * (GP → vínculo → fetch) sin red.
 *
 * Semánticas cubiertas (ADR-0019):
 * - RBAC: los 8 procedimientos nuevos son solo de admin (403/401).
 * - `linkSource`: match único por nombre normalizado contra el catálogo de la
 *   temporada; 0 o varios matches → `BAD_REQUEST` (eventRef explícito
 *   obligatorio); eventRef explícito omite el catálogo. Auditoría
 *   `results.link_source` / `results.unlink_source`.
 * - Mapeos de pilotos (`rider_mappings`): CRUD con auditoría; el auto-import
 *   mapea `riderRef → riderId` por fuente; las entradas sin mapeo se saltan y
 *   se reportan (`unmapped`).
 * - `importFromSource`: fetch fuera de la transacción; filas nuevas
 *   `source = auto` (`sourceName` = nombre:versión, `raw.sourcePayload` con el
 *   payload original); re-import idempotente (no-op, sin auditoría); el auto
 *   solo corrige filas propias (`source: auto`) — las manuales se conservan
 *   (manual gana a auto); las correcciones quedan en `results_history`
 *   (motivo auto, `userId` null) y en auditoría con `actorId = null`.
 * - `source_state`: en éxito `consecutiveFailures = 0` + `lastUnmapped`;
 *   `recordSourceFailure` incrementa y trunca `lastError` a 500; el éxito no
 *   limpia `lastError`.
 * - Rechazos: GP sin vínculo (`SourceNotLinkedError`) y GP inexistente
 *   (`PulseLiveSourceError`): el servicio propaga la clase de la fuente y tRPC
 *   la envuelve en `TRPCError INTERNAL_SERVER_ERROR` (mensaje y `cause`
 *   conservados); GP/evento cancelados (`PRECONDITION_FAILED`), GP sin evento
 *   (`NOT_FOUND`).
 * - Router sin fuente/catálogo: rechazo explícito.
 * - Cobertura complementaria del servicio: anti-duplicado (dos riderRefs al
 *   mismo piloto → una sola fila, gana la primera entrada); GP inexistente
 *   detectado dentro de la transacción (fuente «mentirosa» → `NOT_FOUND`);
 *   validación semántica por entrada (bono inválido en el evento →
 *   `BAD_REQUEST` atómico, sin escrituras); `sourceState` con `lastUnmapped`
 *   parseado defensivo (lista válida; no-array → null) y `name` null cuando
 *   el payload crudo no tiene `rider`.
 */

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { PROVISIONAL_SEASON_RULES } from "../../app/shared/config/season-rules";
import type {
  ResultBonusCode,
  ResultPenaltyCode,
  ResultEventKind,
} from "../../app/shared/types";
import {
  CapturingEmailSender,
  createPrisma,
  integrationDbUrl,
  seedWorld,
  type World,
} from "./helpers";
import type {
  NormalizedEventResults,
  NormalizedResultEntry,
  ResultsSource,
  SourceEventCatalog,
} from "../../app/modules/results";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createResultsRouter } = await import("../../app/server/routers/results");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");
const {
  PulseLiveSourceError,
  ResultsService,
  SourceNotLinkedError,
} = await import("../../app/modules/results");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.42";
const USER_IP = "198.51.100.43";

// ── Fuente fake (sin red) ────────────────────────────────────────────────────

/** Fuente fake (`ResultsSource & SourceEventCatalog`) + controles de test. */
interface FakeSource {
  fake: ResultsSource & SourceEventCatalog;
  setResults(gpId: string, event: ResultEventKind, value: NormalizedEventResults): void;
  setFailure(gpId: string, event: ResultEventKind, message: string | null): void;
  setCatalog(seasonYear: number, events: Array<{ eventRef: string; name: string }>): void;
}

/**
 * Construye la fuente fake. `fetchEventResults` replica la cadena de
 * producción (resolveGp): GP existe → `Gp.sourceRef` fijada → fetch.
 */
function makeFakeSource(prisma: ReturnType<typeof createPrisma>): FakeSource {
  const results = new Map<string, NormalizedEventResults>();
  const failures = new Map<string, string>();
  const catalogs = new Map<number, Array<{ eventRef: string; name: string }>>();
  const key = (gpId: string, event: string) => `${gpId}:${event}`;

  const fake: ResultsSource & SourceEventCatalog = {
    meta: { name: "pulselive", version: "v1", authorized: false },
    async fetchEventResults(gpId, event) {
      const gp = await prisma.gp.findUnique({
        where: { id: gpId },
        select: { name: true, sourceRef: true },
      });
      if (!gp) {
        throw new PulseLiveSourceError("El GP no existe.");
      }
      if (gp.sourceRef === null) {
        throw new SourceNotLinkedError(
          `El GP «${gp.name}» no está vinculado a un evento de la fuente; vincúlalo con results.linkSource (ADR-0019).`,
        );
      }
      const failure = failures.get(key(gpId, event));
      if (failure !== undefined) {
        throw new PulseLiveSourceError(failure);
      }
      const value = results.get(key(gpId, event));
      if (!value) {
        throw new PulseLiveSourceError("No hay resultados para ese evento.");
      }
      return value;
    },
    async fetchGpStatus() {
      return "provisional";
    },
    async listSeasonEvents(seasonYear) {
      return catalogs.get(seasonYear) ?? [];
    },
  };

  return {
    fake,
    setResults(gpId, event, value) {
      results.set(key(gpId, event), value);
    },
    setFailure(gpId, event, message) {
      if (message === null) failures.delete(key(gpId, event));
      else failures.set(key(gpId, event), message);
    },
    setCatalog(seasonYear, events) {
      catalogs.set(seasonYear, events);
    },
  };
}

// ── Entradas ─────────────────────────────────────────────────────────────────

/** Entrada normalizada de la fuente (payload original en `raw`, como el adapter). */
function sourceEntry(
  riderRef: string,
  values: {
    position?: number | null;
    started?: boolean;
    finished?: boolean;
    penalties?: ResultPenaltyCode[];
    bonuses?: ResultBonusCode[];
    rawPoints?: number | null;
    fullName?: string;
  } = {},
): NormalizedResultEntry {
  return {
    riderRef,
    position: values.position ?? null,
    started: values.started ?? true,
    finished: values.finished ?? false,
    penalties: values.penalties ?? [],
    bonuses: values.bonuses ?? [],
    rawPoints: values.rawPoints ?? null,
    raw: {
      rider: {
        riders_id: riderRef,
        full_name: values.fullName ?? `Piloto fuente ${riderRef}`,
      },
      position: values.position ?? null,
    },
  };
}

/** Resultados de un evento de la fuente (provisional, timestamp fijo del test). */
function sourceResults(
  event: ResultEventKind,
  entries: NormalizedResultEntry[],
): NormalizedEventResults {
  return {
    event,
    status: "provisional",
    entries,
    fetchedAt: new Date("2099-06-01T18:00:00Z"),
    sourceVersion: "v1",
  };
}

/** Entrada manual para `importEvent` (DNF por defecto, como en results.test.ts). */
function manualEntry(
  riderId: string,
  values: {
    position?: number | null;
    started?: boolean;
    finished?: boolean;
    penalties?: ResultPenaltyCode[];
    bonuses?: ResultBonusCode[];
    rawPoints?: number | null;
  } = {},
) {
  return {
    riderId,
    position: values.position ?? null,
    started: values.started ?? true,
    finished: values.finished ?? false,
    penalties: values.penalties ?? [],
    bonuses: values.bonuses ?? [],
    rawPoints: values.rawPoints ?? null,
  };
}

describe("US-17 · Importación automática de resultados desde la fuente (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;
  let fixture: FakeSource;
  let world: World;
  let adminId: string;
  let adminToken: string;
  let userToken: string;

  // Pilotos del mundo.
  let r1: string;
  let r2: string;
  let r3: string;
  let r4: string;
  let r5: string;

  // Eventos del GP del mundo (seedWorld crea solo la race, orderNum 1).
  let q2: string;
  let sprint: string;

  // GPs extra de la misma temporada (mismos fines de semana ficticios).
  let gpDobleId: string;
  let gpSinMatchId: string;
  let gpCanceladoId: string;
  let gpEventoCanceladoId: string;
  let gpSinSprintId: string;

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
      bootstrapAdminEmail: ADMIN_EMAIL,
    });
    fixture = makeFakeSource(prisma);
    resultsRouter = createResultsRouter({ prisma, source: fixture.fake });
    world = await seedWorld(prisma);
    r1 = world.riders[0].id;
    r2 = world.riders[1].id;
    r3 = world.riders[2].id;
    r4 = world.riders[3].id;
    r5 = world.riders[4].id;

    // Resto del fin de semana del GP del mundo: a lo sumo 1 evento por tipo
    // (el auto-import localiza el evento con `findFirst({ gpId, type })`).
    q2 = (await prisma.weekendEvent.create({
      data: { gpId: world.gp.id, type: "q2", orderNum: 2 },
    })).id;
    sprint = (await prisma.weekendEvent.create({
      data: { gpId: world.gp.id, type: "sprint", orderNum: 3 },
    })).id;

    // GPs extra (misma temporada y circuito). `sourceRef` se fija en el
    // create: el fetch va fuera de la transacción y el fake la comprueba
    // antes que el servicio.
    gpDobleId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 2,
          name: "GP Doble",
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-08T12:00:00Z"),
        },
      })
    ).id;
    gpSinMatchId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 3,
          name: "GP Sin Match",
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-15T12:00:00Z"),
        },
      })
    ).id;
    gpCanceladoId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 4,
          name: "GP Cancelado",
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-22T12:00:00Z"),
          status: "cancelled",
          sourceRef: "ev-cancelado",
        },
      })
    ).id;
    await prisma.weekendEvent.create({
      data: { gpId: gpCanceladoId, type: "race", orderNum: 1 },
    });
    gpEventoCanceladoId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 5,
          name: "GP Evento Cancelado",
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-29T12:00:00Z"),
          sourceRef: "ev-evento-cancelado",
        },
      })
    ).id;
    await prisma.weekendEvent.create({
      data: { gpId: gpEventoCanceladoId, type: "q2", orderNum: 1, status: "cancelled" },
    });
    gpSinSprintId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 6,
          name: "GP Sin Sprint",
          circuitId: world.gp.circuitId,
          date: new Date("2099-07-06T12:00:00Z"),
          sourceRef: "ev-sin-sprint",
        },
      })
    ).id;
    await prisma.weekendEvent.create({
      data: { gpId: gpSinSprintId, type: "race", orderNum: 1 },
    });

    // Catálogo de eventos de la fuente para la temporada 2099 (el del mundo).
    // «GP Doble» y «GP Doble!» normalizan igual → match múltiple.
    fixture.setCatalog(2099, [
      { eventRef: "ev-gp-a", name: world.gp.name },
      { eventRef: "ev-doble-1", name: "GP Doble" },
      { eventRef: "ev-doble-2", name: "GP Doble!" },
      { eventRef: "ev-otro", name: "GP Otro" },
    ]);

    // Resultados en el fake para los GPs de los tests de rechazo: el fetch
    // ocurre fuera de la transacción y debe superar el vínculo antes de que
    // el servicio rechace dentro de la tx.
    fixture.setResults(
      gpCanceladoId,
      "race",
      sourceResults("race", [sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 })]),
    );
    fixture.setResults(
      gpEventoCanceladoId,
      "q2",
      sourceResults("q2", [sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 })]),
    );
    fixture.setResults(
      gpSinSprintId,
      "sprint",
      sourceResults("sprint", [sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 })]),
    );

    // Mapeos fuente → piloto del mercado (3 de los 4 pilotos del payload Q2).
    await prisma.riderMapping.createMany({
      data: [
        { source: "pulselive", riderRef: "rid-1", riderId: r1 },
        { source: "pulselive", riderRef: "rid-2", riderId: r2 },
        { source: "pulselive", riderRef: "rid-3", riderId: r3 },
      ],
    });

    // Admin global (bootstrap, ADR-0010) + usuario normal.
    const authCaller = await callerFor(ADMIN_IP);
    const adminReg = await authCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    adminId = adminReg.user.id;
    adminToken = sessionTokenFrom(authCaller.ctx);

    const userCaller = await callerFor(USER_IP);
    await userCaller.auth.register({
      email: email("maria"),
      username: username("maria"),
      password: PASSWORD,
      termsAccepted: true,
    });
    userToken = sessionTokenFrom(userCaller.ctx);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * Contexto tRPC para una petición simulada (IP + cookie de sesión opcional).
   * `resultsRouterOverride` monta el caller sobre un router distinto (test del
   * router sin fuente).
   */
  async function callerFor(
    ip: string,
    sessionToken?: string,
    resultsRouterOverride?: ReturnType<typeof createResultsRouter>,
  ) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/results", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    const results = (resultsRouterOverride ?? resultsRouter).createCaller(ctx);
    return { ctx, auth: authRouter.createCaller(ctx), results };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("un usuario normal no puede gestionar vínculos, mapeos ni auto-import (403 FORBIDDEN)", async () => {
    const { results } = await callerFor(USER_IP, userToken);
    await expect(
      results.importFromSource({ gpId: world.gp.id, event: "q2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(results.linkSource({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(results.unlinkSource({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      results.setRiderMapping({ riderRef: "rid-x", riderId: r1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      results.deleteRiderMapping({ riderRef: "rid-x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(results.riderMappings()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      results.sourceState({ gpId: world.gp.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      results.sourceEvents({ gpId: world.gp.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un usuario no autenticado no puede hacer auto-import (401)", async () => {
    const { results } = await callerFor(USER_IP); // sin cookie de sesión
    await expect(
      results.importFromSource({ gpId: world.gp.id, event: "q2" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // ── linkSource / unlinkSource ──────────────────────────────────────────────

  it("linkSource vincula por match único de nombre (catálogo de la temporada) y audita", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const linked = await results.linkSource({ gpId: world.gp.id });
    expect(linked).toEqual({ gpId: world.gp.id, sourceRef: "ev-gp-a" });
    const gp = await prisma.gp.findUnique({ where: { id: world.gp.id } });
    expect(gp?.sourceRef).toBe("ev-gp-a");
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.link_source", entityId: world.gp.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "gp",
      ip: ADMIN_IP,
      beforeData: { sourceRef: null },
      afterData: { sourceRef: "ev-gp-a" },
    });
  });

  it("linkSource con varios matches devuelve BAD_REQUEST y pide eventRef explícito", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.linkSource({ gpId: gpDobleId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Varios eventos de la fuente coinciden con el GP «GP Doble»: GP Doble | GP Doble!. Indica eventRef explícitamente.",
    });
    const gp = await prisma.gp.findUnique({ where: { id: gpDobleId } });
    expect(gp?.sourceRef).toBeNull();
  });

  it("linkSource sin ningún match devuelve BAD_REQUEST y pide eventRef explícito", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.linkSource({ gpId: gpSinMatchId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "No hay ningún evento de la fuente que coincida con el GP «GP Sin Match» de la temporada 2099. Indica eventRef explícitamente.",
    });
  });

  it("linkSource con eventRef explícito omite el catálogo y audita", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const linked = await results.linkSource({
      gpId: gpSinMatchId,
      eventRef: "ev-explicito",
    });
    expect(linked).toEqual({ gpId: gpSinMatchId, sourceRef: "ev-explicito" });
    const gp = await prisma.gp.findUnique({ where: { id: gpSinMatchId } });
    expect(gp?.sourceRef).toBe("ev-explicito");
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.link_source", entityId: gpSinMatchId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "gp",
      beforeData: { sourceRef: null },
      afterData: { sourceRef: "ev-explicito" },
    });
  });

  it("linkSource devuelve NOT_FOUND si el GP no existe", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.linkSource({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("linkSource rechaza un eventRef vacío (Zod, BAD_REQUEST)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.linkSource({ gpId: world.gp.id, eventRef: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("unlinkSource desvincula y audita el antes/después", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const unlinked = await results.unlinkSource({ gpId: world.gp.id });
    expect(unlinked).toEqual({ gpId: world.gp.id, sourceRef: null });
    const gp = await prisma.gp.findUnique({ where: { id: world.gp.id } });
    expect(gp?.sourceRef).toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.unlink_source", entityId: world.gp.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "gp",
      ip: ADMIN_IP,
      beforeData: { sourceRef: "ev-gp-a" },
      afterData: { sourceRef: null },
    });
  });

  it("unlinkSource devuelve NOT_FOUND si el GP no existe", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.unlinkSource({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("re-link del GP del mundo (eventRef explícito) para los tests de auto-import", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const linked = await results.linkSource({ gpId: world.gp.id, eventRef: "ev-gp-a" });
    expect(linked).toEqual({ gpId: world.gp.id, sourceRef: "ev-gp-a" });
  });

  // ── Mapeos de pilotos (rider_mappings) ─────────────────────────────────────

  it("setRiderMapping crea el mapeo, lo audita y devuelve la vista", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const view = await results.setRiderMapping({ riderRef: "rid-crud-1", riderId: r4 });
    expect(view).toEqual({
      source: "pulselive",
      riderRef: "rid-crud-1",
      riderId: r4,
      riderName: world.riders[3].name,
    });
    const row = await prisma.riderMapping.findUnique({
      where: { source_riderRef: { source: "pulselive", riderRef: "rid-crud-1" } },
    });
    expect(row?.riderId).toBe(r4);
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.rider_mapping.set", entityId: "pulselive:rid-crud-1" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "rider_mapping",
      ip: ADMIN_IP,
      beforeData: null,
      afterData: {
        riderRef: "rid-crud-1",
        riderId: r4,
        riderName: world.riders[3].name,
      },
    });
  });

  it("setRiderMapping devuelve NOT_FOUND si el piloto del mercado no existe", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.setRiderMapping({ riderRef: "rid-crud-1", riderId: randomUUID() }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El piloto del mercado no existe.",
    });
  });

  it("setRiderMapping re-mapea y audita el antes (riderId previo)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const view = await results.setRiderMapping({ riderRef: "rid-crud-1", riderId: r5 });
    expect(view).toMatchObject({ riderId: r5, riderName: world.riders[4].name });
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.rider_mapping.set", entityId: "pulselive:rid-crud-1" },
    });
    expect(audit).toHaveLength(2);
    const remap = audit.find((a) => a.beforeData !== null);
    expect(remap).toMatchObject({
      beforeData: { riderId: r4 },
      afterData: {
        riderRef: "rid-crud-1",
        riderId: r5,
        riderName: world.riders[4].name,
      },
    });
  });

  it("deleteRiderMapping elimina el mapeo y audita", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await results.deleteRiderMapping({ riderRef: "rid-crud-1" });
    const row = await prisma.riderMapping.findUnique({
      where: { source_riderRef: { source: "pulselive", riderRef: "rid-crud-1" } },
    });
    expect(row).toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.rider_mapping.delete", entityId: "pulselive:rid-crud-1" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "rider_mapping",
      ip: ADMIN_IP,
      beforeData: { riderRef: "rid-crud-1", riderId: r5 },
      afterData: null,
    });
  });

  it("deleteRiderMapping repetido devuelve NOT_FOUND", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.deleteRiderMapping({ riderRef: "rid-crud-1" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No existe el mapeo para ese piloto de la fuente.",
    });
  });

  it("los mapeos validan riderRef/riderId (Zod, BAD_REQUEST)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.setRiderMapping({ riderRef: "", riderId: r1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      results.setRiderMapping({ riderRef: "rid-x", riderId: "no-uuid" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      results.deleteRiderMapping({ riderRef: "" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("riderMappings lista los mapeos de la fuente con el nombre del piloto", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const views = await results.riderMappings();
    expect(views).toEqual([
      {
        source: "pulselive",
        riderRef: "rid-1",
        riderId: r1,
        riderName: world.riders[0].name,
      },
      {
        source: "pulselive",
        riderRef: "rid-2",
        riderId: r2,
        riderName: world.riders[1].name,
      },
      {
        source: "pulselive",
        riderRef: "rid-3",
        riderId: r3,
        riderName: world.riders[2].name,
      },
    ]);
  });

  // ── sourceEvents ───────────────────────────────────────────────────────────

  it("sourceEvents devuelve el catálogo de eventos de la temporada del GP", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const events = await results.sourceEvents({ gpId: world.gp.id });
    expect(events).toEqual([
      { eventRef: "ev-gp-a", name: world.gp.name },
      { eventRef: "ev-doble-1", name: "GP Doble" },
      { eventRef: "ev-doble-2", name: "GP Doble!" },
      { eventRef: "ev-otro", name: "GP Otro" },
    ]);
  });

  it("sourceEvents devuelve NOT_FOUND si el GP no existe", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.sourceEvents({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  // ── Auto-import ────────────────────────────────────────────────────────────

  it("importFromSource sin vínculo lanza SourceNotLinkedError (el fetch va antes de la tx)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    // El servicio propaga la SourceNotLinkedError de la fuente (fetch antes de
    // la tx); tRPC la envuelve en TRPCError INTERNAL_SERVER_ERROR conservando
    // el mensaje y la `cause` (la clase de la fuente no cruza el límite tRPC).
    await expect(
      results.importFromSource({ gpId: gpDobleId, event: "q2" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "El GP «GP Doble» no está vinculado a un evento de la fuente; vincúlalo con results.linkSource (ADR-0019).",
    });
  });

  it("auto-importa Q2: filas auto + efectos + auditoría sin actor + source_state", async () => {
    fixture.setResults(
      world.gp.id,
      "q2",
      sourceResults("q2", [
        sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 }),
        sourceEntry("rid-2", { position: 2, finished: true, rawPoints: 20 }),
        sourceEntry("rid-3", { rawPoints: 0 }), // DNF: salió y no terminó
        sourceEntry("rid-9", {
          position: 3,
          finished: true,
          rawPoints: 16,
          fullName: "Sin Mapear",
        }),
      ]),
    );
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importFromSource({ gpId: world.gp.id, event: "q2" });
    expect(summary).toEqual({
      created: 3,
      corrected: 0,
      unchanged: 0,
      kept: 0,
      unmapped: [{ riderRef: "rid-9", name: "Sin Mapear" }],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });

    // Filas: source auto, sourceName nombre:versión, payload original en raw.
    const rowR1 = await prisma.result.findUnique({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r1 } },
    });
    expect(rowR1).toMatchObject({
      status: "provisional",
      source: "auto",
      sourceName: "pulselive:v1",
      position: 1,
    });
    expect(rowR1?.rawPoints?.toNumber()).toBe(25);
    expect(rowR1?.raw).toEqual({
      position: 1,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 25,
      sourcePayload: {
        rider: { riders_id: "rid-1", full_name: "Piloto fuente rid-1" },
        position: 1,
      },
    });

    const rowR3 = await prisma.result.findUnique({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r3 } },
    });
    expect(rowR3).toMatchObject({
      position: null,
      source: "auto",
    });
    expect(rowR3?.rawPoints?.toNumber()).toBe(0);
    // DNF: `started`/`finished` viven en `raw` (no son columnas).
    expect(rowR3?.raw).toMatchObject({ started: true, finished: false });

    // Efectos: results_event y weekend_event pasan a finished.
    const resultsEvent = await prisma.resultsEvent.findUnique({
      where: { gpId_eventId: { gpId: world.gp.id, eventId: q2 } },
    });
    expect(resultsEvent?.status).toBe("finished");
    const weekendEvent = await prisma.weekendEvent.findUnique({ where: { id: q2 } });
    expect(weekendEvent?.status).toBe("finished");

    // Auditoría: results.import sin actor (los valores vienen de la fuente).
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.import", entityId: q2 },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, entity: "results", ip: null });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      eventId: q2,
      entries: [
        {
          riderId: r1,
          position: 1,
          started: true,
          finished: true,
          penalties: [],
          bonuses: [],
          rawPoints: 25,
        },
        {
          riderId: r2,
          position: 2,
          started: true,
          finished: true,
          penalties: [],
          bonuses: [],
          rawPoints: 20,
        },
        {
          riderId: r3,
          position: null,
          started: true,
          finished: false,
          penalties: [],
          bonuses: [],
          rawPoints: 0,
        },
      ],
      source: "pulselive:v1",
    });

    // source_state: éxito (0 fallos, lastUnmapped con el piloto sin mapeo).
    const state = await prisma.sourceState.findUnique({
      where: {
        gpId_event_source: { gpId: world.gp.id, event: "q2", source: "pulselive" },
      },
    });
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.lastAttemptAt).toBeInstanceOf(Date);
    expect(state?.lastSuccessAt).toBeInstanceOf(Date);
    expect(state?.lastError).toBeNull();
    expect(state?.lastUnmapped).toEqual([{ riderRef: "rid-9", name: "Sin Mapear" }]);
  });

  it("re-import idempotente: no-op (sin auditoría ni history)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importFromSource({ gpId: world.gp.id, event: "q2" });
    expect(summary).toEqual({
      created: 0,
      corrected: 0,
      unchanged: 3,
      kept: 0,
      unmapped: [{ riderRef: "rid-9", name: "Sin Mapear" }],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.import", entityId: q2 },
    });
    expect(audit).toHaveLength(1); // la misma del primer import
    // La BD es compartida entre suites (global setup, archivos en paralelo):
    // el "no-op" se verifica sobre las filas de ESTE GP, no como conteo global.
    const gpResultIds = (
      await prisma.result.findMany({
        where: { gpId: world.gp.id },
        select: { id: true },
      })
    ).map((r) => r.id);
    const historyCount = await prisma.resultsHistory.count({
      where: { resultId: { in: gpResultIds } },
    });
    expect(historyCount).toBe(0);
    // source_state: sigue en éxito; lastUnmapped se reescribe en cada import.
    const state = await prisma.sourceState.findUnique({
      where: {
        gpId_event_source: { gpId: world.gp.id, event: "q2", source: "pulselive" },
      },
    });
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.lastUnmapped).toEqual([{ riderRef: "rid-9", name: "Sin Mapear" }]);
  });

  // ── Manual gana a auto (ADR-0019) ──────────────────────────────────────────

  it("corrección manual sobre fila auto: history + auditoría; el auto no la toca", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: q2,
      entries: [manualEntry(r3, { position: 5, finished: true, rawPoints: 10 })],
      reason: "corrección manual de prueba",
    });
    expect(summary).toEqual({ created: 0, corrected: 1, unchanged: 0, kept: 2, recalculated: false, resultsVersion: null, lineupsScored: 0 });

    // La fila pasa a manual (raw sin sourcePayload: no hay payload fuente).
    const rowR3 = await prisma.result.findUnique({
      where: {
        gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r3 },
      },
    });
    expect(rowR3).toMatchObject({
      status: "provisional",
      source: "manual",
      sourceName: "manual",
      position: 5,
    });
    expect(rowR3?.rawPoints?.toNumber()).toBe(10);
    expect(rowR3?.raw).toEqual({
      position: 5,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 10,
    });

    // Histórico: antes→después, motivo del admin, actor, sin versión de reglas.
    const history = await prisma.resultsHistory.findMany({
      where: { resultId: rowR3!.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "corrección manual de prueba",
      userId: adminId,
      resultsVersion: null,
    });
    expect(history[0]?.beforeData).toEqual({
      position: null,
      started: true,
      finished: false,
      penalties: [],
      bonuses: [],
      rawPoints: 0,
    });
    expect(history[0]?.afterData).toEqual({
      position: 5,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 10,
    });

    // Auditoría del admin: corrections + entries + motivo.
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.correct", entityId: q2 },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "results",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.beforeData).toEqual({
      gpId: world.gp.id,
      eventId: q2,
      corrections: [
        {
          riderId: r3,
          before: {
            position: null,
            started: true,
            finished: false,
            penalties: [],
            bonuses: [],
            rawPoints: 0,
          },
        },
      ],
    });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      eventId: q2,
      corrections: [
        {
          riderId: r3,
          after: {
            position: 5,
            started: true,
            finished: true,
            penalties: [],
            bonuses: [],
            rawPoints: 10,
          },
        },
      ],
      entries: [
        {
          riderId: r3,
          position: 5,
          started: true,
          finished: true,
          penalties: [],
          bonuses: [],
          rawPoints: 10,
        },
      ],
      reason: "corrección manual de prueba",
    });

    // Re-import auto: la fila manual se conserva (kept) y no se corrige.
    const reImport = await results.importFromSource({ gpId: world.gp.id, event: "q2" });
    expect(reImport).toEqual({
      created: 0,
      corrected: 0,
      unchanged: 2,
      kept: 1,
      unmapped: [{ riderRef: "rid-9", name: "Sin Mapear" }],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });
    const rowR3After = await prisma.result.findUnique({
      where: {
        gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r3 },
      },
    });
    expect(rowR3After).toMatchObject({ source: "manual", position: 5 });
    expect(rowR3After?.rawPoints?.toNumber()).toBe(10);
    // Sin escrituras nuevas: el import auto y la corrección manual siguen únicos.
    expect(
      await prisma.auditLog.count({ where: { action: "results.import", entityId: q2 } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "results.correct", entityId: q2 } }),
    ).toBe(1);
  });

  it("auto-corrección: solo corrige filas auto (history auto, auditoría sin actor)", async () => {
    fixture.setResults(
      world.gp.id,
      "q2",
      sourceResults("q2", [
        sourceEntry("rid-1", { position: 2, finished: true, rawPoints: 25 }), // 1 → 2
        sourceEntry("rid-2", { position: 2, finished: true, rawPoints: 20 }),
        sourceEntry("rid-3", { rawPoints: 0 }), // DNF: la fila manual se conserva
        sourceEntry("rid-9", {
          position: 3,
          finished: true,
          rawPoints: 16,
          fullName: "Sin Mapear",
        }),
      ]),
    );
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importFromSource({ gpId: world.gp.id, event: "q2" });
    expect(summary).toEqual({
      created: 0,
      corrected: 1,
      unchanged: 1,
      kept: 1,
      unmapped: [{ riderRef: "rid-9", name: "Sin Mapear" }],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });

    // La fila r1 sigue siendo auto, con el nuevo valor y el payload fuente.
    const rowR1 = await prisma.result.findUnique({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r1 } },
    });
    expect(rowR1).toMatchObject({ source: "auto", sourceName: "pulselive:v1", position: 2 });
    expect(rowR1?.rawPoints?.toNumber()).toBe(25);
    expect(rowR1?.raw).toEqual({
      position: 2,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 25,
      sourcePayload: {
        rider: { riders_id: "rid-1", full_name: "Piloto fuente rid-1" },
        position: 2,
      },
    });

    // Histórico: motivo del auto-import, sin actor, sin versión de reglas.
    const history = await prisma.resultsHistory.findMany({
      where: { resultId: rowR1!.id },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "Importación automática desde la fuente (ADR-0019).",
      userId: null,
      resultsVersion: null,
    });
    expect(history[0]?.beforeData).toEqual({
      position: 1,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 25,
    });
    expect(history[0]?.afterData).toEqual({
      position: 2,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 25,
    });

    // Auditoría del auto (actorId null, sin ip): corrections + source, sin entries.
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.correct", entityId: q2, actorId: null },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, entity: "results", ip: null });
    expect(audit[0]?.beforeData).toEqual({
      gpId: world.gp.id,
      eventId: q2,
      corrections: [
        {
          riderId: r1,
          before: {
            position: 1,
            started: true,
            finished: true,
            penalties: [],
            bonuses: [],
            rawPoints: 25,
          },
        },
      ],
    });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      eventId: q2,
      corrections: [
        {
          riderId: r1,
          after: {
            position: 2,
            started: true,
            finished: true,
            penalties: [],
            bonuses: [],
            rawPoints: 25,
          },
        },
      ],
      source: "pulselive:v1",
    });
  });

  it("mapeo nuevo rid-9 → piloto: el siguiente auto-import crea la fila", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const mapping = await results.setRiderMapping({ riderRef: "rid-9", riderId: r4 });
    expect(mapping).toMatchObject({
      riderRef: "rid-9",
      riderId: r4,
      riderName: world.riders[3].name,
    });

    const summary = await results.importFromSource({ gpId: world.gp.id, event: "q2" });
    expect(summary).toEqual({
      created: 1,
      corrected: 0,
      unchanged: 2,
      kept: 1,
      unmapped: [],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });

    // Fila nueva auto con el payload fuente en `raw`.
    const rowR4 = await prisma.result.findUnique({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r4 } },
    });
    expect(rowR4).toMatchObject({
      status: "provisional",
      source: "auto",
      sourceName: "pulselive:v1",
      position: 3,
    });
    expect(rowR4?.rawPoints?.toNumber()).toBe(16);
    expect(rowR4?.raw).toEqual({
      position: 3,
      started: true,
      finished: true,
      penalties: [],
      bonuses: [],
      rawPoints: 16,
      sourcePayload: {
        rider: { riders_id: "rid-9", full_name: "Sin Mapear" },
        position: 3,
      },
    });

    // Éxito limpio: lastUnmapped se limpia (SQL NULL).
    const state = await prisma.sourceState.findUnique({
      where: {
        gpId_event_source: { gpId: world.gp.id, event: "q2", source: "pulselive" },
      },
    });
    expect(state?.lastUnmapped).toBeNull();
  });

  // ── source_state: fallos y recuperación ────────────────────────────────────

  it("fallos consecutivos se acumulan; el éxito los resetea (lastError persiste)", async () => {
    const service = new ResultsService({
      prisma,
      source: fixture.fake,
      eventCatalog: fixture.fake,
    });
    // >500 caracteres: `lastError` se trunca a 500.
    const msg = "fallo de red simulado ".repeat(30);
    expect(await service.recordSourceFailure(world.gp.id, "sprint", msg)).toBe(1);
    expect(await service.recordSourceFailure(world.gp.id, "sprint", msg)).toBe(2);

    let state = await prisma.sourceState.findUnique({
      where: {
        gpId_event_source: { gpId: world.gp.id, event: "sprint", source: "pulselive" },
      },
    });
    expect(state?.consecutiveFailures).toBe(2);
    expect(state?.lastError).toBe(msg.slice(0, 500));
    expect(state?.lastSuccessAt).toBeNull();
    expect(state?.lastAttemptAt).toBeInstanceOf(Date);

    // Recuperación: sin fallo en la fuente → import en verde.
    fixture.setFailure(world.gp.id, "sprint", null);
    fixture.setResults(
      world.gp.id,
      "sprint",
      sourceResults("sprint", [
        sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 }),
        sourceEntry("rid-2", { position: 2, finished: true, rawPoints: 20 }),
      ]),
    );
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importFromSource({ gpId: world.gp.id, event: "sprint" });
    expect(summary).toEqual({
      created: 2,
      corrected: 0,
      unchanged: 0,
      kept: 0,
      unmapped: [],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });
    // Auditoría del auto-import (entity = evento sprint).
    expect(
      await prisma.auditLog.count({
        where: { action: "results.import", entityId: sprint },
      }),
    ).toBe(1);

    state = await prisma.sourceState.findUnique({
      where: {
        gpId_event_source: { gpId: world.gp.id, event: "sprint", source: "pulselive" },
      },
    });
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.lastSuccessAt).toBeInstanceOf(Date);
    // `lastError` no se limpia en el éxito (se conserva para diagnóstico).
    expect(state?.lastError).toBe(msg.slice(0, 500));
  });

  // ── Rechazos ───────────────────────────────────────────────────────────────

  it("rechaza GP cancelado, evento cancelado, GP sin evento y GP inexistente", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importFromSource({ gpId: gpCanceladoId, event: "race" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El GP está cancelado: no se pueden importar resultados.",
    });
    await expect(
      results.importFromSource({ gpId: gpEventoCanceladoId, event: "q2" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El evento Q2 está cancelado: no se pueden importar resultados.",
    });
    await expect(
      results.importFromSource({ gpId: gpSinSprintId, event: "sprint" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no tiene evento sprint.",
    });
    // GP inexistente: el fetch de la fuente falla antes de la transacción
    // (PulseLiveSourceError envuelta en TRPCError INTERNAL_SERVER_ERROR).
    await expect(
      results.importFromSource({ gpId: randomUUID(), event: "race" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "El GP no existe.",
    });
  });

  it("sourceState de GP inexistente → NOT_FOUND", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.sourceState({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("importFromSource con evento inválido (Zod): solo el code es fiable", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importFromSource({ gpId: world.gp.id, event: "q1" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── Router sin fuente ──────────────────────────────────────────────────────

  it("router sin fuente: los procedimientos de US-17 fallan con mensajes claros", async () => {
    const routerSinFuente = createResultsRouter({ prisma });
    const { results } = await callerFor(ADMIN_IP, adminToken, routerSinFuente);
    await expect(
      results.importFromSource({ gpId: world.gp.id, event: "q2" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "No hay fuente de resultados configurada para el auto-import.",
    });
    await expect(results.linkSource({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "No hay catálogo de eventos de la fuente configurado: indica eventRef explícitamente.",
    });
    await expect(
      results.setRiderMapping({ riderRef: "rid-x", riderId: r1 }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "No hay fuente de resultados configurada para los mapeos de pilotos.",
    });
    await expect(
      results.deleteRiderMapping({ riderRef: "rid-x" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "No hay fuente de resultados configurada para los mapeos de pilotos.",
    });
    await expect(
      results.sourceEvents({ gpId: world.gp.id }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "No hay catálogo de eventos de la fuente configurado.",
    });
  });

  // ── Cobertura complementaria del servicio ─────────────────────────────────

  it("sourceState: lastUnmapped parseado (lista válida; no-array → null)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);

    // Lista válida con ramas defensivas: `name` null se conserva; riderRef
    // vacío, no-objeto y riderRef no-string se filtran.
    await prisma.sourceState.create({
      data: {
        gpId: gpDobleId,
        event: "q2",
        source: "pulselive",
        consecutiveFailures: 3,
        lastError: "fallo simulado",
        lastUnmapped: [
          { riderRef: "rid-77", name: "Piloto X" },
          { riderRef: "rid-78", name: null },
          { riderRef: "", name: "Ref vacía" },
          "no-objeto",
          { riderRef: 123, name: "Ref numérica" },
        ],
      },
    });
    // Columna Json con un no-array → `parseUnmapped` devuelve null.
    await prisma.sourceState.create({
      data: {
        gpId: gpSinMatchId,
        event: "race",
        source: "pulselive",
        lastUnmapped: "no-es-una-lista",
      },
    });

    const viewsDoble = await results.sourceState({ gpId: gpDobleId });
    expect(viewsDoble).toEqual([
      {
        event: "q2",
        source: "pulselive",
        consecutiveFailures: 3,
        lastError: "fallo simulado",
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastUnmapped: [
          { riderRef: "rid-77", name: "Piloto X" },
          { riderRef: "rid-78", name: null },
        ],
      },
    ]);

    const viewsSinMatch = await results.sourceState({ gpId: gpSinMatchId });
    expect(viewsSinMatch).toHaveLength(1);
    expect(viewsSinMatch[0]?.lastUnmapped).toBeNull();
  });

  it("dos riderRefs al mismo piloto: anti-duplicado (gana la primera entrada)", async () => {
    // GP nuevo (vinculado) con su propio evento q2: el fetch pasa antes de la
    // transacción, así que la fuente fake lo resuelve sin problema.
    const gpDupId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 7,
          name: "GP Duplicado",
          circuitId: world.gp.circuitId,
          date: new Date("2099-07-13T12:00:00Z"),
          sourceRef: "ev-duplicado",
        },
      })
    ).id;
    const q2Dup = (
      await prisma.weekendEvent.create({
        data: { gpId: gpDupId, type: "q2", orderNum: 1 },
      })
    ).id;

    const { results } = await callerFor(ADMIN_IP, adminToken);
    // rid-dup-1 → r1: dos refs de la fuente al MISMO piloto del mercado.
    await results.setRiderMapping({ riderRef: "rid-dup-1", riderId: r1 });
    fixture.setResults(
      gpDupId,
      "q2",
      sourceResults("q2", [
        sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 }),
        sourceEntry("rid-dup-1", { position: 2, finished: true, rawPoints: 20 }),
      ]),
    );

    const summary = await results.importFromSource({ gpId: gpDupId, event: "q2" });
    expect(summary).toEqual({
      created: 1,
      corrected: 0,
      unchanged: 0,
      kept: 0,
      unmapped: [],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });

    // Una sola fila por piloto; gana la PRIMERA entrada (posición 1), no la
    // segunda (posición 2).
    expect(
      await prisma.result.count({ where: { gpId: gpDupId, eventId: q2Dup } }),
    ).toBe(1);
    const rowR1 = await prisma.result.findUnique({
      where: {
        gpId_eventId_riderId: { gpId: gpDupId, eventId: q2Dup, riderId: r1 },
      },
    });
    expect(rowR1).toMatchObject({ source: "auto", position: 1 });
    expect(rowR1?.rawPoints?.toNumber()).toBe(25);

    // Limpieza: el mapeo extra no contamina la lista de mapeos de la suite.
    await results.deleteRiderMapping({ riderRef: "rid-dup-1" });
  });

  it("fuente «mentirosa» (resultados para GP inexistente): NOT_FOUND en la tx", async () => {
    // La fuente fake de la suite comprueba el GP ella misma (y fallaría antes
    // de la transacción); aquí una fuente que devuelve resultados sin
    // comprobar: el servicio no confía en el fetch y rechaza dentro de la
    // transacción (NOT_FOUND).
    const fuenteMentira: ResultsSource & SourceEventCatalog = {
      meta: { name: "pulselive", version: "v1", authorized: false },
      async fetchEventResults() {
        return sourceResults("race", [
          sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 }),
        ]);
      },
      async fetchGpStatus() {
        return "provisional";
      },
      async listSeasonEvents() {
        return [];
      },
    };
    const routerMentira = createResultsRouter({ prisma, source: fuenteMentira });
    const { results } = await callerFor(ADMIN_IP, adminToken, routerMentira);
    await expect(
      results.importFromSource({ gpId: randomUUID(), event: "race" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("bono inválido en el evento (fastest-lap en Q2): BAD_REQUEST atómico", async () => {
    fixture.setResults(
      world.gp.id,
      "q2",
      sourceResults("q2", [
        sourceEntry("rid-1", {
          position: 1,
          finished: true,
          rawPoints: 25,
          bonuses: ["fastest-lap"],
        }),
      ]),
    );
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importFromSource({ gpId: world.gp.id, event: "q2" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${r1}: El bono «fastest-lap» no es válido en Q2`,
    });

    // Atómico: la fila de r1 no se toca (sigue en la posición 2 de antes).
    const rowR1 = await prisma.result.findUnique({
      where: {
        gpId_eventId_riderId: { gpId: world.gp.id, eventId: q2, riderId: r1 },
      },
    });
    expect(rowR1).toMatchObject({ source: "auto", position: 2 });
  });

  it("sin mapear sin nombre en el payload crudo: unmapped con name null", async () => {
    // `raw` sin `rider`: `riderNameFromRaw` no puede extraer el nombre → null.
    fixture.setResults(
      world.gp.id,
      "q2",
      sourceResults("q2", [
        {
          riderRef: "rid-sin-nombre",
          position: null,
          started: true,
          finished: false,
          penalties: [],
          bonuses: [],
          rawPoints: null,
          raw: { position: null },
        },
      ]),
    );
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importFromSource({ gpId: world.gp.id, event: "q2" });
    expect(summary).toEqual({
      created: 0,
      corrected: 0,
      unchanged: 0,
      kept: 4, // r1..r4 en BD y no en el payload: se conservan (diffResults).
      unmapped: [{ riderRef: "rid-sin-nombre", name: null }],
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });

    // Persistido en `source_state` (lo muestra la UI de admin).
    const state = await prisma.sourceState.findUnique({
      where: {
        gpId_event_source: { gpId: world.gp.id, event: "q2", source: "pulselive" },
      },
    });
    expect(state?.lastUnmapped).toEqual([
      { riderRef: "rid-sin-nombre", name: null },
    ]);
  });

  // ── US-19: auto-import sobre GP con scores → recálculo (rv-2) ─────────────

  it("auto-corrección sobre GP definitivo: recalcula inline (rv-2, US-19)", async () => {
    // Reglas de la temporada (PROVISIONAL) — el recálculo las requiere.
    const existingRule = await prisma.seasonRule.findFirst({
      where: { seasonId: world.season.id },
    });
    if (!existingRule) {
      await prisma.seasonRule.create({
        data: {
          seasonId: world.season.id,
          version: "scoring-v1",
          rules: PROVISIONAL_SEASON_RULES as unknown as Parameters<
            PrismaClient["seasonRule"]["create"]
          >[0]["data"]["rules"],
        },
      });
    }

    // GP de US-19 (ronda 8) vinculado a la fuente, con lineup + afiliaciones.
    const gp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 8,
        name: `GP ${suffix} auto-recalc`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-09-15T12:00:00Z"),
        sourceRef: "ev-auto-recalc",
      },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 1 },
    });
    for (const rider of [r1, r2, r3, r4]) {
      await prisma.riderAffiliation.create({
        data: { riderId: rider, teamId: world.team.id, constructorId: world.ctor.id, gpId: gp.id },
      });
    }
    const lineup = await prisma.lineup.create({
      data: { userId: world.user.id, gpId: gp.id },
    });
    await prisma.lineupSlot.createMany({
      data: [
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r1 },
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r2 },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r3 },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r4 },
        { lineupId: lineup.id, slotType: "constructor", assetType: "constructor", assetId: world.ctor.id },
        { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: world.team.id },
      ],
    });

    const { results } = await callerFor(ADMIN_IP, adminToken);

    // 1. Auto-import inicial (filas auto, provisional).
    fixture.setResults(
      gp.id,
      "race",
      sourceResults("race", [
        sourceEntry("rid-1", { position: 1, finished: true, rawPoints: 25 }),
        sourceEntry("rid-2", { position: 2, finished: true, rawPoints: 20 }),
      ]),
    );
    const first = await results.importFromSource({ gpId: gp.id, event: "race" });
    expect(first).toMatchObject({ created: 2, corrected: 0, recalculated: false });

    // 2. Definitivo (rv-1) → scores.
    const definitive = await results.markDefinitive({ gpId: gp.id });
    expect(definitive).toMatchObject({ madeDefinitive: 2, resultsVersion: "rv-1", noop: false });
    expect(
      await prisma.score.count({ where: { gpId: gp.id, resultsVersion: "rv-1" } }),
    ).toBe(1);

    // 3. La fuente corrige (rid-1: 1º → 3º) y el auto-import recalcula (US-19).
    fixture.setResults(
      gp.id,
      "race",
      sourceResults("race", [
        sourceEntry("rid-1", { position: 3, finished: true, rawPoints: 16 }),
        sourceEntry("rid-2", { position: 2, finished: true, rawPoints: 20 }),
      ]),
    );
    const second = await results.importFromSource({ gpId: gp.id, event: "race" });
    expect(second).toMatchObject({
      created: 0,
      corrected: 1,
      recalculated: true,
      resultsVersion: "rv-2",
      lineupsScored: 1,
    });

    // La fila se reconfirma a definitive con rv-2.
    const rowR1 = await prisma.result.findUniqueOrThrow({
      where: { gpId_eventId_riderId: { gpId: gp.id, eventId: race.id, riderId: r1 } },
    });
    expect(rowR1).toMatchObject({ status: "definitive", resultsVersion: "rv-2", position: 3 });

    // Score rv-2 escrito; rv-1 permanece para histórico (invariante 7).
    expect(await prisma.score.count({ where: { gpId: gp.id, resultsVersion: "rv-2" } })).toBe(1);
    expect(await prisma.score.count({ where: { gpId: gp.id, resultsVersion: "rv-1" } })).toBe(1);

    // Auditoría del recálculo del auto (sin actor).
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.recalculated", entityId: gp.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: null, ip: null });
    expect(audit[0]?.afterData).toMatchObject({ gpId: gp.id, resultsVersion: "rv-2", lineupsScored: 1 });

    // Histórico de la corrección auto (motivo estándar, sin actor, rv-1 en vigor).
    const history = await prisma.resultsHistory.findMany({ where: { resultId: rowR1.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ userId: null, resultsVersion: "rv-1" });
    expect(history[0]?.beforeData).toMatchObject({ position: 1 });
    expect(history[0]?.afterData).toMatchObject({ position: 3 });
  });
});
