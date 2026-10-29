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
  League,
  LeagueEntryMode,
  LeagueType,
  LeagueVisibility,
  Prisma,
  PrismaClient,
  Ranking,
} from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import { PROVISIONAL_SEASON_RULES } from "@/shared/config";
import {
  createLeagueInputSchema,
  joinLeagueInputSchema,
  kickMemberInputSchema,
  leagueIdInputSchema,
  setMemberInvitesInputSchema,
  transferAdminInputSchema,
  updateLeagueInputSchema,
} from "@/shared/validation/leagues";

import {
  canInvite,
  canManageLeague,
  canViewLeague,
  evaluateLeagueJoin,
  generateLeagueCode,
  isMemberEligibleForGp,
  latestMembershipJoinedAt,
  shouldLockLeagueJoin,
  sortRanking,
  type LeagueAdminAction,
  type LeagueJoinReason,
  type LeagueMemberRole,
} from "./core";
import { addLeagueMemberInTransaction } from "./league-membership";

/**
 * Motivos de RECHAZO de la unión (US-25): todo `LeagueJoinReason` salvo
 * "ok". `joinRejection` es exhaustivo sobre esta unión (sin `default`
 * muerto): si el núcleo añade un motivo, el typecheck obliga a tratarlo.
 */
type LeagueJoinRejectionReason = Exclude<LeagueJoinReason, "ok">;

/** Rate limit de unión a ligas (US-25, security.md §1.6; frontera de I/O). */
export interface LeagueJoinRateLimit {
  /** Ventana fija por IP: todos los intentos de unión. */
  recordLeagueJoinAttempt(
    ip: string,
    windowSec: number,
  ): Promise<{ count: number; remainingSec: number }>;
  /** Fallo de código (contador consecutivo por IP). */
  recordLeagueJoinFailure(ip: string): Promise<number>;
  /** Borra los fallos de la IP (unión correcta). */
  resetLeagueJoinFailures(ip: string): Promise<void>;
  /** Bloquea la IP tras N fallos de código. */
  lockLeagueJoin(ip: string, lockoutSec: number): Promise<void>;
  /** Segundos restantes del bloqueo de la IP (0 si no está bloqueada). */
  leagueJoinLockRemainingSec(ip: string): Promise<number>;
}

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
   * Rate limit de unión a ligas (security.md §1.6, US-25/ADR-0025):
   * ventana por IP + bloqueo por fallos de código. Opcional: sin store no
   * se aplica el límite (tests de servicio sin Redis).
   */
  joinRateLimit?: LeagueJoinRateLimit;
  /** Configuración del rate limit de unión (US-25; parámetros operativos). */
  joinRateLimitCfg?: {
    maxPerWindow: number;
    windowSec: number;
    lockoutThreshold: number;
    lockoutSec: number;
  };
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

/** Miembro expuesto en la vista (US-24, leagues.md §9): seudónimo + rol. */
export interface LeagueMemberView {
  /**
   * Identificador del usuario (UUID opaco, no PII): lo necesita el admin para
   * dirigir acciones (transferir/expulsar, US-26).
   */
  userId: string;
  /** Seudónimo público (`profiles.displayName ?? users.username`); nunca PII. */
  username: string;
  role: "admin" | "member";
  /**
   * Estado de la membresía (US-27, ADR-0027): `left` (se fue voluntariamente)
   * o `kicked` (expulsado por el admin). Solo presente en `formerMembers`;
   * los de `members` son activos (ausente).
   */
  status?: "left" | "kicked";
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
  /**
   * El admin ha habilitado que los miembros vean/compartan el código de
   * invitación (US-26, leagues.md §5: "invitar solo si el admin lo habilita").
   */
  allowMemberInvites: boolean;
  /** US-30: general desde la entrada del último miembro (D-10: off por defecto). */
  adjustedRankingEnabled: boolean;
  startDate: Date | null;
  endDate: Date | null;
  /** Miembros activos (status = active). */
  activeMembers: number;
  /**
   * Miembros activos con seudónimo + rol (US-24, leagues.md §9: solo el
   * nombre de usuario, nunca PII). Admins primero, luego por antigüedad.
   */
  members: LeagueMemberView[];
  /**
   * Miembros que salieron (`left`) o fueron expulsados (`kicked`) — US-27,
   * ADR-0027: se muestran marcados "retirado"/"expulsado" en el detalle; el
   * histórico de puntos se conserva (append-only, US-21/ADR-0022).
   */
  formerMembers: LeagueMemberView[];
  /** El actor es miembro activo de la liga (US-25: la UI oculta el botón de unión). */
  isMember: boolean;
  /** El actor es admin de la liga (miembro activo con rol admin). */
  isAdmin: boolean;
  /**
   * Código activo: lo ve el admin siempre (leagues.md §5) y el miembro solo
   * si el admin lo habilita (`allowMemberInvites`, US-26); `null` si la liga
   * no tiene código activo (modo `invite` o sin rotar) o si el actor no puede
   * verlo (US-24: el código sigue siendo secreto por defecto).
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
          adjustedRankingEnabled: validated.adjustedRankingEnabled,
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
          adjustedRankingEnabled: created.adjustedRankingEnabled,
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
    // US-26 (leagues.md §5): solo el admin revoca/genera código — regla pura
    // `canManageLeague` (fuente única, T-08); un miembro recibe 403.
    await this.assertCanManage(leagueId, actorId, "rotate_code");

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

  // ── US-26 · Permisos de liga (admin/miembro, leagues.md §5, ADR-0026) ──
  //
  // Todas las acciones de gestión son EXCLUSIVAS del admin (regla pura
  // `canManageLeague`, fuente única T-08). Un miembro que intente cualquiera
  // de ellas recibe 403 FORBIDDEN (CA de US-26). Los métodos revalidan el
  // payload server-side (AGENTS.md §8) y auditan en la misma transacción.

  /**
   * Cambia la configuración de la liga (US-26, leagues.md §5: "Cambiar
   * nombre/descripción/visibilidad" — solo admin):
   * - Solo el **admin** (un miembro → 403, CA de US-26).
   * - Actualización parcial (nombre/descripción/visibilidad), revalidada
   *   server-side; la consistencia tipo/visibilidad se mantiene (leagues.md §2).
   * - Auditoría `league.updated` (antes/después) en la misma transacción.
   *
   * @throws {TRPCError} BAD_REQUEST si el payload no pasa la validación o la
   *   visibilidad resulta inconsistente con el tipo; FORBIDDEN si el actor no
   *   es admin; NOT_FOUND si la liga no existe (o es privada a un extraño).
   */
  async updateLeague(
    leagueId: string,
    input: unknown,
    actorId: string,
    meta: AuditMeta,
  ): Promise<LeagueView> {
    const result = updateLeagueInputSchema.safeParse(input);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Cambio inválido: ${issues}`,
      });
    }
    const v = result.data;
    const league = await this.assertCanManage(leagueId, actorId, "update");

    // Consistencia tipo/visibilidad (leagues.md §2), solo si se cambia.
    if (v.visibility !== undefined) {
      if (league.type === "private" && v.visibility === "public") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Una liga privada no puede tener visibilidad pública.",
        });
      }
      if (league.type === "public" && v.visibility !== "public") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Una liga pública debe tener visibilidad pública.",
        });
      }
    }

    const data: {
      name?: string;
      description?: string | null;
      visibility?: LeagueVisibility;
      adjustedRankingEnabled?: boolean;
    } = {};
    if (v.name !== undefined) data.name = v.name;
    if (v.description !== undefined) data.description = v.description;
    if (v.visibility !== undefined) data.visibility = v.visibility;
    if (v.adjustedRankingEnabled !== undefined) {
      data.adjustedRankingEnabled = v.adjustedRankingEnabled;
    }

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.league.update({ where: { id: leagueId }, data });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.updated",
        entity: "league",
        entityId: leagueId,
        beforeData: {
          name: league.name,
          description: league.description,
          visibility: league.visibility,
          adjustedRankingEnabled: league.adjustedRankingEnabled,
        },
        afterData: data,
        ip: meta.ip,
      });
    });

    return this.toLeagueView(leagueId, actorId);
  }

  /**
   * Transfiere el rol de admin a otro miembro (US-26, leagues.md §5:
   * "Transferir admin" — solo admin):
   * - Solo el **admin** actual (un miembro → 403, CA de US-26).
   * - El destino debe ser un **miembro activo** de la liga.
   * - El admin transferente pasa a `member` (queda un solo admin; la
   *   integridad la garantiza la transacción).
   * - Auditoría `league.admin_transferred` en la misma transacción.
   *
   * @throws {TRPCError} BAD_REQUEST si el destino no es miembro activo o si
   *   el actor intenta transferirse a sí mismo; FORBIDDEN si el actor no es
   *   admin; NOT_FOUND si la liga no existe (o es privada a un extraño).
   */
  async transferAdmin(
    leagueId: string,
    targetUserId: string,
    actorId: string,
    meta: AuditMeta,
  ): Promise<LeagueView> {
    transferAdminInputSchema.parse({ leagueId, targetUserId });
    await this.assertCanManage(leagueId, actorId, "transfer_admin");

    if (targetUserId === actorId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No puedes transferirte el rol a ti mismo.",
      });
    }
    const target = await this.deps.prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: targetUserId } },
    });
    if (!target || target.status !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El destino debe ser un miembro activo de la liga.",
      });
    }

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.leagueMember.update({
        where: { leagueId_userId: { leagueId, userId: targetUserId } },
        data: { role: "admin" },
      });
      // El admin transferente pasa a miembro (queda un solo admin).
      await tx.leagueMember.update({
        where: { leagueId_userId: { leagueId, userId: actorId } },
        data: { role: "member" },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.admin_transferred",
        entity: "league",
        entityId: leagueId,
        afterData: { newAdminId: targetUserId, previousAdminId: actorId },
        ip: meta.ip,
      });
    });

    return this.toLeagueView(leagueId, actorId);
  }

  /**
   * Expulsa a un miembro (US-26, leagues.md §5: "Expulsar miembro" — solo
   * admin):
   * - Solo el **admin** (un miembro → 403, CA de US-26).
   * - El destino debe ser un **miembro activo** de la liga (no a sí mismo:
   *   la salida voluntaria del admin es US-27).
   * - El miembro queda marcado `kicked` (soft delete; el histórico de puntos
   *   se conserva — la semántica de histórico/lineups la completa US-27).
   * - Auditoría `league.member_kicked` en la misma transacción.
   *
   * @throws {TRPCError} BAD_REQUEST si el destino no es miembro activo o si
   *   el actor intenta expulsarse a sí mismo; FORBIDDEN si el actor no es
   *   admin; NOT_FOUND si la liga no existe (o es privada a un extraño).
   */
  async kickMember(
    leagueId: string,
    targetUserId: string,
    actorId: string,
    meta: AuditMeta,
  ): Promise<LeagueView> {
    kickMemberInputSchema.parse({ leagueId, targetUserId });
    await this.assertCanManage(leagueId, actorId, "kick");

    if (targetUserId === actorId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No puedes expulsarte a ti mismo.",
      });
    }
    const target = await this.deps.prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: targetUserId } },
    });
    if (!target || target.status !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El destino debe ser un miembro activo de la liga.",
      });
    }

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.leagueMember.update({
        where: { leagueId_userId: { leagueId, userId: targetUserId } },
        data: { status: "kicked", leftAt: new Date() },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.member_kicked",
        entity: "league",
        entityId: leagueId,
        afterData: { kickedUserId: targetUserId },
        ip: meta.ip,
      });
    });

    return this.toLeagueView(leagueId, actorId);
  }

  /**
   * Cierra la liga (US-26, leagues.md §5: "Cerrar la liga" — solo admin):
   * - Solo el **admin** (un miembro → 403, CA de US-26).
   * - La liga pasa a `finished` (no se borra: el histórico se conserva —
   *   leagues.md §11; la liberación de lineups la completa US-27).
   * - Auditoría `league.closed` en la misma transacción.
   *
   * @throws {TRPCError} BAD_REQUEST si la liga ya no está activa; FORBIDDEN
   *   si el actor no es admin; NOT_FOUND si la liga no existe (o es privada
   *   a un extraño).
   */
  async closeLeague(
    leagueId: string,
    actorId: string,
    meta: AuditMeta,
  ): Promise<LeagueView> {
    const league = await this.assertCanManage(leagueId, actorId, "close");

    if (league.status !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "La liga ya no está activa.",
      });
    }

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.league.update({
        where: { id: leagueId },
        data: { status: "finished" },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.closed",
        entity: "league",
        entityId: leagueId,
        beforeData: { status: "active" },
        afterData: { status: "finished" },
        ip: meta.ip,
      });
    });

    return this.toLeagueView(leagueId, actorId);
  }

  /**
   * Habilita/deshabilita que los miembros vean/compartan el código de
   * invitación (US-26, leagues.md §5: "invitar solo si el admin lo habilita"
   * — solo admin):
   * - Solo el **admin** (un miembro → 403, CA de US-26).
   * - Activa/desactiva `leagues.allow_member_invites`; la visibilidad del
   *   código para el miembro la decide la regla pura `canInvite` (US-26).
   * - Auditoría `league.member_invites_changed` en la misma transacción.
   *
   * @throws {TRPCError} FORBIDDEN si el actor no es admin; NOT_FOUND si la
   *   liga no existe (o es privada a un extraño).
   */
  async setMemberInvites(
    leagueId: string,
    enabled: boolean,
    actorId: string,
    meta: AuditMeta,
  ): Promise<LeagueView> {
    setMemberInvitesInputSchema.parse({ leagueId, enabled });
    const league = await this.assertCanManage(leagueId, actorId, "update");

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.league.update({
        where: { id: leagueId },
        data: { allowMemberInvites: enabled },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.member_invites_changed",
        entity: "league",
        entityId: leagueId,
        beforeData: { allowMemberInvites: league.allowMemberInvites },
        afterData: { allowMemberInvites: enabled },
        ip: meta.ip,
      });
    });

    return this.toLeagueView(leagueId, actorId);
  }

  // ── US-27 · Salir de la liga (ADR-0027) ──────────────────────────────────

  /**
   * Sale el actor de la liga (US-27, ADR-0027, leagues.md §5/§11):
   * - Solo un **miembro activo** puede salir (no un miembro `left`/`kicked`
   *   ni un extraño).
   * - El **admin NO puede salir**: debe transferir primero el rol a otro
   *   miembro activo (decisión ADR-0027, consistente con US-26: un solo
   *   admin, transferencia explícita).
   * - La membresía pasa a `left` + `leftAt` (soft delete; el histórico de
   *   puntos se conserva — append-only, US-21/ADR-0022; el ranking de los
   *   demás no se recalcula hacia atrás).
   * - Auditoría `league.left` en la misma transacción.
   *
   * @throws {TRPCError} NOT_FOUND si la liga no existe (o es privada a un
   *   extraño); BAD_REQUEST si el actor no es miembro activo o es el admin.
   */
  async leaveLeague(
    leagueId: string,
    actorId: string,
    meta: AuditMeta,
  ): Promise<LeagueView> {
    leagueIdInputSchema.parse({ leagueId });

    const league = await this.deps.prisma.league.findUnique({
      where: { id: leagueId },
    });
    if (!league) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }

    const membership = await this.deps.prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: actorId } },
    });
    if (!membership || membership.status !== "active") {
      // Privada a un extraño: NOT_FOUND (no revelar la existencia, ADR-0024);
      // miembro ya salido/expulsado: BAD_REQUEST (ya no es miembro activo).
      if (league.type === "private" && membership === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
      }
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Solo un miembro activo puede salir de la liga.",
      });
    }

    // El admin no puede salir: debe transferir primero el rol (ADR-0027).
    if (membership.role === "admin") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Transfiere el rol de admin a otro miembro antes de salir de la liga.",
      });
    }

    await this.deps.prisma.$transaction(async (tx) => {
      await tx.leagueMember.update({
        where: { leagueId_userId: { leagueId, userId: actorId } },
        data: { status: "left", leftAt: new Date() },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "league.left",
        entity: "league",
        entityId: leagueId,
        beforeData: { userId: actorId, status: "active" },
        afterData: { userId: actorId, status: "left" },
        ip: meta.ip,
      });
    });

    return this.toLeagueView(leagueId, actorId);
  }

  // ── US-25 · Unirse a una liga por código o entrada abierta (ADR-0025) ──

  /**
   * Se une el actor a una liga (US-25, leagues.md §2/§4/§6/§10, ADR-0025):
   * - **Pública:** entrada abierta por `leagueId` (ADR-0024, sin código).
   * - **Privada:** por `code` (el código resuelve la liga) o `leagueId` +
   *   `code`; el código debe ser una invitación ACTIVA de la liga.
   * - Validaciones server-side con motivo explícito (leagues.md §6):
   *   "La liga no acepta entradas." (status ≠ active; privada
   *   `entryMode=invite` — la invitación directa se difiere, US-26; privada
   *   sin código activo), "El código no es válido.", "Ya eres miembro de
   *   esta liga." (leagues.md §4: no se puede unirse dos veces) y "La liga
   *   está llena." (leagues.md §2: "abierta con límite").
   * - Anti fuerza bruta (leagues.md §4/§10, espejo del login US-01):
   *   ventana por IP en todos los intentos + bloqueo por IP tras N fallos
   *   de código consecutivos (solo "código no válido" cuenta como fallo;
   *   el contador se resetea con la unión correcta).
   * - Transaccional (CA): lock `FOR UPDATE` de la fila de la liga →
   *   recontar miembros activos → insertar membresía → auditoría
   *   `league.joined`. Dos uniones concurrentes por la última plaza: solo
   *   una entra (el unique `(leagueId, userId)` es el backstop).
   * - El código NO se registra en auditoría (secreto, ADR-0023).
   *
   * @throws {TRPCError} BAD_REQUEST con el motivo explícito; NOT_FOUND si la
   *   liga no existe.
   */
  async joinLeague(input: unknown, meta: AuditMeta): Promise<LeagueView> {
    const result = joinLeagueInputSchema.safeParse(input);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unión inválida: ${issues}`,
      });
    }
    // `.nullish()` admite `null` (cliente que envía campos explícitos): se
    // normaliza a "no indicado" (AGENTS.md §8: el servidor manda).
    const leagueId = result.data.leagueId ?? undefined;
    const code = result.data.code ?? undefined;
    const actorId = meta.actorId;
    const ip = meta.ip;

    const joinRL = this.deps.joinRateLimit;
    const cfg =
      this.deps.joinRateLimitCfg ??
      ({
        maxPerWindow: 10,
        windowSec: 60,
        lockoutThreshold: 5,
        lockoutSec: 900,
      } as const);

    // 1) Ventana por IP (todos los intentos; el store incrementa antes de
    //    decidir, patrón US-01). Sin store inyectado: sin límite.
    let ipWindowCount = 0;
    let ipWindowRemainingSec = 0;
    if (joinRL) {
      const w = await joinRL.recordLeagueJoinAttempt(ip, cfg.windowSec);
      ipWindowCount = w.count;
      ipWindowRemainingSec = w.remainingSec;
    }

    // 2) Bloqueo por IP — PRIORIDAD TOTAL, como el login US-01: se consulta
    //    ANTES de resolver el código (el orden de la regla pura es
    //    `locked → … → invalid_code`, ADR-0025). Sin este check previo, un
    //    código erróneo lanzaría "El código no es válido." en el paso 3 y
    //    esquivaría el bloqueo: la IP bloqueada seguiría iterando códigos.
    let ipLockRemainingSec = 0;
    if (joinRL) {
      ipLockRemainingSec = await joinRL.leagueJoinLockRemainingSec(ip);
      if (ipLockRemainingSec > 0) {
        throw this.joinRejection({
          reason: "locked",
          retryAfterSec: Math.ceil(ipLockRemainingSec),
        });
      }
    }

    // 3) Resolver la liga: por el código (invite activa) o por leagueId.
    let resolvedLeagueId: string;
    let codeValid = false;
    if (code !== undefined) {
      const invite = await this.deps.prisma.leagueInvite.findUnique({
        where: { code },
      });
      if (!invite || invite.status !== "active") {
        await this.registerJoinFailure(ip, cfg);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El código no es válido.",
        });
      }
      codeValid = true;
      resolvedLeagueId = invite.leagueId;
      // Código de OTRA liga que no coincide con la indicada: mismo motivo
      // (no revelar cuál de los dos es el error).
      if (leagueId !== undefined && leagueId !== invite.leagueId) {
        await this.registerJoinFailure(ip, cfg);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El código no es válido.",
        });
      }
    } else {
      // El schema (`joinLeagueInputSchema`) garantiza al menos uno de
      // leagueId/código; aquí el código es undefined, así que leagueId está
      // definido (la revalidación la hace el schema, AGENTS.md §8).
      resolvedLeagueId = leagueId as string;
    }

    const league = await this.deps.prisma.league.findUnique({
      where: { id: resolvedLeagueId },
    });
    if (!league) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }

    // 4) Estado para la regla pura (leagues/core/join, ADR-0025). El
    //    bloqueo ya se rechazó arriba; aquí solo se pasa el estado (0) por
    //    si se reordena — la regla pura lo contempla como prioridad 1.
    const [membership, activeMembers, activeInvite] = await Promise.all([
      this.deps.prisma.leagueMember.findUnique({
        where: { leagueId_userId: { leagueId: resolvedLeagueId, userId: actorId } },
      }),
      this.deps.prisma.leagueMember.count({
        where: { leagueId: resolvedLeagueId, status: "active" },
      }),
      this.deps.prisma.leagueInvite.findFirst({
        where: { leagueId: resolvedLeagueId, status: "active" },
        select: { id: true },
      }),
    ]);

    const decision = evaluateLeagueJoin(
      {
        ipWindowCount,
        ipWindowRemainingSec,
        ipLockRemainingSec,
        status: league.status,
        type: league.type,
        entryMode: league.entryMode,
        hasActiveCode: activeInvite !== null,
        codeProvided: code !== undefined,
        codeValid,
        isActiveMember: membership !== null && membership.status === "active",
        activeMembers,
        maxMembers: league.maxMembers,
      },
      { maxPerWindow: cfg.maxPerWindow },
    );
    if (!decision.allowed) {
      // Solo el fallo de código cuenta para el bloqueo (leagues.md §4).
      if (decision.reason === "invalid_code") {
        await this.registerJoinFailure(ip, cfg);
      }
      // `!allowed` ⇒ el motivo es de rechazo (nunca "ok"; el núcleo solo
      // devuelve "ok" con `allowed: true`).
      throw this.joinRejection({
        reason: decision.reason as LeagueJoinRejectionReason,
        retryAfterSec: decision.retryAfterSec,
      });
    }

    // 4) Transacción (CA: "unirse es transaccional"): la operación común
    //    bloquea la liga, revalida estado/plaza, reactiva o crea la membresía
    //    y audita. En reentrada reinicia `joinedAt` (US-30: no se recuperan
    //    los GPs jugados fuera de la liga).
    await this.deps.prisma.$transaction(async (tx) => {
      await addLeagueMemberInTransaction(tx, {
        leagueId: resolvedLeagueId,
        userId: actorId,
        actorId,
        ip,
        // El código NO se registra (secreto, ADR-0023): solo el canal.
        via: code !== undefined ? "code" : "open",
      });
    });

    // 5) Éxito: resetear el contador de fallos de la IP (patrón US-01).
    if (joinRL) {
      await joinRL.resetLeagueJoinFailures(ip);
    }

    return this.toLeagueView(resolvedLeagueId, actorId);
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

    // 1. GPs de la temporada: round ordena y lockoutAt/date fija el corte de
    //    entrada (US-30; nunca se usa el reloj actual para decidir elegibilidad).
    const seasonGps = await this.deps.prisma.gp.findMany({
      where: { seasonId: gp.seasonId },
      select: { id: true, date: true, lockoutAt: true },
      orderBy: { round: "asc" },
    });
    const gpIds = seasonGps.map((g) => g.id);

    // 2. Scores y costes por GP. Los scores siguen siendo globales (multi-liga);
    //    la elegibilidad solo filtra el DERIVADO de cada liga.
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
    const costByUserGp = await this.lineupCostByUserAndGp(gpIds);

    // 3. Miembros activos y opción de ranking ajustado por liga.
    const [memberships, leagues] = await Promise.all([
      this.deps.prisma.leagueMember.findMany({
        where: { status: "active" },
        select: { leagueId: true, userId: true, joinedAt: true },
      }),
      this.deps.prisma.league.findMany({
        select: { id: true, adjustedRankingEnabled: true },
      }),
    ]);
    const membersByLeague = new Map<string, { userId: string; joinedAt: Date }[]>();
    for (const m of memberships) {
      const list = membersByLeague.get(m.leagueId) ?? [];
      list.push({ userId: m.userId, joinedAt: m.joinedAt });
      membersByLeague.set(m.leagueId, list);
    }
    if (membersByLeague.size === 0) return { leagues: 0, rankings: 0 };
    const adjustedByLeague = new Map(
      leagues.map((league) => [league.id, league.adjustedRankingEnabled]),
    );

    const now = new Date();
    const perGpRows: Prisma.RankingCreateManyInput[] = [];
    const overallRows: Prisma.RankingCreateManyInput[] = [];
    const publishedLeagues = new Set<string>();

    for (const [leagueId, members] of membersByLeague) {
      const rowsBefore = perGpRows.length + overallRows.length;
      const memberIds = members.map((m) => m.userId);
      const joinedAtByUser = new Map(members.map((m) => [m.userId, m.joinedAt]));

      // Conjunto de GPs elegibles por miembro. En el ranking normal es su
      // propio joinedAt; en el ajustado se sustituye por el corte común.
      const eligibilityFrom = (cutoffByUser: Map<string, Date>) =>
        new Map(
          members.map((member) => [
            member.userId,
            new Set(
              seasonGps
                .filter((g) =>
                  isMemberEligibleForGp(cutoffByUser.get(member.userId)!, g),
                )
                .map((g) => g.id),
            ),
          ]),
        );
      const normalEligibility = eligibilityFrom(joinedAtByUser);

      // Puntos y TODOS los desempates salen del mismo conjunto de GPs. Así un
      // recién llegado no hereda ventaja por victorias, último GP o costes.
      const buildStats = (eligibleByUser: Map<string, Set<string>>) => {
        const stats = new Map(
          memberIds.map((uid) => {
            const eligible = eligibleByUser.get(uid)!;
            let points = 0;
            let totalCost = 0;
            let hasScores = false;
            for (const eligibleGpId of eligible) {
              const score = scoreByGpUser.get(eligibleGpId)?.get(uid);
              if (score !== undefined) {
                points += score;
                hasScores = true;
              }
              totalCost += costByUserGp.get(`${uid}:${eligibleGpId}`) ?? 0;
            }
            const lastEligibleGp = [...seasonGps].reverse().find((g) => eligible.has(g.id));
            const value = {
              points,
              gpsWon: 0,
              lastGpScore: lastEligibleGp
                ? (scoreByGpUser.get(lastEligibleGp.id)?.get(uid) ?? 0)
                : 0,
              totalCost,
              hasScores,
            };
            return [uid, value] as const;
          }),
        );

        // Un GP solo lo puede ganar quien era elegible en ese GP; empate en el
        // primer puesto no concede victoria (regla existente de US-21).
        for (const g of seasonGps) {
          const gpMap = scoreByGpUser.get(g.id);
          if (!gpMap) continue;
          const participants = memberIds.filter(
            (uid) => eligibleByUser.get(uid)!.has(g.id) && gpMap.has(uid),
          );
          if (participants.length === 0) continue;
          const maxPoints = Math.max(...participants.map((uid) => gpMap.get(uid)!));
          const winners = participants.filter((uid) => gpMap.get(uid) === maxPoints);
          if (winners.length === 1) stats.get(winners[0]!)!.gpsWon += 1;
        }
        return stats;
      };

      const normalStats = buildStats(normalEligibility);

      // Ranking por GP: solo miembros que ya habían entrado antes del inicio
      // efectivo de ESE GP y que tienen score en él.
      for (const g of seasonGps) {
        const gpMap = scoreByGpUser.get(g.id);
        if (!gpMap) continue;
        const sorted = sortRanking(
          memberIds
            .filter((uid) => normalEligibility.get(uid)!.has(g.id) && gpMap.has(uid))
            .map((uid) => {
              const stats = normalStats.get(uid)!;
              return {
                userId: uid,
                points: gpMap.get(uid)!,
                gpsWon: stats.gpsWon,
                lastGpScore: stats.lastGpScore,
                totalCost: stats.totalCost,
                joinedAt: joinedAtByUser.get(uid)!,
              };
            }),
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

      // General ajustado (opción por liga, off por defecto): todos comparten
      // el corte de la entrada más reciente. El ranking por GP no se ajusta.
      let overallStats = normalStats;
      if (adjustedByLeague.get(leagueId) === true) {
        const latestJoinedAt = latestMembershipJoinedAt(members.map((m) => m.joinedAt))!;
        overallStats = buildStats(
          eligibilityFrom(new Map(memberIds.map((uid) => [uid, latestJoinedAt]))),
        );
      }
      const overallSorted = sortRanking(
        memberIds
          .filter((uid) => overallStats.get(uid)!.hasScores)
          .map((uid) => {
            const stats = overallStats.get(uid)!;
            return {
              userId: uid,
              points: stats.points,
              gpsWon: stats.gpsWon,
              lastGpScore: stats.lastGpScore,
              totalCost: stats.totalCost,
              joinedAt: joinedAtByUser.get(uid)!,
            };
          }),
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

      if (perGpRows.length + overallRows.length > rowsBefore) {
        publishedLeagues.add(leagueId);
      }
    }

    // Publicar por append: las versiones anteriores nunca se mutan.
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
  private async lineupCostByUserAndGp(gpIds: string[]): Promise<Map<string, number>> {
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

    const costByUserGp = new Map<string, number>();
    for (const l of lineups) {
      let cost = 0;
      for (const s of slotsByLineup.get(l.id) ?? []) {
        const price = priceOf.get(`${s.assetType}:${s.assetId}:${l.gpId}`);
        if (price !== undefined) cost += price;
      }
      const key = `${l.userId}:${l.gpId}`;
      costByUserGp.set(key, (costByUserGp.get(key) ?? 0) + cost);
    }
    return costByUserGp;
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
    adjustedRankingEnabled: boolean;
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
      adjustedRankingEnabled: v.adjustedRankingEnabled,
      startDate: v.startDate ?? null,
      endDate: v.endDate ?? null,
    };
  }

  /**
   * Revalida el permiso de gestión de la liga (US-26, leagues.md §5): el
   * actor debe ser un **miembro activo con rol admin**. Aplica la regla pura
   * `canManageLeague` (fuente única, T-08) y devuelve la liga (para no
   * recargarla en el método).
   *
   * Orden de rechazo (seguridad + CA de US-26):
   * 1. Liga inexistente → NOT_FOUND.
   * 2. Extraño (no miembro activo) en una liga **privada** → NOT_FOUND
   *    (no se revela la existencia — ADR-0024, T-12 IDOR).
   * 3. Miembro activo no admin (o extraño en pública) → 403 FORBIDDEN
   *    (CA de US-26: "un miembro intenta cada acción → 403").
   */
  private async assertCanManage(
    leagueId: string,
    actorId: string,
    action: LeagueAdminAction,
  ): Promise<League> {
    const league = await this.deps.prisma.league.findUnique({
      where: { id: leagueId },
    });
    if (!league) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }
    const membership = await this.deps.prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: actorId } },
    });
    const isActiveMember = membership !== null && membership.status === "active";
    if (!isActiveMember && league.type === "private") {
      throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
    }
    const role: LeagueMemberRole =
      isActiveMember && membership.role === "admin" ? "admin" : "member";
    if (!canManageLeague(role, action)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Solo el admin de la liga puede hacer esta acción.",
      });
    }
    return league;
  }

  /**
   * Registra un fallo de código de la IP y, al alcanzar el umbral, la
   * bloquea temporalmente (US-25/ADR-0025, espejo del bloqueo de cuenta
   * del login US-01). Sin store inyectado: sin efecto.
   */
  private async registerJoinFailure(
    ip: string,
    cfg: { lockoutThreshold: number; lockoutSec: number },
  ): Promise<void> {
    const joinRL = this.deps.joinRateLimit;
    if (!joinRL) return;
    const count = await joinRL.recordLeagueJoinFailure(ip);
    if (shouldLockLeagueJoin(count, { lockoutThreshold: cfg.lockoutThreshold })) {
      await joinRL.lockLeagueJoin(ip, cfg.lockoutSec);
    }
  }

  /**
   * Traduce un rechazo (US-25) en el error server-side con motivo explícito
   * en español (leagues.md §6, CA de US-25). El switch es exhaustivo sobre
   * `LeagueJoinRejectionReason` (sin `default` muerto): si el núcleo añade
   * un motivo, el typecheck obliga a tratarlo aquí.
   *
   * Se usa en dos puntos: el check temprano de bloqueo (paso 2, espejo
   * US-01 — `locked` con prioridad total antes de resolver el código) y el
   * rechazo de la regla pura (paso 5). Al llegar al paso 5,
   * `ipLockRemainingSec` es 0 (si no, ya se habría lanzado en el paso 2),
   * así que la rama `locked` de esa llamada está inalcanzable — de ahí que
   * el test de regresión la cubra por el paso 2.
   */
  private joinRejection(decision: {
    reason: LeagueJoinRejectionReason;
    retryAfterSec: number;
  }): TRPCError {
    switch (decision.reason) {
      case "locked":
        return new TRPCError({
          code: "BAD_REQUEST",
          message: `Demasiados intentos fallidos. Inténtalo de nuevo en ${decision.retryAfterSec} s.`,
        });
      case "rate_limited":
        return new TRPCError({
          code: "BAD_REQUEST",
          message: `Estás enviando demasiadas peticiones. Inténtalo de nuevo en ${decision.retryAfterSec} s.`,
        });
      case "not_accepting_entries":
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "La liga no acepta entradas.",
        });
      case "invalid_code":
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "El código no es válido.",
        });
      case "already_member":
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "Ya eres miembro de esta liga.",
        });
      case "league_full":
        return new TRPCError({
          code: "BAD_REQUEST",
          message: "La liga está llena.",
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
    const [league, activeInvite, activeMembers, memberRows, formerRows] =
      await Promise.all([
        prisma.league.findUniqueOrThrow({ where: { id: leagueId } }),
        prisma.leagueInvite.findFirst({
          where: { leagueId, status: "active" },
          orderBy: { createdAt: "desc" },
        }),
        prisma.leagueMember.count({ where: { leagueId, status: "active" } }),
        prisma.leagueMember.findMany({
          where: { leagueId, status: "active" },
          select: {
            userId: true,
            role: true,
            joinedAt: true,
            user: { select: { username: true, profile: { select: { displayName: true } } } },
          },
          // Admins primero, luego por antigüedad (leagues.md §5: el admin gestiona).
          orderBy: [{ role: "asc" }, { joinedAt: "asc" }],
        }),
        // Miembros que salieron o fueron expulsados (US-27): se muestran
        // marcados en el detalle; el orden es por fecha de salida (la más
        // reciente primero).
        prisma.leagueMember.findMany({
          where: { leagueId, status: { in: ["left", "kicked"] } },
          select: {
            userId: true,
            role: true,
            status: true,
            leftAt: true,
            user: { select: { username: true, profile: { select: { displayName: true } } } },
          },
          orderBy: { leftAt: "desc" },
        }),
      ]);
    const membership = actorId
      ? await prisma.leagueMember.findUnique({
          where: { leagueId_userId: { leagueId, userId: actorId } },
        })
      : null;
    const isMember = membership !== null && membership.status === "active";
    const isAdmin = isMember && membership.role === "admin";
    // Código (US-26, leagues.md §5): el admin siempre; el miembro solo si el
    // admin lo habilita (`allowMemberInvites`). Regla pura `canInvite`.
    const canSeeCode =
      isMember &&
      canInvite(isAdmin ? "admin" : "member", {
        allowMemberInvites: league.allowMemberInvites,
      });
    return {
      id: league.id,
      name: league.name,
      description: league.description,
      type: league.type,
      visibility: league.visibility,
      minMembers: league.minMembers,
      maxMembers: league.maxMembers,
      entryMode: league.entryMode,
      allowMemberInvites: league.allowMemberInvites,
      adjustedRankingEnabled: league.adjustedRankingEnabled,
      startDate: league.startDate,
      endDate: league.endDate,
      activeMembers,
      members: memberRows.map((m) => ({
        userId: m.userId,
        username: m.user.profile?.displayName ?? m.user.username,
        role: m.role,
      })),
      formerMembers: formerRows.map((m) => ({
        userId: m.userId,
        username: m.user.profile?.displayName ?? m.user.username,
        role: m.role,
        // La consulta filtra `status IN (left, kicked)`: solo esos dos valores.
        status: m.status as "left" | "kicked",
      })),
      isMember,
      isAdmin,
      code: canSeeCode ? (activeInvite?.code ?? null) : null,
    };
  }
}
