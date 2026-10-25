/**
 * Servicio de ligas (US-15, US-21, US-23).
 *
 * - **US-15 (dashboard):** `myRankings` — ligas activas del usuario + sus
 *   posiciones en `rankings` (por GP y general).
 * - **US-21 (rankings):** `recalculateRankings` — calcula y publica los
 *   rankings por GP y general a partir de `scores` (ADR-0022).
 * - **US-23 (creación de liga, ADR-0023):** `createLeague` (creador =
 *   admin; código de alta entropía si el modo lo requiere; auditoría
 *   `league.created`), `rotateCode` (solo admin; revoca el código
 *   anterior; auditoría `league.code_rotated`), `getLeague` (solo
 *   miembros activos; el código solo lo ve el admin) y `myLeagues`.
 *
 * El dashboard (US-15) muestra «posición en cada liga»: las ligas activas
 * del usuario (`league_members.status = active`) + sus posiciones en la
 * tabla `rankings` (por GP y general — `gpId` NULL). Los rankings son
 * DERIVADOS (data-model.md §5): los calcula el recálculo (US-18/US-19) y
 * los publica US-21; hasta entonces la vista es `null` (vacío elegante,
 * decisión US-15) y se llena sola cuando lleguen los datos.
 *
 * Multi-liga (invariante 4): los puntos por GP de un usuario son los
 * mismos en todas sus ligas; la posición SÍ es por liga.
 *
 * Las dependencias se inyectan (prisma, rate limit, límites de miembros):
 * el servicio se prueba sin los singletons de la app (mismo patrón que
 * `LineupService`).
 */
import { TRPCError } from "@trpc/server";
import type {
  LeagueEntryMode,
  LeagueType,
  LeagueVisibility,
  Prisma,
  PrismaClient,
  Ranking,
} from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import { PROVISIONAL_SEASON_RULES } from "@/shared/config";
import { createLeagueInputSchema } from "@/shared/validation/leagues";

import { canViewLeague, generateLeagueCode, sortRanking } from "./core";

export interface LeagueServiceDeps {
  prisma: PrismaClient;
  /**
   * Rate limit de creación de ligas (security.md §1.6, US-23). Opcional:
   * sin store no se aplica el límite (tests de servicio sin Redis).
   */
  rateLimit?: {
    recordLeagueCreation(
      userId: string,
      windowSec: number,
    ): Promise<{ count: number; remainingSec: number }>;
  };
  /** Configuración del rate limit de creación (US-23). */
  rateLimitCfg?: { maxPerWindow: number; windowSec: number };
  /**
   * Límites PROVISIONAL de miembros por liga (leagues.md §3: 2–50). Por
   * defecto `PROVISIONAL_SEASON_RULES.league` (shared/config, AGENTS.md
   * §1.3: no hardcodear parámetros de reglas).
   */
  leagueLimits?: { minMembers: number; maxMembers: number };
}

/** Metadatos del actor para auditoría (T-09). */
export interface AuditMeta {
  actorId: string;
  ip: string;
}

/** Miembro expuesto en la vista (US-24, leagues.md §9): solo seudónimo + rol. */
export interface LeagueMemberView {
  /** Seudónimo público (`profiles.displayName ?? users.username`); nunca PII. */
  username: string;
  role: "admin" | "member";
}

/** Vista de una liga para la UI (US-23, extendida por US-24). */
export interface LeagueView {
  id: string;
  name: string;
  description: string | null;
  type: LeagueType;
  visibility: LeagueVisibility;
  minMembers: number;
  maxMembers: number;
  entryMode: LeagueEntryMode;
  startDate: Date | null;
  endDate: Date | null;
  /** Miembros activos (status = active). */
  activeMembers: number;
  /**
   * Miembros activos con seudónimo + rol (US-24, leagues.md §9: solo el
   * nombre de usuario, nunca PII). Admins primero, luego por antigüedad.
   */
  members: LeagueMemberView[];
  /** El actor es admin de la liga (miembro activo con rol admin). */
  isAdmin: boolean;
  /**
   * Código activo: solo lo ve el admin (leagues.md §5); `null` si la liga
   * no tiene código activo (modo `invite` o sin rotar) o si el actor no es
   * admin (US-24: el código sigue siendo secreto también en ligas públicas).
   */
  code: string | null;
}

/** Resumen de una liga pública para el directorio (US-24, leagues.md §2). */
export interface PublicLeagueSummary {
  id: string;
  name: string;
  description: string | null;
  type: LeagueType;
  minMembers: number;
  maxMembers: number;
  entryMode: LeagueEntryMode;
  /** Miembros activos (status = active). */
  activeMembers: number;
  createdAt: Date;
}

/** Fila del ranking de una liga (US-24, leagues.md §8/§9): posición + seudónimo. */
export interface LeagueRankingEntry {
  position: number;
  /** Seudónimo público (`profiles.displayName ?? users.username`); nunca PII. */
  username: string;
  points: number;
}

/** Ranking de una liga (US-24): la última versión publicada (US-21/ADR-0022). */
export interface LeagueRankingView {
  /** Filas ordenadas por posición; `[]` si aún no hay ranking publicado. */
  entries: LeagueRankingEntry[];
  /** Momento del cálculo de la versión vigente (null si no hay filas). */
  computedAt: Date | null;
  /** Versión de resultados que la originó (null si no hay filas). */
  resultsVersion: string | null;
}

/** Posición del usuario en una liga (US-15): por GP y general. */
export interface MyLeagueRanking {
  leagueId: string;
  leagueName: string;
  /** Posición en el GP (null si aún no se ha calculado — US-21). */
  gpPosition: number | null;
  gpPoints: number | null;
  /** Posición general (ranking `gpId` NULL; null si aún no calculada). */
  overallPosition: number | null;
  overallPoints: number | null;
}

/** Fila de ranking con los campos que usa la vista. */
type RankingRow = Pick<Ranking, "leagueId" | "gpId" | "position" | "points" | "computedAt" | "createdAt">;

/**
 * La fila más reciente (por `computedAt`, y `createdAt` como desempate):
 * los rankings son versionados (`results_version`), y la última publicada
 * es la vigente (AGENTS.md §5: no hay cambios retroactivos silenciosos).
 */
function latestRanking(rows: readonly RankingRow[]): RankingRow | null {
  if (rows.length === 0) return null;
  return (
    [...rows].sort(
      (a, b) =>
        b.computedAt.getTime() - a.computedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )[0] ?? null
  );
}

export class LeagueService {
  constructor(private readonly deps: LeagueServiceDeps) {}

  // ── US-23 · Creación de liga privada con código (leagues.md §3) ────────

  /**
   * Crea una liga (US-23, leagues.md §3):
   * - El creador define nombre/descripción/tipo/visibilidad/min-máx/modo
   *   de entrada/duración.
   * - El creador es **admin** (miembro activo con rol admin).
   * - Si el modo de entrada lo requiere (`code`/`mixed`), se genera un
   *   código de alta entropía (≥8 chars, sin 0/O/1/I; `core/invite-code`).
   * - Rate limit por usuario (security.md §1.6: "creación de ligas").
   * - Auditoría `league.created` en la misma transacción (T-09). El código
   *   NO se registra en auditoría (es un secreto, como una contraseña).
   *
   * @throws {TRPCError} BAD_REQUEST si el payload no pasa la validación
   *   server-side (formato, límites de miembros, consistencia
   *   tipo/visibilidad) o si se supera el rate limit.
   */
  async createLeague(input: unknown, meta: AuditMeta): Promise<LeagueView> {
    const validated = this.validateCreation(input);
    const actorId = meta.actorId;

    // Rate limit por usuario (security.md §1.6). Solo si hay store
    // inyectado (producción y tests de integración).
    const rateLimit = this.deps.rateLimit;
    if (rateLimit) {
      const cfg = this.deps.rateLimitCfg ?? { maxPerWindow: 5, windowSec: 3600 };
      const { count, remainingSec } = await rateLimit.recordLeagueCreation(
        actorId,
        cfg.windowSec,
      );
      if (count > cfg.maxPerWindow && remainingSec > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Estás enviando demasiadas peticiones. Inténtalo de nuevo en ${Math.ceil(remainingSec)} s.`,
        });
      }
    }

    // Código si el modo de entrada lo requiere (leagues.md §3: "si el modo
    // lo requiere"): `code` y `mixed` sí; `invite` no (solo invitación).
    const code =
      validated.entryMode === "code" || validated.entryMode === "mixed"
        ? generateLeagueCode()
        : null;

    const league = await this.deps.prisma.$transaction(async (tx) => {
      const created = await tx.league.create({
        data: {
          name: validated.name,
          description: validated.description,
          type: validated.type,
          visibility: validated.visibility,
          minMembers: validated.minMembers,
          maxMembers: validated.maxMembers,
          entryMode: validated.entryMode,
          startDate: validated.startDate,
          endDate: validated.endDate,
          // La liga queda operativa al crearse (ADR-0023): el creador es el
          // admin y puede unirse a miembros de inmediato con el código.
          status: "active",
          members: {
            create: { userId: actorId, role: "admin" },
          },
          invites: code
            ? { create: { code, createdBy: actorId } }
            : undefined,
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.created",
        entity: "league",
        entityId: created.id,
        afterData: {
          name: created.name,
          type: created.type,
          visibility: created.visibility,
          entryMode: created.entryMode,
          minMembers: created.minMembers,
          maxMembers: created.maxMembers,
          // El código NO se registra (secreto): solo si se generó uno.
          codeGenerated: code !== null,
        },
        ip: meta.ip,
      });
      return created;
    });

    // La vista se lee tras la transacción (miembros + código + conteo).
    return this.toLeagueView(league.id, actorId);
  }

  /**
   * Rota el código de la liga (US-23, leagues.md §4: "generar nuevo código
   * invalida el anterior"):
   * - Solo el **admin** de la liga (leagues.md §5).
   * - Revoca todos los códigos activos y crea uno nuevo (transacción).
   * - Auditoría `league.code_rotated` (IDs de invitación, no el código).
   *
   * @returns el nuevo código.
   */
  async rotateCode(
    leagueId: string,
    actorId: string,
    meta: AuditMeta,
  ): Promise<string> {
    const league = await this.deps.prisma.league.findUnique({
      where: { id: leagueId },
    });
    if (!league) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }
    this.assertLeagueAdmin(
      await this.deps.prisma.leagueMember.findUnique({
        where: { leagueId_userId: { leagueId, userId: actorId } },
      }),
    );

    const newCode = generateLeagueCode();
    await this.deps.prisma.$transaction(async (tx) => {
      const revoked = await tx.leagueInvite.updateMany({
        where: { leagueId, status: "active" },
        data: { status: "revoked" },
      });
      const created = await tx.leagueInvite.create({
        data: { leagueId, code: newCode, createdBy: actorId },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.code_rotated",
        entity: "league",
        entityId: leagueId,
        beforeData: { revokedCount: revoked.count },
        afterData: { inviteId: created.id },
        ip: meta.ip,
      });
    });
    return newCode;
  }

  /**
   * Detalle de una liga (US-23, extendido por US-24, ADR-0024):
   * - **Pública** (`type = public`) ⇒ cualquiera la ve (autenticado o no).
   * - **Privada** (`type = private`) ⇒ solo miembros activos; un extraño
   *   (autenticado o no) recibe NOT_FOUND idéntico al de una liga inexistente
   *   (no se revela la existencia — leagues.md §9, US-24 CA, T-12 IDOR).
   *
   * El código solo lo devuelve el admin (leagues.md §5; US-24: sigue siendo
   * secreto también en ligas públicas). `userId` es `null` si no hay sesión.
   */
  async getLeague(leagueId: string, userId: string | null): Promise<LeagueView> {
    await this.assertCanView(leagueId, userId);
    return this.toLeagueView(leagueId, userId);
  }

  /**
   * Ranking de una liga (US-24, leagues.md §8/§9): la **última versión
   * publicada** (US-21/ADR-0022: la más reciente por `computedAt`) de
   * `rankings` — general (`gpId = null`) o por GP — con seudónimos (nunca
   * PII, leagues.md §9). Misma regla de acceso que el detalle: pública ⇒
   * cualquiera; privada ⇒ solo miembros activos (extraños → NOT_FOUND).
   *
   * Los rankings son DERIVADOS versionados (data-model.md §5, invariante 7):
   * se leen, no se recalculan en la lectura (el recálculo es el job de
   * US-18/US-19/US-21). Sin filas publicadas → vacío elegante (precedente
   * US-15).
   */
  async leagueRanking(
    leagueId: string,
    gpId: string | null,
    userId: string | null,
  ): Promise<LeagueRankingView> {
    await this.assertCanView(leagueId, userId);

    // Ancla de la versión vigente: la fila más reciente de esta (liga, GP).
    const anchor = await this.deps.prisma.ranking.findFirst({
      where: { leagueId, gpId },
      orderBy: [{ computedAt: "desc" }, { createdAt: "desc" }],
      select: { computedAt: true, resultsVersion: true },
    });
    if (!anchor) {
      return { entries: [], computedAt: null, resultsVersion: null };
    }

    // Toda la versión (mismo `computedAt` + `resultsVersion`), por posición.
    const rows = await this.deps.prisma.ranking.findMany({
      where: {
        leagueId,
        gpId,
        computedAt: anchor.computedAt,
        resultsVersion: anchor.resultsVersion,
      },
      select: {
        position: true,
        points: true,
        user: { select: { username: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { position: "asc" },
    });
    return {
      entries: rows.map((r) => ({
        position: r.position,
        username: r.user.profile?.displayName ?? r.user.username,
        points: Number(r.points),
      })),
      computedAt: anchor.computedAt,
      resultsVersion: anchor.resultsVersion,
    };
  }

  /** Ligas activas del usuario (US-23): detalle + código si es admin. */
  async myLeagues(userId: string): Promise<LeagueView[]> {
    const memberships = await this.deps.prisma.leagueMember.findMany({
      where: { userId, status: "active" },
      select: { leagueId: true },
      orderBy: { joinedAt: "asc" },
    });
    if (memberships.length === 0) return [];
    return Promise.all(memberships.map((m) => this.toLeagueView(m.leagueId, userId)));
  }

  /**
   * Directorio de ligas públicas (US-24, leagues.md §2/§9): solo las ligas
   * `type = public` y `status = active` (una pública `finished`/`archived` es
   * histórico — accesible por ID — pero no descubre ligas). Orden por nombre
   * (estable y predecible). Sin sesión: es público.
   *
   * El resumen no incluye el código (secreto, solo admin) ni la membresía.
   */
  async listPublic(): Promise<PublicLeagueSummary[]> {
    const leagues = await this.deps.prisma.league.findMany({
      where: { type: "public", status: "active" },
      orderBy: { name: "asc" },
    });
    if (leagues.length === 0) return [];

    const ids = leagues.map((l) => l.id);
    const counts = await this.deps.prisma.leagueMember.groupBy({
      by: ["leagueId"],
      where: { leagueId: { in: ids }, status: "active" },
      _count: { leagueId: true },
    });
    const countByLeague = new Map(counts.map((c) => [c.leagueId, c._count.leagueId]));

    return leagues.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      type: l.type,
      minMembers: l.minMembers,
      maxMembers: l.maxMembers,
      entryMode: l.entryMode,
      activeMembers: countByLeague.get(l.id) ?? 0,
      createdAt: l.createdAt,
    }));
  }

  // ── US-15 · Dashboard (lecturas de solo lectura) ───────────────────────

  /**
   * Ligas activas del usuario + sus posiciones (US-15, dashboard).
   * Si `gpId` se indica, incluye la posición en ese GP; la posición
   * general siempre. Sin ligas activas → `[]`; sin rankings calculados
   * (US-19/US-21 pendientes) → posiciones `null`.
   */
  async myRankings(
    userId: string,
    gpId: string | null,
  ): Promise<MyLeagueRanking[]> {
    const memberships = await this.deps.prisma.leagueMember.findMany({
      where: { userId, status: "active" },
      include: { league: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });
    if (memberships.length === 0) return [];

    const leagueIds = memberships.map((m) => m.leagueId);
    const rankings = await this.deps.prisma.ranking.findMany({
      where: { userId, leagueId: { in: leagueIds } },
      select: {
        leagueId: true,
        gpId: true,
        position: true,
        points: true,
        computedAt: true,
        createdAt: true,
      },
    });

    return memberships.map((m) => {
      const leagueRankings = rankings.filter((r) => r.leagueId === m.leagueId);
      const gpRow =
        gpId === null
          ? null
          : latestRanking(leagueRankings.filter((r) => r.gpId === gpId));
      const overallRow = latestRanking(
        leagueRankings.filter((r) => r.gpId === null),
      );
      return {
        leagueId: m.leagueId,
        leagueName: m.league.name,
        gpPosition: gpRow ? gpRow.position : null,
        gpPoints: gpRow ? Number(gpRow.points) : null,
        overallPosition: overallRow ? overallRow.position : null,
        overallPoints: overallRow ? Number(overallRow.points) : null,
      };
    });
  }

  // ── US-21 · Rankings por GP y general (ADR-0022) ───────────────────────

  /**
   * Calcula y publica los rankings de una liga a partir de `scores` (US-21).
   *
   * Se dispara al publicarse resultados definitivos (leagues.md §8: "los
   * rankings se recalculan al publicarse resultados definitivos y se
   * versionan"). Escribe:
   * - **Por GP** (una fila por GP de la temporada que tenga `scores`): orden
   *   por puntos de ese GP + desempates (leagues.md §8).
   * - **General** (fila `gpId` NULL): orden por suma de puntos de la
   *   temporada + los mismos desempates.
   *
   * Desempates (leagues.md §8, en orden): más GPs ganados → mejor último GP →
   * menor coste total de lineups → antigüedad. Los valores los aporta el
   * servicio (I/O); el orden lo aplica la fórmula pura `sortRanking` (`core`).
   *
   * Multi-liga (invariante 4): los puntos por GP son los mismos en todas las
   * ligas; la posición SÍ es por liga (los desempates de coste/antigüedad
   * pueden diferir).
   *
   * Solo se publican las ligas con miembros activos **que puntuaron** en la
   * temporada (derivado de `scores`, data-model.md §5): una liga donde nadie
   * puntuó no recibe filas (vacío elegante, US-15) y no se cuenta en el
   * retorno.
   *
   * @param gpId           GP que ha publicado resultados (ancla de la recalc.).
   * @param resultsVersion versión de resultados del GP (versiona los rankings).
   * @returns nº de ligas publicadas (con filas) + filas de ranking escritas.
   */
  async recalculateRankings(
    gpId: string,
    resultsVersion: string,
  ): Promise<{ leagues: number; rankings: number }> {
    const gp = await this.deps.prisma.gp.findUnique({ where: { id: gpId } });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }

    // 1. GPs de la temporada (orden por round; el último da "último GP").
    const seasonGps = await this.deps.prisma.gp.findMany({
      where: { seasonId: gp.seasonId },
      select: { id: true },
      orderBy: { round: "asc" },
    });
    const gpIds = seasonGps.map((g) => g.id);
    const lastGpId = seasonGps[seasonGps.length - 1]?.id ?? null;

    // 2. Scores de la temporada (gpId → userId → puntos). Solo GPs puntuados.
    const scores = await this.deps.prisma.score.findMany({
      where: { gpId: { in: gpIds } },
      select: { userId: true, gpId: true, pointsTotal: true },
    });
    const scoreByGpUser = new Map<string, Map<string, number>>();
    for (const s of scores) {
      const gpMap = scoreByGpUser.get(s.gpId) ?? new Map<string, number>();
      gpMap.set(s.userId, Number(s.pointsTotal));
      scoreByGpUser.set(s.gpId, gpMap);
    }

    // Usuarios que puntuaron en al menos un GP de la temporada. El ranking
    // es DERIVADO de `scores` (data-model.md §5): solo se publican filas para
    // los miembros con datos — una liga donde nadie puntuó no recibe ranking
    // (vacío elegante, US-15).
    const scoredUsers = new Set<string>();
    for (const gpMap of scoreByGpUser.values()) {
      for (const uid of gpMap.keys()) scoredUsers.add(uid);
    }

    // 3. Coste total de lineups por usuario (desempate 3).
    const costByUser = await this.totalCostByUser(gpIds);

    // 4. Miembros activos, agrupados por liga.
    const memberships = await this.deps.prisma.leagueMember.findMany({
      where: { status: "active" },
      select: { leagueId: true, userId: true, joinedAt: true },
    });
    const membersByLeague = new Map<string, { userId: string; joinedAt: Date }[]>();
    for (const m of memberships) {
      const list = membersByLeague.get(m.leagueId) ?? [];
      list.push({ userId: m.userId, joinedAt: m.joinedAt });
      membersByLeague.set(m.leagueId, list);
    }
    if (membersByLeague.size === 0) return { leagues: 0, rankings: 0 };

    // 5. Por liga: rankings por GP + general (orden: fórmula pura `sortRanking`).
    //    Solo se publican ligas donde algún miembro puntuó (derivado de scores).
    const now = new Date();
    const perGpRows: Prisma.RankingCreateManyInput[] = [];
    const overallRows: Prisma.RankingCreateManyInput[] = [];
    const publishedLeagues = new Set<string>();

    for (const [leagueId, members] of membersByLeague) {
      const memberIds = members.map((m) => m.userId);
      const joinedAtByUser = new Map(members.map((m) => [m.userId, m.joinedAt]));

      // Liga sin miembros que puntuaron → no se publica (vacío elegante).
      if (!memberIds.some((uid) => scoredUsers.has(uid))) continue;
      publishedLeagues.add(leagueId);

      // GPs ganados por usuario (1º por puntos, sin empate, entre miembros).
      const gpsWonByUser = new Map<string, number>();
      for (const g of seasonGps) {
        const gpMap = scoreByGpUser.get(g.id);
        if (!gpMap) continue;
        let maxPoints = -Infinity;
        for (const uid of memberIds) {
          const pts = gpMap.get(uid);
          if (pts !== undefined && pts > maxPoints) maxPoints = pts;
        }
        if (maxPoints === -Infinity) continue;
        const winners = memberIds.filter((uid) => gpMap.get(uid) === maxPoints);
        const winner = winners.length === 1 ? winners[0] : undefined;
        if (winner !== undefined) {
          gpsWonByUser.set(winner, (gpsWonByUser.get(winner) ?? 0) + 1);
        }
      }

      // Puntos del último GP (desempate 2; 0 si aún no puntuado).
      const lastGpMap = lastGpId ? scoreByGpUser.get(lastGpId) : undefined;
      const lastGpScore = (uid: string): number => lastGpMap?.get(uid) ?? 0;

      // Ranking por GP (solo GPs con `scores`).
      for (const g of seasonGps) {
        const gpMap = scoreByGpUser.get(g.id);
        if (!gpMap) continue;
        const sorted = sortRanking(
          memberIds
            .filter((uid) => gpMap.has(uid))
            .map((uid) => ({
              userId: uid,
              points: gpMap.get(uid)!,
              gpsWon: gpsWonByUser.get(uid) ?? 0,
              lastGpScore: lastGpScore(uid),
              totalCost: costByUser.get(uid) ?? 0,
              joinedAt: joinedAtByUser.get(uid)!,
            })),
        );
        sorted.forEach((r, i) => {
          perGpRows.push({
            leagueId,
            gpId: g.id,
            userId: r.userId,
            position: i + 1,
            points: r.points,
            tiebreakers: {
              gpsWon: r.gpsWon,
              lastGpScore: r.lastGpScore,
              totalCost: r.totalCost,
            },
            resultsVersion,
            computedAt: now,
          });
        });
      }

      // Ranking general (suma de puntos de la temporada).
      const totalPoints = (uid: string): number => {
        let total = 0;
        for (const g of seasonGps) {
          const pts = scoreByGpUser.get(g.id)?.get(uid);
          if (pts !== undefined) total += pts;
        }
        return total;
      };
      const overallSorted = sortRanking(
        memberIds
          .filter((uid) => scoredUsers.has(uid))
          .map((uid) => ({
            userId: uid,
            points: totalPoints(uid),
            gpsWon: gpsWonByUser.get(uid) ?? 0,
            lastGpScore: lastGpScore(uid),
            totalCost: costByUser.get(uid) ?? 0,
            joinedAt: joinedAtByUser.get(uid)!,
          })),
      );
      overallSorted.forEach((r, i) => {
        overallRows.push({
          leagueId,
          gpId: null,
          userId: r.userId,
          position: i + 1,
          points: r.points,
          tiebreakers: {
            gpsWon: r.gpsWon,
            lastGpScore: r.lastGpScore,
            totalCost: r.totalCost,
          },
          resultsVersion,
          computedAt: now,
        });
      });
    }

    // 6. Publicar (atómico): los rankings son versionados; la lectura (US-15)
    //    toma la más reciente por `computedAt`.
    await this.deps.prisma.$transaction(async (tx) => {
      if (perGpRows.length > 0) await tx.ranking.createMany({ data: perGpRows });
      if (overallRows.length > 0) await tx.ranking.createMany({ data: overallRows });
    });

    return { leagues: publishedLeagues.size, rankings: perGpRows.length + overallRows.length };
  }

  // ── Privados ────────────────────────────────────────────────────────────

  /**
   * Coste total de los lineups de la temporada por usuario (desempate 3:
   * "menor coste total de lineups"). Coste de un lineup = suma de los precios
   * de sus activos (slots) a los precios del GP (invariante 2). Sin precio
   * para un activo → no cuenta (el lineup no se habría podido guardar).
   */
  private async totalCostByUser(gpIds: string[]): Promise<Map<string, number>> {
    const lineups = await this.deps.prisma.lineup.findMany({
      where: { gpId: { in: gpIds } },
      select: { id: true, userId: true, gpId: true },
    });
    if (lineups.length === 0) return new Map();
    const lineupIds = lineups.map((l) => l.id);
    const [slots, prices] = await Promise.all([
      this.deps.prisma.lineupSlot.findMany({
        where: { lineupId: { in: lineupIds } },
        select: { lineupId: true, assetType: true, assetId: true },
      }),
      this.deps.prisma.price.findMany({
        where: { gpId: { in: gpIds } },
        select: { assetType: true, assetId: true, gpId: true, price: true },
      }),
    ]);

    const priceOf = new Map<string, number>();
    for (const p of prices) {
      priceOf.set(`${p.assetType}:${p.assetId}:${p.gpId}`, Number(p.price));
    }
    const slotsByLineup = new Map<string, { assetType: string; assetId: string }[]>();
    for (const s of slots) {
      const list = slotsByLineup.get(s.lineupId) ?? [];
      list.push({ assetType: s.assetType, assetId: s.assetId });
      slotsByLineup.set(s.lineupId, list);
    }

    const costByUser = new Map<string, number>();
    for (const l of lineups) {
      let cost = 0;
      for (const s of slotsByLineup.get(l.id) ?? []) {
        const price = priceOf.get(`${s.assetType}:${s.assetId}:${l.gpId}`);
        if (price !== undefined) cost += price;
      }
      costByUser.set(l.userId, (costByUser.get(l.userId) ?? 0) + cost);
    }
    return costByUser;
  }

  /**
   * Revalida el payload de creación server-side (el cliente nunca se confía
   * — AGENTS.md §8):
   * 1. Formato completo (`createLeagueInputSchema`).
   * 2. Límites de miembros PROVISIONAL (leagues.md §3: 2–50; desde
   *    `shared/config`, no hardcodeados — AGENTS.md §1.3).
   * 3. Consistencia tipo/visibilidad (leagues.md §2): privada ⇒ no pública;
   *    pública ⇒ visible en directorio.
   */
  private validateCreation(input: unknown): {
    name: string;
    description: string | null;
    type: LeagueType;
    visibility: LeagueVisibility;
    minMembers: number;
    maxMembers: number;
    entryMode: LeagueEntryMode;
    startDate: Date | null;
    endDate: Date | null;
  } {
    const result = createLeagueInputSchema.safeParse(input);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Liga inválida: ${issues}`,
      });
    }
    const v = result.data;
    const limits = this.deps.leagueLimits ?? PROVISIONAL_SEASON_RULES.league;

    if (v.minMembers < limits.minMembers) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El mínimo de miembros no puede ser inferior a ${limits.minMembers}.`,
      });
    }
    if (v.maxMembers > limits.maxMembers) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El máximo de miembros no puede superar ${limits.maxMembers}.`,
      });
    }
    if (v.type === "private" && v.visibility === "public") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Una liga privada no puede tener visibilidad pública.",
      });
    }
    if (v.type === "public" && v.visibility !== "public") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Una liga pública debe tener visibilidad pública.",
      });
    }

    return {
      name: v.name,
      description: v.description ?? null,
      type: v.type,
      visibility: v.visibility,
      minMembers: v.minMembers,
      maxMembers: v.maxMembers,
      entryMode: v.entryMode,
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
    };
  }

  /** Exige que la membresía sea de un ADMIN activo (leagues.md §5). */
  private assertLeagueAdmin(
    membership: { role: string; status: string } | null,
  ): void {
    if (!membership || membership.status !== "active" || membership.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Solo el admin de la liga puede hacer esta acción.",
      });
    }
  }

  /**
   * Regla de visibilidad (US-24, ADR-0024, `core/visibility`): pública ⇒
   * cualquiera; privada ⇒ solo miembro activo. Un extraño (autenticado o no)
   * recibe NOT_FOUND idéntico al de una liga inexistente: no se revela la
   * existencia (leagues.md §9, US-24 CA, T-12 IDOR).
   */
  private async assertCanView(
    leagueId: string,
    userId: string | null,
  ): Promise<void> {
    const league = await this.deps.prisma.league.findUnique({
      where: { id: leagueId },
    });
    if (!league) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }
    const membership = userId
      ? await this.deps.prisma.leagueMember.findUnique({
          where: { leagueId_userId: { leagueId, userId } },
        })
      : null;
    const isActiveMember =
      membership !== null && membership.status === "active";
    if (!canViewLeague(league, { isActiveMember })) {
      // Mismo error que "no existe": no se revela la existencia de ligas
      // privadas a extraños (leagues.md §9, US-24 CA).
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }
  }

  /**
   * Proyecta la vista de una liga para el actor (US-23, extendida por US-24):
   * detalle + miembros activos (seudónimos + rol) + código (solo admin;
   * leagues.md §5). `actorId` es `null` si no hay sesión (espectador público
   * de una liga pública): sin membresía, sin rol, sin código.
   */
  private async toLeagueView(
    leagueId: string,
    actorId: string | null,
  ): Promise<LeagueView> {
    const prisma = this.deps.prisma;
    const [league, activeInvite, activeMembers, memberRows] = await Promise.all([
      prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
      prisma.leagueInvite.findFirst({
        where: { leagueId, status: "active" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.leagueMember.count({ where: { leagueId, status: "active" } }),
      prisma.leagueMember.findMany({
        where: { leagueId, status: "active" },
        select: {
          role: true,
          joinedAt: true,
          user: { select: { username: true, profile: { select: { displayName: true } } } },
        },
        // Admins primero, luego por antigüedad (leagues.md §5: el admin gestiona).
        orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
      }),
    ]);
    const membership = actorId
      ? await prisma.leagueMember.findUnique({
          where: { leagueId_userId: { leagueId, userId: actorId } },
        })
      : null;
    const isAdmin =
      membership !== null &&
      membership.status === "active" &&
      membership.role === "admin";
    return {
      id: league.id,
      name: league.name,
      description: league.description,
      type: league.type,
      visibility: league.visibility,
      minMembers: league.minMembers,
      maxMembers: league.maxMembers,
      entryMode: league.entryMode,
      startDate: league.startDate,
      endDate: league.endDate,
      activeMembers,
      members: memberRows.map((m) => ({
        username: m.user.profile?.displayName ?? m.user.username,
        role: m.role,
      })),
      isAdmin,
      code: isAdmin ? (activeInvite?.code ?? null) : null,
    };
  }
}
