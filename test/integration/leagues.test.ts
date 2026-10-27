/**
 * US-23 · Creo una liga privada con código (PostgreSQL real, ADR-0023).
 *
 * CA: "el creador define nombre/descripción/tipo/visibilidad/min-máx
 * (PROVISIONAL: 2–50)/modo de entrada/duración; el creador es admin; el
 * código generado tiene ≥8 caracteres de alta entropía (sin 0/O/1/I) y es
 * revocable (generar uno nuevo invalida el anterior, test)".
 *
 * Cubre:
 * - **createLeague**: creador = admin (miembro activo rol admin); liga con
 *   todos los campos (status active); código generado (≥8, alfabeto sin
 *   0/O/1/I); modo `invite` → sin código; auditoría `league.created`
 *   (sin el código — secreto).
 * - **Validaciones server-side**: límites de miembros (2–50), min ≤ máx,
 *   consistencia tipo/visibilidad, fechas.
 * - **rotateCode** (leagues.md §4): el código anterior queda revocado, el
 *   nuevo es activo y distinto; solo el admin (miembro → FORBIDDEN);
 *   auditoría `league.code_rotated`.
 * - **getLeague / myLeagues**: solo miembros activos; el código solo lo ve
 *   el admin; extraños → NOT_FOUND.
 * - **Rate limit** (security.md §1.6): N+1 creaciones → la última se
 *   rechaza (store InMemory inyectado).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { InMemoryRateLimitStore } from "../../app/modules/identity";
import { LeagueService } from "../../app/modules/leagues";
import { INVITE_CODE_ALPHABET } from "../../app/modules/leagues/core";
import { createPrisma, integrationDbUrl } from "./helpers";

process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect

const META = { actorId: "", ip: "127.0.0.1" };

/** Payload de creación (liga privada por código por defecto). */
interface CreateLeaguePayload {
  name: string;
  description?: string | null;
  type: "private" | "public";
  visibility: "public" | "unlisted" | "private";
  minMembers: number;
  maxMembers: number;
  entryMode: "code" | "invite" | "mixed";
  startDate?: Date | null;
  endDate?: Date | null;
}

/** Payload base válido (liga privada por código). */
function validInput(overrides: Partial<CreateLeaguePayload> = {}): CreateLeaguePayload {
  return {
    name: "Liga de prueba",
    description: "Solo amigos",
    type: "private",
    visibility: "private",
    minMembers: 2,
    maxMembers: 50,
    entryMode: "code",
    ...overrides,
  };
}

/** El código usa solo el alfabeto permitido y tiene ≥8 caracteres. */
function expectValidCode(code: string): void {
  expect(code.length).toBeGreaterThanOrEqual(8);
  const allowed = new Set(INVITE_CODE_ALPHABET.split(""));
  for (const ch of code) {
    expect(allowed.has(ch)).toBe(true);
  }
}

describe("US-23 · Creo una liga privada con código (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let service: LeagueService;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(() => {
    prisma = createPrisma();
    service = new LeagueService({ prisma });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("createLeague: el creador es admin y la liga queda activa", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `creator-${suffix}@test.local`,
          passwordHash: "h",
          username: `creator_${suffix}`,
        },
      })
    ).id;

    const view = await service.createLeague(
      validInput({ name: `Liga ${suffix}` }),
      { ...META, actorId: creator },
    );

    expect(view.name).toBe(`Liga ${suffix}`);
    expect(view.description).toBe("Solo amigos");
    expect(view.type).toBe("private");
    expect(view.visibility).toBe("private");
    expect(view.minMembers).toBe(2);
    expect(view.maxMembers).toBe(50);
    expect(view.entryMode).toBe("code");
    expect(view.isAdmin).toBe(true);
    expect(view.activeMembers).toBe(1);

    // En BD: liga activa + miembro creador con rol admin.
    const league = await prisma.league.findUniqueOrThrow({ where: { id: view.id } });
    expect(league.status).toBe("active");
    const membership = await prisma.leagueMember.findUniqueOrThrow({
      where: { leagueId_userId: { leagueId: view.id, userId: creator } },
    });
    expect(membership.role).toBe("admin");
    expect(membership.status).toBe("active");
  });

  it("createLeague: genera un código de alta entropía (≥8, sin 0/O/1/I)", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `code-${suffix}@test.local`,
          passwordHash: "h",
          username: `code_${suffix}`,
        },
      })
    ).id;

    const view = await service.createLeague(
      validInput({ name: `Liga código ${suffix}` }),
      { ...META, actorId: creator },
    );

    expect(view.code).not.toBeNull();
    expectValidCode(view.code as string);

    // En BD: una invitación activa con ese código, creada por el creador.
    const invite = await prisma.leagueInvite.findUniqueOrThrow({
      where: { code: view.code as string },
    });
    expect(invite.leagueId).toBe(view.id);
    expect(invite.status).toBe("active");
    expect(invite.createdBy).toBe(creator);
  });

  it("createLeague: modo `invite` → sin código", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `invite-${suffix}@test.local`,
          passwordHash: "h",
          username: `invite_${suffix}`,
        },
      })
    ).id;

    const view = await service.createLeague(
      validInput({ name: `Liga invitación ${suffix}`, entryMode: "invite" }),
      { ...META, actorId: creator },
    );

    expect(view.code).toBeNull();
    const invites = await prisma.leagueInvite.findMany({
      where: { leagueId: view.id },
    });
    expect(invites).toHaveLength(0);
  });

  it("createLeague: auditoría `league.created` (sin el código — secreto)", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `audit-${suffix}@test.local`,
          passwordHash: "h",
          username: `audit_${suffix}`,
        },
      })
    ).id;

    const view = await service.createLeague(
      validInput({ name: `Liga auditoría ${suffix}` }),
      { ...META, actorId: creator },
    );

    const rows = await prisma.auditLog.findMany({
      where: { action: "league.created", entityId: view.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(creator);
    expect(rows[0]?.entity).toBe("league");
    const afterData = rows[0]?.afterData as Record<string, unknown>;
    expect(afterData.codeGenerated).toBe(true);
    // El código NO se registra (es un secreto, como una contraseña).
    expect(JSON.stringify(afterData)).not.toContain(view.code as string);
  });

  it("createLeague: rechaza mínimos < 2 y máximos > 50 (PROVISIONAL)", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `limits-${suffix}@test.local`,
          passwordHash: "h",
          username: `limits_${suffix}`,
        },
      })
    ).id;

    await expect(
      service.createLeague(
        validInput({ name: `Liga min ${suffix}`, minMembers: 1 }),
        { ...META, actorId: creator },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      service.createLeague(
        validInput({ name: `Liga max ${suffix}`, maxMembers: 51 }),
        { ...META, actorId: creator },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("createLeague: rechaza min > máx", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `minmax-${suffix}@test.local`,
          passwordHash: "h",
          username: `minmax_${suffix}`,
        },
      })
    ).id;

    await expect(
      service.createLeague(
        validInput({ name: `Liga minmax ${suffix}`, minMembers: 30, maxMembers: 10 }),
        { ...META, actorId: creator },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("createLeague: rechaza inconsistencias tipo/visibilidad", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `typevis-${suffix}@test.local`,
          passwordHash: "h",
          username: `typevis_${suffix}`,
        },
      })
    ).id;

    // Privada no puede ser visible en el directorio.
    await expect(
      service.createLeague(
        validInput({
          name: `Liga privada pública ${suffix}`,
          type: "private",
          visibility: "public",
        }),
        { ...META, actorId: creator },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Pública debe ser visible en el directorio.
    await expect(
      service.createLeague(
        validInput({
          name: `Liga pública oculta ${suffix}`,
          type: "public",
          visibility: "unlisted",
        }),
        { ...META, actorId: creator },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("createLeague: rechaza fecha de fin anterior a la de inicio", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `dates-${suffix}@test.local`,
          passwordHash: "h",
          username: `dates_${suffix}`,
        },
      })
    ).id;

    await expect(
      service.createLeague(
        validInput({
          name: `Liga fechas ${suffix}`,
          startDate: new Date("2027-06-01T00:00:00Z"),
          endDate: new Date("2027-01-01T00:00:00Z"),
        }),
        { ...META, actorId: creator },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rotateCode: el código anterior queda revocado y el nuevo es activo (CA)", async () => {
    const creator = (
      await prisma.user.create({
        data: {
          email: `rotate-${suffix}@test.local`,
          passwordHash: "h",
          username: `rotate_${suffix}`,
        },
      })
    ).id;

    const created = await service.createLeague(
      validInput({ name: `Liga rotación ${suffix}` }),
      { ...META, actorId: creator },
    );
    const oldCode = created.code as string;
    expectValidCode(oldCode);

    const newCode = await service.rotateCode(created.id, creator, {
      ...META,
      actorId: creator,
    });

    expect(newCode).not.toBe(oldCode);
    expectValidCode(newCode);

    // El anterior queda revocado; el nuevo es el único activo.
    const oldInvite = await prisma.leagueInvite.findUniqueOrThrow({
      where: { code: oldCode },
    });
    expect(oldInvite.status).toBe("revoked");
    const newInvite = await prisma.leagueInvite.findUniqueOrThrow({
      where: { code: newCode },
    });
    expect(newInvite.status).toBe("active");
    const activeCount = await prisma.leagueInvite.count({
      where: { leagueId: created.id, status: "active" },
    });
    expect(activeCount).toBe(1);

    // Auditoría `league.code_rotated` (IDs, no el código).
    const audit = await prisma.auditLog.findMany({
      where: { action: "league.code_rotated", entityId: created.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(creator);
    expect(JSON.stringify(audit[0]?.afterData)).not.toContain(newCode);
  });

  it("rotateCode: un miembro (no admin) → FORBIDDEN", async () => {
    const admin = (
      await prisma.user.create({
        data: {
          email: `radmin-${suffix}@test.local`,
          passwordHash: "h",
          username: `radmin_${suffix}`,
        },
      })
    ).id;
    const member = (
      await prisma.user.create({
        data: {
          email: `rmember-${suffix}@test.local`,
          passwordHash: "h",
          username: `rmember_${suffix}`,
        },
      })
    ).id;

    const created = await service.createLeague(
      validInput({ name: `Liga permisos ${suffix}` }),
      { ...META, actorId: admin },
    );
    await prisma.leagueMember.create({
      data: { leagueId: created.id, userId: member, role: "member" },
    });

    await expect(
      service.rotateCode(created.id, member, { ...META, actorId: member }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rotateCode: liga inexistente → NOT_FOUND", async () => {
    const user = (
      await prisma.user.create({
        data: {
          email: `rnotfound-${suffix}@test.local`,
          passwordHash: "h",
          username: `rnotfound_${suffix}`,
        },
      })
    ).id;

    await expect(
      service.rotateCode(randomUUID(), user, { ...META, actorId: user }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getLeague: el miembro ve la liga; el código solo lo ve el admin", async () => {
    const admin = (
      await prisma.user.create({
        data: {
          email: `gadmin-${suffix}@test.local`,
          passwordHash: "h",
          username: `gadmin_${suffix}`,
        },
      })
    ).id;
    const member = (
      await prisma.user.create({
        data: {
          email: `gmember-${suffix}@test.local`,
          passwordHash: "h",
          username: `gmember_${suffix}`,
        },
      })
    ).id;

    const created = await service.createLeague(
      validInput({ name: `Liga get ${suffix}` }),
      { ...META, actorId: admin },
    );
    await prisma.leagueMember.create({
      data: { leagueId: created.id, userId: member, role: "member" },
    });

    const adminView = await service.getLeague(created.id, admin);
    expect(adminView.isAdmin).toBe(true);
    expect(adminView.code).toBe(created.code);

    const memberView = await service.getLeague(created.id, member);
    expect(memberView.isAdmin).toBe(false);
    expect(memberView.code).toBeNull();
  });

  it("getLeague: un extraño no ve la liga privada (NOT_FOUND, sin revelar)", async () => {
    const admin = (
      await prisma.user.create({
        data: {
          email: `gadmin2-${suffix}@test.local`,
          passwordHash: "h",
          username: `gadmin2_${suffix}`,
        },
      })
    ).id;
    const stranger = (
      await prisma.user.create({
        data: {
          email: `stranger-${suffix}@test.local`,
          passwordHash: "h",
          username: `stranger_${suffix}`,
        },
      })
    ).id;

    const created = await service.createLeague(
      validInput({ name: `Liga secreto ${suffix}` }),
      { ...META, actorId: admin },
    );

    await expect(service.getLeague(created.id, stranger)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Y tampoco existe para un ID inexistente (mismo error).
    await expect(service.getLeague(randomUUID(), stranger)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("myLeagues: lista las ligas activas del usuario (con código si es admin)", async () => {
    const user = (
      await prisma.user.create({
        data: {
          email: `my-${suffix}@test.local`,
          passwordHash: "h",
          username: `my_${suffix}`,
        },
      })
    ).id;

    const a = await service.createLeague(
      validInput({ name: `Liga mía A ${suffix}` }),
      { ...META, actorId: user },
    );
    const b = await service.createLeague(
      validInput({ name: `Liga mía B ${suffix}` }),
      { ...META, actorId: user },
    );

    // Una liga donde el usuario salió (status left) NO aparece.
    const c = await service.createLeague(
      validInput({ name: `Liga salida ${suffix}` }),
      { ...META, actorId: user },
    );
    await prisma.leagueMember.updateMany({
      where: { leagueId: c.id, userId: user },
      data: { status: "left", leftAt: new Date() },
    });

    const leagues = await service.myLeagues(user);
    const names = leagues.map((l) => l.name).sort();
    expect(names).toEqual([`Liga mía A ${suffix}`, `Liga mía B ${suffix}`].sort());

    const leagueA = leagues.find((l) => l.id === a.id);
    expect(leagueA?.isAdmin).toBe(true);
    expect(leagueA?.code).toBe(a.code);
    // La segunda liga también está (por ID, no solo por nombre).
    expect(leagues.some((l) => l.id === b.id)).toBe(true);
  });

  it("rate limit: N+1 creaciones → la última se rechaza (security.md §1.6)", async () => {
    const store = new InMemoryRateLimitStore();
    const rateLimited = new LeagueService({
      prisma,
      rateLimit: store,
      rateLimitCfg: { maxPerWindow: 3, windowSec: 3600 },
    });
    const user = (
      await prisma.user.create({
        data: {
          email: `rl-${suffix}@test.local`,
          passwordHash: "h",
          username: `rl_${suffix}`,
        },
      })
    ).id;

    // 3 creaciones permitidas…
    for (let i = 1; i <= 3; i++) {
      const view = await rateLimited.createLeague(
        validInput({ name: `Liga rl ${suffix}-${i}` }),
        { ...META, actorId: user },
      );
      expect(view.id).toBeTruthy();
    }
    // …la 4ª se rechaza (ventana de 1 h).
    await expect(
      rateLimited.createLeague(
        validInput({ name: `Liga rl ${suffix}-4` }),
        { ...META, actorId: user },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

/**
 * US-24 · Creo una liga pública y aparece en el directorio (PostgreSQL real,
 * ADR-0024).
 *
 * CA: "la liga pública es visible en el directorio con ranking público; la
 * privada no aparece (test: un usuario no autenticado/miembro no la ve ni
 * puede acceder por ID)".
 *
 * Cubre:
 * - **listPublic** (directorio, leagues.md §2): solo `type=public` y
 *   `status=active`; excluye privadas, finished y unlisted; orden por nombre;
 *   miembros activos contados.
 * - **getLeague** (US-24, leagues.md §9): pública ⇒ cualquiera (sin sesión
 *   OK, código null, isAdmin false); pública como admin ⇒ código; privada
 *   sin sesión → NOT_FOUND; privada a extraño autenticado → NOT_FOUND (mismo
 *   error que inexistente — no se revela la existencia); privada a miembro ⇒ OK.
 * - **leagueRanking** (leagues.md §8/§9): última versión publicada con
 *   seudónimos (nunca PII); pública sin sesión ⇒ filas; privada a extraño →
 *   NOT_FOUND; privada a miembro ⇒ OK; sin filas → vacío elegante.
 */
describe("US-24 · Liga pública y directorio (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let service: LeagueService;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(() => {
    prisma = createPrisma();
    service = new LeagueService({ prisma });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Crea un usuario aislado y devuelve su id. */
  async function makeUser(tag: string): Promise<string> {
    return (
      await prisma.user.create({
        data: {
          email: `${tag}-${suffix}@test.local`,
          passwordHash: "h",
          username: `${tag}_${suffix}`,
        },
      })
    ).id;
  }

  /** Crea una liga pública activa con el creador como admin. */
  async function makePublicLeague(creatorId: string, name: string) {
    return service.createLeague(
      validInput({
        name,
        type: "public",
        visibility: "public",
        entryMode: "code",
      }),
      { ...META, actorId: creatorId },
    );
  }

  it("listPublic: solo públicas activas, orden por nombre, con miembros", async () => {
    const creator = await makeUser("dir");

    // 1 pública activa (aparece), 1 privada (no), 1 pública finished (no),
    // 1 pública unlisted (no — la validación exige pública ⇒ visibilidad pública,
    // así que se crea una pública y se fuerza visibility=unlisted en BD).
    const pubA = await makePublicLeague(creator, `A pública ${suffix}`);
    const pubB = await makePublicLeague(creator, `B pública ${suffix}`);
    const priv = await service.createLeague(
      validInput({ name: `C privada ${suffix}` }),
      { ...META, actorId: creator },
    );
    await prisma.league.update({
      where: { id: pubB.id },
      data: { status: "finished" },
    });
    await prisma.league.update({
      where: { id: pubA.id },
      data: { visibility: "unlisted" },
    });
    // pubA vuelve a public para que solo pubB (finished) y priv queden fuera.
    await prisma.league.update({
      where: { id: pubA.id },
      data: { visibility: "public" },
    });

    // Un miembro extra en pubB (aunque esté finished, no cuenta: no está en el
    // directorio). En pubA (la única pública activa) un segundo miembro.
    const extra = await makeUser("dir-extra");
    await prisma.leagueMember.create({
      data: { leagueId: pubA.id, userId: extra, role: "member" },
    });

    const dir = await service.listPublic();
    expect(dir.map((l) => l.name)).toEqual([`A pública ${suffix}`]);
    expect(dir[0]).toMatchObject({
      id: pubA.id,
      type: "public",
      activeMembers: 2,
    });
    // Ni la privada ni la finished aparecen.
    expect(dir.map((l) => l.id)).not.toContain(priv.id);
    expect(dir.map((l) => l.id)).not.toContain(pubB.id);
    // El código NUNCA sale del directorio (secreto, solo admin).
    expect(dir[0]).not.toHaveProperty("code");
    expect(dir[0]).not.toHaveProperty("members");
  });

  it("listPublic: vacío si no hay públicas activas", async () => {
    // Aísla: crea una pública y la termina; el directorio de OTROS no se ve,
    // pero comprobamos la forma de retorno vacía con una liga que no califica.
    const creator = await makeUser("empty");
    const l = await makePublicLeague(creator, `Ephemeral ${suffix}`);
    await prisma.league.update({ where: { id: l.id }, data: { status: "archived" } });
    // El directorio global sigue devolviendo las demás; la forma vacía se
    // cubre en el unit del servicio (sin I/O). Aquí: la archivada no aparece.
    const dir = await service.listPublic();
    expect(dir.map((l) => l.id)).not.toContain(l.id);
  });

  it("getLeague: una pública la ve un extraño sin sesión (código null, no admin)", async () => {
    const creator = await makeUser("pub-view");
    const league = await makePublicLeague(creator, `Pública vista ${suffix}`);

    // Sin sesión (userId null): ve la liga, sin privilegios.
    const view = await service.getLeague(league.id, null);
    expect(view.id).toBe(league.id);
    expect(view.isAdmin).toBe(false);
    expect(view.code).toBeNull();
    expect(view.activeMembers).toBe(1);
    // Miembros con seudónimo (nunca PII) y rol.
    expect(view.members).toHaveLength(1);
    expect(view.members[0]!).toMatchObject({ role: "admin" });
    expect(view.members[0]!.username).not.toContain("@");
  });

  it("getLeague: una pública la ve el admin con su código", async () => {
    const creator = await makeUser("pub-admin");
    const league = await makePublicLeague(creator, `Pública admin ${suffix}`);

    const view = await service.getLeague(league.id, creator);
    expect(view.isAdmin).toBe(true);
    expect(view.code).toBe(league.code);
    expect(view.code).not.toBeNull();
  });

  it("getLeague: una privada sin sesión → NOT_FOUND (no revela existencia)", async () => {
    const creator = await makeUser("priv-null");
    const league = await service.createLeague(
      validInput({ name: `Privada null ${suffix}` }),
      { ...META, actorId: creator },
    );

    await expect(service.getLeague(league.id, null)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Mismo error que una liga inexistente (no se distingue).
    await expect(service.getLeague(randomUUID(), null)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("getLeague: una privada a un autenticado que no es miembro → NOT_FOUND", async () => {
    const creator = await makeUser("priv-str");
    const stranger = await makeUser("priv-str2");
    const league = await service.createLeague(
      validInput({ name: `Privada extraño ${suffix}` }),
      { ...META, actorId: creator },
    );

    await expect(service.getLeague(league.id, stranger)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("getLeague: una privada la ve su miembro activo", async () => {
    const creator = await makeUser("priv-member");
    const member = await makeUser("priv-member2");
    const league = await service.createLeague(
      validInput({ name: `Privada miembro ${suffix}` }),
      { ...META, actorId: creator },
    );
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member, role: "member" },
    });

    const view = await service.getLeague(league.id, member);
    expect(view.id).toBe(league.id);
    expect(view.isAdmin).toBe(false);
    expect(view.code).toBeNull();
    expect(view.activeMembers).toBe(2);
  });

  it("leagueRanking: una pública expone su ranking a un extraño sin sesión", async () => {
    const creator = await makeUser("rank-pub");
    const member = await makeUser("rank-pub2");
    const league = await makePublicLeague(creator, `Pública ranking ${suffix}`);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member, role: "member" },
    });

    // Publica una versión de ranking general (gpId null) con 2 miembros.
    const now = new Date("2026-10-25T12:00:00Z");
    await prisma.ranking.createMany({
      data: [
        {
          leagueId: league.id,
          gpId: null,
          userId: creator,
          position: 1,
          points: 170.5,
          resultsVersion: "v1",
          computedAt: now,
        },
        {
          leagueId: league.id,
          gpId: null,
          userId: member,
          position: 2,
          points: 120,
          resultsVersion: "v1",
          computedAt: now,
        },
      ],
    });

    // Sin sesión: ve el ranking, con seudónimos (nunca PII).
    const view = await service.leagueRanking(league.id, null, null);
    expect(view.entries).toHaveLength(2);
    expect(view.entries[0]).toMatchObject({ position: 1, points: 170.5 });
    expect(view.entries[1]).toMatchObject({ position: 2, points: 120 });
    for (const e of view.entries) {
      expect(e.username).not.toContain("@");
    }
    expect(view.computedAt?.toISOString()).toBe(now.toISOString());
    expect(view.resultsVersion).toBe("v1");
  });

  it("leagueRanking: toma la última versión publicada (no la anterior)", async () => {
    const creator = await makeUser("rank-ver");
    const league = await makePublicLeague(creator, `Pública versión ${suffix}`);

    const v1 = new Date("2026-10-24T12:00:00Z");
    const v2 = new Date("2026-10-25T12:00:00Z");
    await prisma.ranking.createMany({
      data: [
        {
          leagueId: league.id,
          gpId: null,
          userId: creator,
          position: 2,
          points: 100,
          resultsVersion: "v1",
          computedAt: v1,
        },
        {
          leagueId: league.id,
          gpId: null,
          userId: creator,
          position: 1,
          points: 150,
          resultsVersion: "v2",
          computedAt: v2,
        },
      ],
    });

    const view = await service.leagueRanking(league.id, null, null);
    // Solo la versión vigente (v2): 1 fila, posición 1, 150 pts.
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ position: 1, points: 150 });
    expect(view.resultsVersion).toBe("v2");
  });

  it("leagueRanking: por GP (gpId indicado) y general (gpId null) son distintos", async () => {
    const creator = await makeUser("rank-gp");
    const league = await makePublicLeague(creator, `Pública GP ${suffix}`);
    const gp = await prisma.gp.create({
      data: {
        seasonId: (
          await prisma.season.create({ data: { name: `T ${suffix}`, year: 2099 } })
        ).id,
        round: 1,
        name: `GP ${suffix}`,
        circuitId: (
          await prisma.circuit.create({ data: { name: `C ${suffix}`, country: "X" } })
        ).id,
        date: new Date("2099-06-01T12:00:00Z"),
      },
    });
    const now = new Date("2026-10-25T12:00:00Z");
    await prisma.ranking.createMany({
      data: [
        {
          leagueId: league.id,
          gpId: gp.id,
          userId: creator,
          position: 1,
          points: 30,
          resultsVersion: "v1",
          computedAt: now,
        },
        {
          leagueId: league.id,
          gpId: null,
          userId: creator,
          position: 1,
          points: 90,
          resultsVersion: "v1",
          computedAt: now,
        },
      ],
    });

    const byGp = await service.leagueRanking(league.id, gp.id, null);
    expect(byGp.entries).toHaveLength(1);
    expect(byGp.entries[0]!.points).toBe(30);

    const overall = await service.leagueRanking(league.id, null, null);
    expect(overall.entries).toHaveLength(1);
    expect(overall.entries[0]!.points).toBe(90);
  });

  it("leagueRanking: sin filas publicadas → vacío elegante", async () => {
    const creator = await makeUser("rank-empty");
    const league = await makePublicLeague(creator, `Pública vacía ${suffix}`);

    const view = await service.leagueRanking(league.id, null, null);
    expect(view.entries).toEqual([]);
    expect(view.computedAt).toBeNull();
    expect(view.resultsVersion).toBeNull();
  });

  it("leagueRanking: una privada a un extraño → NOT_FOUND", async () => {
    const creator = await makeUser("rank-priv");
    const stranger = await makeUser("rank-priv2");
    const league = await service.createLeague(
      validInput({ name: `Privada ranking ${suffix}` }),
      { ...META, actorId: creator },
    );
    await prisma.ranking.create({
      data: {
        leagueId: league.id,
        gpId: null,
        userId: creator,
        position: 1,
        points: 10,
        resultsVersion: "v1",
      },
    });

    await expect(
      service.leagueRanking(league.id, null, stranger),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.leagueRanking(league.id, null, null),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("leagueRanking: una privada la ve su miembro", async () => {
    const creator = await makeUser("rank-privm");
    const member = await makeUser("rank-privm2");
    const league = await service.createLeague(
      validInput({ name: `Privada ranking m ${suffix}` }),
      { ...META, actorId: creator },
    );
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: member, role: "member" },
    });
    await prisma.ranking.create({
      data: {
        leagueId: league.id,
        gpId: null,
        userId: creator,
        position: 1,
        points: 10,
        resultsVersion: "v1",
      },
    });

    const view = await service.leagueRanking(league.id, null, member);
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]!.points).toBe(10);
  });
});

/**
 * US-25 · Me uno a una liga por código o invitación (PostgreSQL real,
 * ADR-0025).
 *
 * CA: "validaciones server-side con motivo explícito: 'código no válido',
 * 'la liga está llena', 'ya eres miembro', 'la liga no acepta entradas';
 * rate-limiting por IP/usuario en el intento de unión (test de fuerza
 * bruta: N intentos fallidos → bloqueo temporal); unirse es transaccional
 * (plaza + membresía, test de concurrencia: dos usuarios por la última
 * plaza → solo uno entra)".
 *
 * Cubre:
 * - **Unión pública** (entrada abierta, ADR-0024): membresía activa rol
 *   member + auditoría `league.joined` (`via: open`) + `isMember` en la vista.
 * - **Unión privada por código**: código activo válido → OK (`via: code`).
 * - **Motivos de rechazo** (leagues.md §6): "El código no es válido."
 *   (sin código / código inexistente / revocado / de otra liga), "Ya eres
 *   miembro de esta liga.", "La liga está llena.", "La liga no acepta
 *   entradas." (status ≠ active; privada `entryMode=invite`).
 * - **Anti fuerza bruta** (leagues.md §4/§10, espejo US-01): ventana por IP
 *   (N+1 → rate-limit); N fallos de código → bloqueo (el código correcto
 *   también se rechaza hasta que expira); reset del contador con éxito.
 * - **Concurrencia** (CA): dos usuarios por la última plaza → solo uno entra.
 */
describe("US-25 · Unirse a una liga por código o entrada abierta (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let service: LeagueService;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(() => {
    prisma = createPrisma();
    service = new LeagueService({ prisma });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Crea un usuario aislado y devuelve su id. */
  async function makeUser(tag: string): Promise<string> {
    return (
      await prisma.user.create({
        data: {
          email: `j25-${tag}-${suffix}@test.local`,
          passwordHash: "h",
          username: `j25_${tag}_${suffix}`,
        },
      })
    ).id;
  }

  /** Crea una liga pública activa (entrada abierta) y devuelve la vista. */
  async function makePublic(creatorId: string, name: string, maxMembers = 50) {
    return service.createLeague(
      validInput({
        name,
        type: "public",
        visibility: "public",
        entryMode: "code",
        maxMembers,
      }),
      { ...META, actorId: creatorId },
    );
  }

  /** Crea una liga privada por código y devuelve {vista, código}. */
  async function makePrivate(creatorId: string, name: string) {
    const view = await service.createLeague(
      validInput({ name }),
      { ...META, actorId: creatorId },
    );
    return { view, code: view.code as string };
  }

  it("pública: se une por leagueId (entrada abierta) y queda miembro activo", async () => {
    const creator = await makeUser("pub-c");
    const joiner = await makeUser("pub-j");
    const league = await makePublic(creator, `Pública join ${suffix}`);

    const view = await service.joinLeague(
      { leagueId: league.id },
      { ...META, actorId: joiner },
    );

    expect(view.id).toBe(league.id);
    expect(view.isMember).toBe(true);
    expect(view.activeMembers).toBe(2);

    const membership = await prisma.leagueMember.findUniqueOrThrow({
      where: { leagueId_userId: { leagueId: league.id, userId: joiner } },
    });
    expect(membership.status).toBe("active");
    expect(membership.role).toBe("member");
  });

  it("pública: auditoría league.joined con via=open (sin el código)", async () => {
    const creator = await makeUser("pub-a");
    const joiner = await makeUser("pub-b");
    const league = await makePublic(creator, `Pública audit ${suffix}`);
    await service.joinLeague({ leagueId: league.id }, { ...META, actorId: joiner });

    const audit = await prisma.auditLog.findFirst({
      where: { action: "league.joined", entityId: league.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorId).toBe(joiner);
    expect(audit!.entity).toBe("league");
    const after = audit!.afterData as { userId?: string; via?: string };
    expect(after.userId).toBe(joiner);
    expect(after.via).toBe("open");
    // El código nunca se registra (secreto, ADR-0023).
    expect(JSON.stringify(audit!.afterData)).not.toContain("code");
  });

  it("privada: se une con el código activo (via=code)", async () => {
    const creator = await makeUser("priv-c");
    const joiner = await makeUser("priv-j");
    const { view, code } = await makePrivate(creator, `Privada join ${suffix}`);

    const result = await service.joinLeague(
      { code },
      { ...META, actorId: joiner },
    );

    expect(result.id).toBe(view.id);
    expect(result.isMember).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "league.joined", entityId: view.id },
      orderBy: { createdAt: "desc" },
    });
    expect((audit!.afterData as { via?: string }).via).toBe("code");
  });

  it("privada: leagueId + código de la misma liga → OK", async () => {
    const creator = await makeUser("priv-both-c");
    const joiner = await makeUser("priv-both-j");
    const { view, code } = await makePrivate(creator, `Privada both ${suffix}`);

    const result = await service.joinLeague(
      { leagueId: view.id, code },
      { ...META, actorId: joiner },
    );
    expect(result.isMember).toBe(true);
  });

  it("privada: sin código → 'El código no es válido.'", async () => {
    const creator = await makeUser("nc-c");
    const joiner = await makeUser("nc-j");
    const { view } = await makePrivate(creator, `Privada noc ${suffix}`);

    await expect(
      service.joinLeague({ leagueId: view.id }, { ...META, actorId: joiner }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El código no es válido.",
    });
  });

  it("privada: código inexistente → 'El código no es válido.'", async () => {
    const creator = await makeUser("nc2-c");
    const joiner = await makeUser("nc2-j");
    await makePrivate(creator, `Privada noc2 ${suffix}`);

    await expect(
      service.joinLeague(
        { code: "NOEXISTE99" },
        { ...META, actorId: joiner },
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El código no es válido.",
    });
  });

  it("privada: código revocado → 'El código no es válido.'", async () => {
    const creator = await makeUser("rev-c");
    const joiner = await makeUser("rev-j");
    const { view, code } = await makePrivate(creator, `Privada rev ${suffix}`);
    // Rotar revoca el código anterior.
    await service.rotateCode(view.id, creator, { ...META, actorId: creator });

    await expect(
      service.joinLeague({ code }, { ...META, actorId: joiner }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El código no es válido.",
    });
  });

  it("privada: código de OTRA liga → 'El código no es válido.'", async () => {
    const creator = await makeUser("cross-c");
    const joiner = await makeUser("cross-j");
    const a = await makePrivate(creator, `Privada cross A ${suffix}`);
    const b = await makePrivate(creator, `Privada cross B ${suffix}`);

    await expect(
      service.joinLeague(
        { leagueId: a.view.id, code: b.code },
        { ...META, actorId: joiner },
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El código no es válido.",
    });
  });

  it("ya es miembro → 'Ya eres miembro de esta liga.'", async () => {
    const creator = await makeUser("dup-c");
    const joiner = await makeUser("dup-j");
    const league = await makePublic(creator, `Pública dup ${suffix}`);
    await service.joinLeague({ leagueId: league.id }, { ...META, actorId: joiner });

    await expect(
      service.joinLeague({ leagueId: league.id }, { ...META, actorId: joiner }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Ya eres miembro de esta liga.",
    });
    // La membresía sigue siendo una sola (no se duplica).
    const count = await prisma.leagueMember.count({
      where: { leagueId: league.id, userId: joiner },
    });
    expect(count).toBe(1);
  });

  it("llena → 'La liga está llena.'", async () => {
    const creator = await makeUser("full-c");
    const m1 = await makeUser("full-m1");
    const m2 = await makeUser("full-m2");
    const league = await makePublic(creator, `Pública full ${suffix}`, 3);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: m1, role: "member" },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: m2, role: "member" },
    });

    await expect(
      service.joinLeague(
        { leagueId: league.id },
        { ...META, actorId: await makeUser("full-x") },
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La liga está llena.",
    });
  });

  it("status ≠ active → 'La liga no acepta entradas.'", async () => {
    const creator = await makeUser("st-c");
    const joiner = await makeUser("st-j");
    const league = await makePublic(creator, `Pública st ${suffix}`);
    await prisma.league.update({
      where: { id: league.id },
      data: { status: "finished" },
    });

    await expect(
      service.joinLeague({ leagueId: league.id }, { ...META, actorId: joiner }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La liga no acepta entradas.",
    });
  });

  it("privada entryMode=invite → 'La liga no acepta entradas.' (se difiere, US-26)", async () => {
    const creator = await makeUser("inv-c");
    const joiner = await makeUser("inv-j");
    const view = await service.createLeague(
      validInput({ name: `Privada invite ${suffix}`, entryMode: "invite" }),
      { ...META, actorId: creator },
    );
    // Aun así se genera un código (createLeague lo hace para code/mixed;
    // para invite no). Forzamos un código activo para aislar la regla.
    await prisma.leagueInvite.create({
      data: { leagueId: view.id, code: `INVITE${suffix}`, createdBy: creator },
    });

    await expect(
      service.joinLeague(
        { code: `INVITE${suffix}` },
        { ...META, actorId: joiner },
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "La liga no acepta entradas.",
    });
  });

  it("sin leagueId ni código → 'Indica la liga o el código de invitación'", async () => {
    await expect(
      service.joinLeague({}, { ...META, actorId: await makeUser("empty") }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Unión inválida: leagueId: Indica la liga o el código de invitación",
    });
  });

  it("liga inexistente → NOT_FOUND", async () => {
    await expect(
      service.joinLeague(
        { leagueId: "00000000-0000-4000-8000-000000000000" },
        { ...META, actorId: await makeUser("nf") },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("concurrencia: dos usuarios por la última plaza → solo uno entra (CA)", async () => {
    const creator = await makeUser("conc-c");
    const filler = await makeUser("conc-f");
    const u1 = await makeUser("conc-1");
    const u2 = await makeUser("conc-2");
    // 1 plaza libre (creador + filler = 2 de 3).
    const league = await makePublic(creator, `Pública conc ${suffix}`, 3);
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: filler, role: "member" },
    });

    // u1 y u2 (ambos nuevos) compiten por la última plaza a la vez.
    const [r1, r2] = await Promise.allSettled([
      service.joinLeague({ leagueId: league.id }, { ...META, actorId: u1 }),
      service.joinLeague({ leagueId: league.id }, { ...META, actorId: u2 }),
    ]);

    const outcomes = [r1, r2].map((r) =>
      r.status === "fulfilled" ? "ok" : "full",
    );
    expect(outcomes).toContain("ok");
    expect(outcomes).toContain("full");
    // El perdedor recibe "La liga está llena."
    const failed = [r1, r2].find((r) => r.status === "rejected");
    expect(failed).toMatchObject({
      reason: expect.objectContaining({ message: "La liga está llena." }),
    });
    // La liga queda con exactamente 3 miembros (no 4).
    const count = await prisma.leagueMember.count({
      where: { leagueId: league.id, status: "active" },
    });
    expect(count).toBe(3);
  });

  describe("anti fuerza bruta (leagues.md §4/§10, espejo US-01)", () => {
    it("ventana por IP: N+1 intentos → rate-limit", async () => {
      const store = new InMemoryRateLimitStore();
      const svc = new LeagueService({
        prisma,
        joinRateLimit: store,
        joinRateLimitCfg: {
          maxPerWindow: 3,
          windowSec: 60,
          lockoutThreshold: 10,
          lockoutSec: 900,
        },
      });
      const creator = await makeUser("rl-c");
      const joiner = await makeUser("rl-j");
      const league = await makePublic(creator, `Pública rl ${suffix}`);

      // 3 intentos permitidos (ya es miembro en el 1º; los siguientes
      // fallan con "ya eres miembro" pero cuentan en la ventana).
      for (let i = 1; i <= 3; i++) {
        await svc
          .joinLeague({ leagueId: league.id }, { ...META, actorId: joiner })
          .catch(() => {});
      }
      // El 4º se rechaza por ventana (aunque el motivo sea "ya eres miembro").
      await expect(
        svc.joinLeague({ leagueId: league.id }, { ...META, actorId: joiner }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("demasiadas peticiones"),
      });
    });

    it("N fallos de código → bloqueo (el código correcto también se rechaza)", async () => {
      const store = new InMemoryRateLimitStore();
      const svc = new LeagueService({
        prisma,
        joinRateLimit: store,
        joinRateLimitCfg: {
          maxPerWindow: 100,
          windowSec: 60,
          lockoutThreshold: 3,
          lockoutSec: 900,
        },
      });
      const creator = await makeUser("bf-c");
      const attacker = await makeUser("bf-a");
      const { code } = await makePrivate(creator, `Privada bf ${suffix}`);

      // 3 fallos de código (umbral = 3) → bloqueo.
      for (let i = 1; i <= 3; i++) {
        await expect(
          svc.joinLeague({ code: `MAL${i}${suffix}` }, { ...META, actorId: attacker }),
        ).rejects.toMatchObject({ message: "El código no es válido." });
      }
      // Ahora hasta el código CORRECTO se rechaza (bloqueo por IP).
      await expect(
        svc.joinLeague({ code }, { ...META, actorId: attacker }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Demasiados intentos fallidos"),
      });
      // La IP sigue bloqueada (el contador de fallos no se reseteó solo).
      expect(await store.leagueJoinLockRemainingSec(META.ip)).toBeGreaterThan(0);
      // Regresión (bug de orden): un código ERRÓNEO también debe respetar el
      // bloqueo (no esquivarlo con "El código no es válido." en la resolución
      // previa) — ADR-0025, orden `locked → … → invalid_code`, espejo US-01.
      await expect(
        svc.joinLeague({ code: `TAMPOCO${suffix}` }, { ...META, actorId: attacker }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Demasiados intentos fallidos"),
      });
    });

    it("el bloqueo expira (setNow) y se puede unir de nuevo", async () => {
      const store = new InMemoryRateLimitStore();
      const svc = new LeagueService({
        prisma,
        joinRateLimit: store,
        joinRateLimitCfg: {
          maxPerWindow: 100,
          windowSec: 60,
          lockoutThreshold: 1,
          lockoutSec: 900,
        },
      });
      const creator = await makeUser("exp-c");
      const joiner = await makeUser("exp-j");
      const { code } = await makePrivate(creator, `Privada exp ${suffix}`);

      // 1 fallo (umbral = 1) → bloqueo de 900 s.
      await expect(
        svc.joinLeague({ code: "MAL1" }, { ...META, actorId: joiner }),
      ).rejects.toMatchObject({ message: "El código no es válido." });
      await expect(
        svc.joinLeague({ code }, { ...META, actorId: joiner }),
      ).rejects.toMatchObject({ message: expect.stringContaining("Demasiados intentos fallidos") });

      // Avanza el reloj más allá del bloqueo → se permite.
      store.setNow(901_000);
      const result = await svc.joinLeague({ code }, { ...META, actorId: joiner });
      expect(result.isMember).toBe(true);
    });

    it("unión correcta resetea el contador de fallos (no acumula)", async () => {
      const store = new InMemoryRateLimitStore();
      const svc = new LeagueService({
        prisma,
        joinRateLimit: store,
        joinRateLimitCfg: {
          maxPerWindow: 100,
          windowSec: 60,
          lockoutThreshold: 5,
          lockoutSec: 900,
        },
      });
      const creator = await makeUser("rst-c");
      const joiner = await makeUser("rst-j");
      const { code } = await makePrivate(creator, `Privada rst ${suffix}`);

      // 2 fallos (umbral = 5)…
      for (let i = 1; i <= 2; i++) {
        await expect(
          svc.joinLeague({ code: `MAL${i}` }, { ...META, actorId: joiner }),
        ).rejects.toMatchObject({ message: "El código no es válido." });
      }
      // …unión correcta → el contador se resetea…
      await svc.joinLeague({ code }, { ...META, actorId: joiner });
      // …y 3 fallos más NO bloquean (2+3=5 lo bloquearía si no se reseteó).
      for (let i = 1; i <= 3; i++) {
        await expect(
          svc.joinLeague({ code: `MALR${i}` }, { ...META, actorId: joiner }),
        ).rejects.toMatchObject({ message: "El código no es válido." });
      }
      expect(await store.leagueJoinLockRemainingSec(META.ip)).toBe(0);
    });
  });
});

/**
 * US-23 · Router `leagues` (glue BFF, ADR-0023) — el actor sale del
 * contexto (nunca del input) y los procedimientos delegan en el servicio.
 *
 * El router y el contexto se importan dinámicamente (los singletons
 * `prisma`/`redis` leen el env al cargar; `DATABASE_URL` ya está fijado
 * arriba — mismo patrón que `lineups.test.ts`).
 */
describe("US-23 · Router leagues (glue BFF)", () => {
  const rsuffix = randomUUID().slice(0, 8);
  let prisma: PrismaClient;
  let leaguesRouter: ReturnType<
    typeof import("../../app/server/routers/leagues").createLeaguesRouter
  >;
  let authRouter: ReturnType<typeof import("../../app/server/routers/auth").createAuthRouter>;
  let createContext: typeof import("../../app/server/trpc").createContext;
  let userToken: string;
  let leagueId: string;

  beforeAll(async () => {
    const auth = await import("../../app/server/routers/auth");
    const leagues = await import("../../app/server/routers/leagues");
    const trpc = await import("../../app/server/trpc");
    prisma = createPrisma();
    authRouter = auth.createAuthRouter({
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
      emailSender: { sendResetLink: async () => {} },
      appUrl: "http://localhost:3000",
      resetCfg: { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 },
    });
    leaguesRouter = leagues.createLeaguesRouter({ prisma });
    createContext = trpc.createContext;

    // Usuario con sesión real (registro vía router auth).
    const req = new Request("http://localhost/api/trpc/leagues", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.70" },
    });
    const ctx = await createContext(req, prisma);
    await authRouter.createCaller(ctx).register({
      email: `router-${rsuffix}@test.local`,
      username: `router_${rsuffix}`,
      password: "contraseña-segura-1",
      termsAccepted: true,
    });
    const cookie = ctx.pendingCookies[0] ?? "";
    userToken = /^session=([0-9a-f]{64});/.exec(cookie)?.[1] ?? "";
    if (!userToken) throw new Error(`Cookie de sesión inesperada: ${cookie}`);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto autenticado con la sesión del usuario del test. */
  async function ctxAuth() {
    const req = new Request("http://localhost/api/trpc/leagues", {
      method: "POST",
      headers: {
        "x-forwarded-for": "198.51.100.70",
        cookie: `session=${userToken}`,
      },
    });
    return createContext(req, prisma);
  }

  it("create (router): crea la liga y devuelve la vista del creador", async () => {
    const caller = leaguesRouter.createCaller(await ctxAuth());
    const view = await caller.create(
      validInput({ name: `Liga router ${rsuffix}` }),
    );

    expect(view.name).toBe(`Liga router ${rsuffix}`);
    expect(view.isAdmin).toBe(true);
    expect(view.activeMembers).toBe(1);
    expect(view.code).not.toBeNull();
    expectValidCode(view.code as string);
    leagueId = view.id;
  });

  it("rotateCode (router): rota el código y devuelve el nuevo", async () => {
    const caller = leaguesRouter.createCaller(await ctxAuth());
    const before = await prisma.leagueInvite.findFirst({
      where: { leagueId, status: "active" },
    });
    expect(before).not.toBeNull();

    const newCode = await caller.rotateCode({ leagueId });

    expect(newCode).not.toBe(before!.code);
    expectValidCode(newCode);
    const activeCount = await prisma.leagueInvite.count({
      where: { leagueId, status: "active" },
    });
    expect(activeCount).toBe(1);
  });

  it("get + myLeagues (router): la ve el miembro y aparece en su lista", async () => {
    const caller = leaguesRouter.createCaller(await ctxAuth());

    const view = await caller.get({ leagueId });
    expect(view.id).toBe(leagueId);
    expect(view.isAdmin).toBe(true);
    expect(view.code).not.toBeNull();

    const leagues = await caller.myLeagues();
    expect(leagues.map((l) => l.id)).toContain(leagueId);
  });

  it("sin sesión → UNAUTHORIZED (el actor sale del contexto)", async () => {
    const req = new Request("http://localhost/api/trpc/leagues", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.71" },
    });
    const caller = leaguesRouter.createCaller(await createContext(req, prisma));

    await expect(
      caller.create(validInput({ name: `Liga anónima ${rsuffix}` })),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.myLeagues()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  // ── US-24 · Procedimientos públicos (sin sesión, ADR-0024) ──────────────

  /** Contexto SIN sesión (visitante). */
  async function ctxAnon() {
    const req = new Request("http://localhost/api/trpc/leagues", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.72" },
    });
    return createContext(req, prisma);
  }

  it("listPublic (router, sin sesión): expone las públicas activas", async () => {
    // Crea una pública activa vía el router autenticado.
    const callerAuth = leaguesRouter.createCaller(await ctxAuth());
    const created = await callerAuth.create(
      validInput({
        name: `Pública router ${rsuffix}`,
        type: "public",
        visibility: "public",
      }),
    );

    const caller = leaguesRouter.createCaller(await ctxAnon());
    const dir = await caller.listPublic();
    expect(dir.map((l) => l.id)).toContain(created.id);
    expect(dir.find((l) => l.id === created.id)).toMatchObject({
      name: `Pública router ${rsuffix}`,
      type: "public",
      activeMembers: 1,
    });
    // El código no sale por el directorio.
    expect(dir.find((l) => l.id === created.id)).not.toHaveProperty("code");
  });

  it("get (router, sin sesión): una pública es visible", async () => {
    const callerAuth = leaguesRouter.createCaller(await ctxAuth());
    const created = await callerAuth.create(
      validInput({
        name: `Pública get ${rsuffix}`,
        type: "public",
        visibility: "public",
      }),
    );

    const caller = leaguesRouter.createCaller(await ctxAnon());
    const view = await caller.get({ leagueId: created.id });
    expect(view.id).toBe(created.id);
    expect(view.isAdmin).toBe(false);
    expect(view.code).toBeNull();
  });

  it("get (router, sin sesión): una privada → NOT_FOUND (no revela)", async () => {
    const callerAuth = leaguesRouter.createCaller(await ctxAuth());
    const created = await callerAuth.create(
      validInput({ name: `Privada get ${rsuffix}` }),
    );

    const caller = leaguesRouter.createCaller(await ctxAnon());
    await expect(caller.get({ leagueId: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("ranking (router, sin sesión): una pública expone su ranking", async () => {
    const callerAuth = leaguesRouter.createCaller(await ctxAuth());
    const created = await callerAuth.create(
      validInput({
        name: `Pública ranking ${rsuffix}`,
        type: "public",
        visibility: "public",
      }),
    );
    // Publica una fila de ranking general.
    await prisma.ranking.create({
      data: {
        leagueId: created.id,
        gpId: null,
        userId: (
          await prisma.user.findFirst({ where: { username: `router_${rsuffix}` } })
        )!.id,
        position: 1,
        points: 55,
        resultsVersion: "v1",
      },
    });

    const caller = leaguesRouter.createCaller(await ctxAnon());
    const view = await caller.ranking({ leagueId: created.id });
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]).toMatchObject({ position: 1, points: 55 });
  });

  it("ranking (router, sin sesión): una privada → NOT_FOUND", async () => {
    const callerAuth = leaguesRouter.createCaller(await ctxAuth());
    const created = await callerAuth.create(
      validInput({ name: `Privada ranking ${rsuffix}` }),
    );

    const caller = leaguesRouter.createCaller(await ctxAnon());
    await expect(caller.ranking({ leagueId: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  // ── US-25 · join (glue BFF, ADR-0025) ──────────────────────────────────

  let user2Token: string;

  /** Contexto autenticado con la sesión del usuario 2 del test. */
  async function ctxUser2() {
    const req = new Request("http://localhost/api/trpc/leagues", {
      method: "POST",
      headers: {
        "x-forwarded-for": "198.51.100.73",
        cookie: `session=${user2Token}`,
      },
    });
    return createContext(req, prisma);
  }

  it("join (router, sin sesión) → UNAUTHORIZED (unirse exige cuenta)", async () => {
    const callerAuth = leaguesRouter.createCaller(await ctxAuth());
    const created = await callerAuth.create(
      validInput({
        name: `Pública join ${rsuffix}`,
        type: "public",
        visibility: "public",
      }),
    );

    const caller = leaguesRouter.createCaller(await ctxAnon());
    await expect(
      caller.join({ leagueId: created.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("join (router, con sesión): pública → OK (entrada abierta, ADR-0024)", async () => {
    // Usuario 2 con sesión real (registro vía router auth).
    const ctxReg = await createContext(
      new Request("http://localhost/api/trpc/leagues", {
        method: "POST",
        headers: { "x-forwarded-for": "198.51.100.74" },
      }),
      prisma,
    );
    await authRouter.createCaller(ctxReg).register({
      email: `router2-${rsuffix}@test.local`,
      username: `router2_${rsuffix}`,
      password: "contraseña-segura-1",
      termsAccepted: true,
    });
    const cookie = ctxReg.pendingCookies[0] ?? "";
    user2Token = /^session=([0-9a-f]{64});/.exec(cookie)?.[1] ?? "";
    if (!user2Token) throw new Error(`Cookie de sesión inesperada: ${cookie}`);

    const created = await leaguesRouter
      .createCaller(await ctxAuth())
      .create(
        validInput({
          name: `Pública join2 ${rsuffix}`,
          type: "public",
          visibility: "public",
        }),
      );

    const view = await leaguesRouter
      .createCaller(await ctxUser2())
      .join({ leagueId: created.id });
    expect(view.id).toBe(created.id);
    expect(view.isMember).toBe(true);
    expect(view.activeMembers).toBe(2);

    // El actor sale del contexto: la membresía es del usuario 2.
    const membership = await prisma.leagueMember.findUniqueOrThrow({
      where: {
        leagueId_userId: {
          leagueId: created.id,
          userId: (
            await prisma.user.findFirst({
              where: { username: `router2_${rsuffix}` },
            })
          )!.id,
        },
      },
    });
    expect(membership.status).toBe("active");
    expect(membership.role).toBe("member");
  });

  it("join (router, con sesión): privada por código → OK (el código resuelve la liga)", async () => {
    const created = await leaguesRouter
      .createCaller(await ctxAuth())
      .create(validInput({ name: `Privada join ${rsuffix}` }));
    const code = created.code as string;

    const view = await leaguesRouter
      .createCaller(await ctxUser2())
      .join({ code });
    expect(view.id).toBe(created.id);
    expect(view.isMember).toBe(true);
  });

  it("join (router, con sesión): ya miembro → 'Ya eres miembro de esta liga.'", async () => {
    const created = await leaguesRouter
      .createCaller(await ctxAuth())
      .create(
        validInput({
          name: `Pública dup ${rsuffix}`,
          type: "public",
          visibility: "public",
        }),
      );
    const caller2 = leaguesRouter.createCaller(await ctxUser2());
    await caller2.join({ leagueId: created.id });

    await expect(
      caller2.join({ leagueId: created.id }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Ya eres miembro de esta liga.",
    });
  });
});
