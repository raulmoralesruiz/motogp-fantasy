/**
 * T-12 · Revisión de seguridad (testing.md §2.7, security.md §1) — superficie
 * de ataque que no estaba cubierta por los tests de módulo:
 *
 * - **IDOR / acceso horizontal:** un usuario no lee ni modifica el lineup de
 *   otro (lineups); un extraño no ve ni gestiona una liga privada (NOT_FOUND,
 *   no revela la existencia — ADR-0024); un miembro no-admin no gestiona la
 *   liga (FORBIDDEN — US-26).
 * - **Inyección:** payloads XSS/SQLi en texto libre se guardan inertes y se
 *   devuelven como datos (ORM parametrizada — `security.md` §1.3: "SQL solo
 *   vía ORM/queries parametrizadas"; la UI no usa `dangerouslySetInnerHTML`);
 *   UUIDs malformados y campos por encima del máximo los rechaza Zod
 *   server-side (BAD_REQUEST) antes de tocar la BD.
 * - **Presupuesto server-side (invariante 2, `security.md` §1.4):** los
 *   campos `cost`/`budget` inyectados por el cliente se ignoran — el coste y
 *   el presupuesto se recalculan siempre en el servidor; un lineup por
 *   encima del presupuesto se rechaza aunque el cliente envíe `cost: 0`.
 *
 * La fuerza bruta (login, reset, creación/unión de ligas, registro —
 * T-12/ADR-0035) ya la cubren `auth.test.ts`, `reset.test.ts` y
 * `leagues.test.ts`; este archivo añade lo que faltaba.
 *
 * Mismo patrón que `lineups.test.ts`: `DATABASE_URL`/`REDIS_URL` antes del
 * `import()` dinámico; routers inyectables montados con la BD de tests.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CapturingEmailSender, createPrisma, integrationDbUrl, seedWorld } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createLineupsRouter } = await import("../../app/server/routers/lineups");
const { createLeaguesRouter } = await import("../../app/server/routers/leagues");
const { createResultsRouter } = await import("../../app/server/routers/results");
const { adminRouter } = await import("../../app/server/routers/admin");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore, InMemoryTotpChallengeStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const BOOTSTRAP_EMAIL = email("globaladmin");

describe("T-12 · Revisión de seguridad (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let lineupsRouter: ReturnType<typeof createLineupsRouter>;
  let leaguesRouter: ReturnType<typeof createLeaguesRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;

  // Mundo (seedWorld incluye temporada + reglas + GP + evento + 6 pilotos).
  let world: Awaited<ReturnType<typeof seedWorld>>;
  let ctorBId: string;
  let teamBId: string;

  // Usuarios.
  let anaId: string; // dueña del lineup
  let anaToken: string;
  let bobToken: string; // atacante (IDOR/budget)
  let bobId: string;
  let carlosToken: string; // presupuesto server-side (save válido)
  let carlosId: string;
  let leagueAdminToken: string; // admin de la liga privada
  let memberToken: string; // miembro no-admin
  let adminToken: string; // global_admin (bootstrap, ADR-0010)
  let leagueId: string;
  let leagueCode: string;

  beforeAll(async () => {
    prisma = createPrisma();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      totp: new InMemoryTotpChallengeStore(),
      totpCfg: { challengeTtlSec: 300, maxAttempts: 5 },
      sessionTtlSec: 3600,
      secureCookie: true,
      rateLimitCfg: {
        maxPerWindow: 50,
        windowSec: 60,
        lockoutThreshold: 100,
        lockoutSec: 900,
      },
      emailSender: new CapturingEmailSender(),
      appUrl: "http://localhost:3000",
      resetCfg: { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 },
      registerCfg: { maxPerWindow: 100, windowSec: 3600 },
      bootstrapAdminEmail: BOOTSTRAP_EMAIL,
    });
    lineupsRouter = createLineupsRouter({ prisma });
    leaguesRouter = createLeaguesRouter({ prisma });
    resultsRouter = createResultsRouter({ prisma });

    world = await seedWorld(prisma);

    // Segundo constructor/equipo (límite de concentración 2 por ctor/equipo).
    ctorBId = (
      await prisma.constructor.create({
        data: { name: `Constructor Beta ${suffix}` },
      })
    ).id;
    teamBId = (
      await prisma.team.create({
        data: { name: `Equipo Beta ${suffix}`, constructorId: ctorBId },
      })
    ).id;

    // Afiliaciones del GP: r0, r1, r4 → teamA/ctorA; r2, r3 → teamB/ctorB.
    await prisma.$transaction([
      ...[world.riders[0].id, world.riders[1].id, world.riders[4].id].map((riderId) =>
        prisma.riderAffiliation.create({
          data: { gpId: world.gp.id, riderId, teamId: world.team.id, constructorId: world.ctor.id },
        }),
      ),
      ...[world.riders[2].id, world.riders[3].id].map((riderId) =>
        prisma.riderAffiliation.create({
          data: { gpId: world.gp.id, riderId, teamId: teamBId, constructorId: ctorBId },
        }),
      ),
    ]);

    // Precios congelados del GP (misma métrica que lineups.test.ts).
    await prisma.price.createMany({
      data: [
        { gpId: world.gp.id, assetType: "rider", assetId: world.riders[0].id, price: 5 },
        { gpId: world.gp.id, assetType: "rider", assetId: world.riders[1].id, price: 15 },
        { gpId: world.gp.id, assetType: "rider", assetId: world.riders[2].id, price: 25 },
        { gpId: world.gp.id, assetType: "rider", assetId: world.riders[3].id, price: 25 },
        { gpId: world.gp.id, assetType: "rider", assetId: world.riders[4].id, price: 35 },
        { gpId: world.gp.id, assetType: "constructor", assetId: world.ctor.id, price: 5 },
        { gpId: world.gp.id, assetType: "constructor", assetId: ctorBId, price: 30 },
        { gpId: world.gp.id, assetType: "team", assetId: world.team.id, price: 5 },
        { gpId: world.gp.id, assetType: "team", assetId: teamBId, price: 5.01 },
      ],
    });

    // Usuarios (una IP distinta por usuario, como el resto de la suite).
    const register = async (
      name: string,
      ip: string,
    ): Promise<{ id: string; token: string }> => {
      const { ctx, auth } = await callerFor(ip);
      await auth.register({
        email: email(name),
        username: username(name),
        password: PASSWORD,
        termsAccepted: true,
      });
      const user = await prisma.user.findUnique({ where: { email: email(name) } });
      if (!user) throw new Error(`no se pudo registrar a ${name}`);
      return { id: user.id, token: sessionTokenFrom(ctx) };
    };

    const ana = await register("ana", "198.51.100.1");
    anaId = ana.id;
    anaToken = ana.token;
    const bob = await register("bob", "198.51.100.2");
    bobId = bob.id;
    bobToken = bob.token;
    const carlos = await register("carlos", "198.51.100.3");
    carlosId = carlos.id;
    carlosToken = carlos.token;
    leagueAdminToken = (await register("adminliga", "198.51.100.4")).token;
    memberToken = (await register("miembro", "198.51.100.5")).token;
    const adm = await register("globaladmin", "198.51.100.6");
    adminToken = adm.token;

    // Liga privada con código (US-23/US-25): admin crea, miembro se une.
    const { leagues } = await callerFor("198.51.100.4", leagueAdminToken);
    const created = await leagues.create({
      name: `Liga ${suffix}`,
      description: "Solo amigos",
      type: "private",
      visibility: "private",
      minMembers: 2,
      maxMembers: 50,
      entryMode: "code",
    });
    leagueId = created.id;
    leagueCode = created.code ?? "";
    expect(leagueCode).toMatch(/[2-9A-HJ-NP-Z]{8,}/i);

    const { leagues: memberLeagues } = await callerFor("198.51.100.5", memberToken);
    await memberLeagues.join({ leagueId, code: leagueCode });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto tRPC para una petición simulada (IP + cookie de sesión opcional). */
  async function callerFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/auth", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      lineups: lineupsRouter.createCaller(ctx),
      leagues: leaguesRouter.createCaller(ctx),
      results: resultsRouter.createCaller(ctx),
      admin: adminRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Input de `lineups.save` (slots: 2 oro, 2 plata, 1 constructor, 1 equipo). */
  function lineupInput(
    gold: string[],
    silver: string[],
    constructorId: string,
    teamId: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      gpId: world.gp.id,
      slots: { gold, silver, constructorId, teamId },
      // Campos inyectados por el cliente (T-12): el servidor DEBE ignorarlos
      // (invariante 2, security.md §1.4) — los tests lo verifican.
      ...extra,
    };
  }

  // ── IDOR / acceso horizontal ───────────────────────────────────────────────

  it("IDOR: el usuario B no puede leer el lineup del usuario A", async () => {
    const [r1, r2, r3, r4] = world.riders;
    const { lineups: anaLineups } = await callerFor("198.51.100.1", anaToken);
    const saved = await anaLineups.save(
      lineupInput([r1.id, r2.id], [r3.id, r4.id], world.ctor.id, world.team.id),
    );
    expect(saved.cost).toBe(80);

    // B consulta el MISMO GP: recibe su propio estado (sin lineup → null),
    // NUNCA el de A (ni coste, ni slots).
    const { lineups: bobLineups } = await callerFor("198.51.100.2", bobToken);
    const bobView = await bobLineups.get({ gpId: world.gp.id });
    expect(bobView).toBeNull();
  });

  it("IDOR: el save de B en el GP de A no toca el lineup de A", async () => {
    const [r1, r2, r3, r4] = world.riders;

    // Snap-shot del lineup de A antes del ataque.
    const snapshot = async () => {
      const row = await prisma.lineup.findUnique({
        where: { userId_gpId: { userId: anaId, gpId: world.gp.id } },
        include: { slots: true },
      });
      if (!row) throw new Error("el lineup de A no existe");
      return JSON.stringify({
        ...row,
        slots: [...row.slots].sort((a, b) => a.assetId.localeCompare(b.assetId)),
      });
    };
    const anaBefore = await snapshot();

    // B guarda SU propio lineup (coste 80, dentro de presupuesto).
    const { lineups: bobLineups } = await callerFor("198.51.100.2", bobToken);
    const bobSaved = await bobLineups.save(
      lineupInput([r1.id, r2.id], [r3.id, r4.id], world.ctor.id, world.team.id),
    );
    expect(bobSaved.firstSave).toBe(true);
    expect(bobSaved.cost).toBe(80);

    // El lineup de A sigue idéntico (mismos slots, mismos metadatos).
    expect(await snapshot()).toBe(anaBefore);
    const anaView = (await (await callerFor("198.51.100.1", anaToken)).lineups.get({ gpId: world.gp.id }))!;
    expect(anaView.cost).toBe(80);
  });

  it("IDOR: un extraño a la liga privada no la ve ni la gestiona (NOT_FOUND, no revela existencia)", async () => {
    const stranger = await callerFor("198.51.100.2", bobToken);
    const fakeId = randomUUID();

    const notFound = (p: Promise<unknown>) =>
      expect(p).rejects.toMatchObject({ code: "NOT_FOUND" });

    await notFound(stranger.leagues.get({ leagueId }));
    await notFound(
      stranger.leagues.update({ leagueId, name: "Hacked" }),
    );
    await notFound(
      stranger.leagues.kick({ leagueId, targetUserId: bobId }),
    );
    await notFound(
      stranger.leagues.transferAdmin({ leagueId, targetUserId: bobId }),
    );
    await notFound(stranger.leagues.leave({ leagueId }));

    // Idéntico error para una liga inexistente (no se revela la existencia).
    await notFound(stranger.leagues.get({ leagueId: fakeId }));
  });

  it("IDOR: un miembro no-admin no gestiona la liga (FORBIDDEN) y el estado no cambia", async () => {
    const member = await callerFor("198.51.100.5", memberToken);

    const forbidden = (p: Promise<unknown>) =>
      expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });

    await forbidden(
      member.leagues.update({ leagueId, name: "Robada por el miembro" }),
    );
    await forbidden(
      member.leagues.kick({ leagueId, targetUserId: bobId }),
    );
    await forbidden(
      member.leagues.transferAdmin({ leagueId, targetUserId: bobId }),
    );
    await forbidden(member.leagues.close({ leagueId }));

    // El estado de la liga es intacto (nombre original, sigue activa).
    const admin = await callerFor("198.51.100.4", leagueAdminToken);
    const view = await admin.leagues.get({ leagueId });
    expect(view.name).toBe(`Liga ${suffix}`);
    const row = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { status: true },
    });
    expect(row?.status).not.toBe("finished");
  });

  // ── Inyección (XSS / SQLi / entradas malformadas) ──────────────────────────

  it("inyección: payloads XSS/SQLi en texto libre se guardan inertes (datos, no código)", async () => {
    const XSS = "<script>alert(1)</script>";
    const SQLI = "1'; DROP TABLE users;--";

    const admin = await callerFor("198.51.100.4", leagueAdminToken);
    const created = await admin.leagues.create({
      name: XSS,
      description: `${SQLI} <img src=x onerror=alert(1)>`,
      type: "private",
      visibility: "private",
      minMembers: 2,
      maxMembers: 50,
      entryMode: "code",
    });

    // La BD la guarda como DADO (ORM parametrizada) y la API la devuelve
    // tal cual: React la escapa al renderizar (la app no usa
    // `dangerouslySetInnerHTML` — verificado en la revisión T-12).
    const view = await admin.leagues.get({ leagueId: created.id });
    expect(view.name).toBe(XSS);
    expect(view.description).toContain(SQLI);

    // La tabla `users` sigue ahí (el payload no se ejecutó nunca):
    expect(await prisma.user.count({ where: { email: email("ana") } })).toBe(1);
  });

  it("inyección: UUIDs malformados se rechazan server-side antes de tocar la BD", async () => {
    const bob = await callerFor("198.51.100.2", bobToken);
    const [, r2, r3, r4] = world.riders;
    const badId = "no-es-un-uuid'; DROP TABLE users;--";

    // Snap-shot del lineup de bob (existe desde el test IDOR anterior).
    const bobRow = await prisma.lineup.findUnique({
      where: { userId_gpId: { userId: bobId, gpId: world.gp.id } },
      include: { slots: true },
    });
    if (!bobRow) throw new Error("el lineup de bob no existe");
    const bobBefore = JSON.stringify({
      ...bobRow,
      slots: [...bobRow.slots].sort((a, b) => a.assetId.localeCompare(b.assetId)),
    });

    // `lineups.save` con un piloto inyectado (Zod → BAD_REQUEST, no SQL).
    await expect(
      bob.lineups.save(
        lineupInput([badId, r2.id], [r3.id, r4.id], world.ctor.id, world.team.id),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // `lineups.get` con GP malformado.
    await expect(
      bob.lineups.get({ gpId: badId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // `leagues.kick` con destinatario malformado.
    await expect(
      bob.leagues.kick({ leagueId, targetUserId: badId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // La BD sigue sana: el intento rechazado no tocó el lineup de bob y la
    // tabla de usuarios está intacta.
    const bobAfter = await prisma.lineup.findUnique({
      where: { userId_gpId: { userId: bobId, gpId: world.gp.id } },
      include: { slots: true },
    });
    expect(
      JSON.stringify({
        ...bobAfter,
        slots: [...(bobAfter?.slots ?? [])].sort((a, b) => a.assetId.localeCompare(b.assetId)),
      }),
    ).toBe(bobBefore);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  it("inyección: campos de texto por encima del máximo se rechazan (Zod server-side)", async () => {
    const admin = await callerFor("198.51.100.4", leagueAdminToken);

    // Nombre de liga > 80 caracteres.
    await expect(
      admin.leagues.create({
        name: "x".repeat(81),
        type: "private",
        visibility: "private",
        minMembers: 2,
        maxMembers: 50,
        entryMode: "code",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Descripción > 500 caracteres.
    await expect(
      admin.leagues.create({
        name: `Liga ${suffix}-2`,
        description: "x".repeat(501),
        type: "private",
        visibility: "private",
        minMembers: 2,
        maxMembers: 50,
        entryMode: "code",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Username > 20 caracteres (registro).
    const fresh = await callerFor("198.51.100.7");
    await expect(
      fresh.auth.register({
        email: email("largo"),
        username: "u".repeat(21),
        password: PASSWORD,
        termsAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("inyección: results.importEvent (admin) rechaza payloads malformados sin escribir resultados", async () => {
    const admin = await callerFor("198.51.100.6", adminToken);

    // Motivo por encima de 500 caracteres.
    await expect(
      admin.results.importEvent({
        gpId: world.gp.id,
        eventId: world.event.id,
        entries: [
          {
            riderId: world.riders[0].id,
            started: true,
            finished: true,
            position: 1,
            penalties: [],
            bonuses: [],
          },
        ],
        reason: "x".repeat(501),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // riderId malformado (inyección de identificador).
    await expect(
      admin.results.importEvent({
        gpId: world.gp.id,
        eventId: world.event.id,
        entries: [
          {
            riderId: "1; DROP TABLE results;--",
            started: true,
            finished: true,
            position: 1,
            penalties: [],
            bonuses: [],
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // No se escribió ninguna fila de resultado (rechazo ANTES de la BD).
    expect(
      await prisma.result.count({ where: { eventId: world.event.id } }),
    ).toBe(0);
  });

  // ── Presupuesto server-side (invariante 2, security.md §1.4) ───────────────

  it("presupuesto: `cost`/`budget` inyectados por el cliente se ignoran — el exceso sigue rechazado", async () => {
    const [g0, g1, s0, s1] = [world.riders[0], world.riders[4], world.riders[2], world.riders[3]];
    // Coste real (servidor): 5 + 35 + 25 + 25 + 5 (ctorA) + 5.01 (teamB)
    // = 100.01 > 100 (B) → excede por 0.01. El cliente inyecta `cost: 0`/
    // `budget: 9999` → el servidor los ignora y rechaza.
    const bob = await callerFor("198.51.100.2", bobToken);
    await expect(
      bob.lineups.save(
        lineupInput([g0.id, g1.id], [s0.id, s1.id], world.ctor.id, teamBId, {
          cost: 0,
          budget: 9999,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("excede el presupuesto"),
    });

    // El intento rechazado no tocó el lineup previo de bob (coste 80, intacto).
    const bobView = await bob.lineups.get({ gpId: world.gp.id });
    expect(bobView?.cost).toBe(80);
  });

  it("presupuesto: el save se guarda con el coste CALCULADO EN SERVIDOR, no el enviado", async () => {
    const [r1, r2, r3, r4] = world.riders;
    // Coste real (servidor): 5 + 15 + 25 + 25 + 5 + 5 = 80. El cliente
    // intenta inyectar `cost: 0` (gratis) → el servidor ignora el campo.
    const carlos = await callerFor("198.51.100.3", carlosToken);
    const saved = await carlos.lineups.save(
      lineupInput([r1.id, r2.id], [r3.id, r4.id], world.ctor.id, world.team.id, {
        cost: 0,
        budget: 9999,
      }),
    );
    expect(saved.cost).toBe(80);
    expect(saved.budget).toBe(100);
    expect(saved.balance).toBe(20);

    // La contabilidad de presupuesto refleja el gasto REAL (−80), no 0.
    const movements = await prisma.budgetMovement.findMany({
      where: { userId: carlosId, gpId: world.gp.id },
      select: { type: true, amount: true },
    });
    const spend = movements.filter((m) => m.type === "spend");
    expect(spend).toHaveLength(1);
    expect(Number(spend[0]!.amount)).toBe(-80);
  });
});
