/**
 * Servicio de mercado (US-06): pilotos, constructores, equipos y
 * afiliaciones por GP.
 *
 * - `createRider` / `createConstructor` / `createTeam`: idempotentes por
 *   nombre (unique en BD): si existe, se reutiliza sin auditar (no es un
 *   cambio); solo la creación nueva audita (`rider.created`,
 *   `constructor.created`, `team.created`). Un equipo pertenece a
 *   exactamente un constructor (CA US-06); invariante 5: constructor ≠
 *   equipo, activos distintos.
 * - `setRiderAffiliation`: afiliación por GP (ajuste fino). Si el piloto ya
 *   tiene esa misma afiliación para el GP: no-op sin auditar. Si tiene otra,
 *   la reemplaza (auditoría `affiliation.set` con before/after).
 * - `setRiderAffiliationFrom`: "desde el GP X en adelante" (ADR-0013):
 *   rellena el GP de inicio y todos los GPs siguientes de la misma
 *   temporada que no tengan afiliación; los existentes se saltan y se
 *   reportan (no se sobreescriben) y los GPs anteriores nunca se tocan.
 *   Auditoría `affiliation.set` por GP creado + resumen `affiliation.range_set`.
 *
 * El constructor de una afiliación SIEMPRE se deriva del equipo en el
 * servidor; el cliente nunca lo envía (invariante 5).
 *
 * Las dependencias se inyectan (prisma): el servicio se prueba sin los
 * singletons de la app (mismo patrón que `GpService`).
 *
 * Nota (tipado): la relación se llama `constructor`, que colisiona con
 * `Object.prototype.constructor`. Prisma exige declarar `constructor`
 * explícitamente en cualquier literal `include`/`select` de `Team` o
 * `RiderAffiliation`; por eso se usa `include: { constructor: true }` y los
 * tipos de resultado se toman de `Prisma.*GetPayload`.
 */
import { TRPCError } from "@trpc/server";
import type {
  Constructor,
  Prisma,
  PrismaClient,
  Rider,
  RiderAffiliation,
} from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import {
  type NormalizedMarket,
  MarketNormalizationError,
} from "./market-source";

export interface MarketServiceDeps {
  prisma: PrismaClient;
}

/** Metadatos del actor para auditoría (T-09). */
export interface AuditMeta {
  actorId: string;
  ip: string;
}

// ── Inputs (contratos del servicio; el router pasa los datos parseados por Zod) ──

export interface CreateRiderInput {
  name: string;
  number?: number | null;
}

export interface CreateConstructorInput {
  name: string;
}

export interface CreateTeamInput {
  name: string;
  constructorId: string;
}

export interface SetRiderAffiliationInput {
  riderId: string;
  teamId: string;
  gpId: string;
}

export interface SetRiderAffiliationFromInput {
  riderId: string;
  teamId: string;
  fromGpId: string;
}

// ── Vistas (solo lectura para la UI) ───────────────────────────────────────

export interface RiderView {
  id: string;
  name: string;
  number: number | null;
  isActive: boolean;
}

export interface ConstructorView {
  id: string;
  name: string;
}

export interface TeamView {
  id: string;
  name: string;
  constructorId: string;
  constructorName: string;
}

/** Resultado de crear un activo: la vista + si se creó o se reutilizó. */
export type CreateAssetResult<T> = T & {
  /** `false` si el activo ya existía (reutilizado, no auditado). */
  created: boolean;
};

export interface RiderAffiliationView {
  id: string;
  riderId: string;
  teamId: string;
  constructorId: string;
  gpId: string;
}

/** Afiliación con su GP, equipo y constructor (para la UI). */
export interface RiderAffiliationDetail extends RiderAffiliationView {
  gp: { id: string; seasonId: string; round: number; name: string; date: Date };
  team: { id: string; name: string };
  constructor: { id: string; name: string };
}

/** Piloto con sus afiliaciones ordenadas por ronda de GP. */
export interface RiderDetail {
  rider: RiderView;
  affiliations: RiderAffiliationDetail[];
}

/** Resultado de una afiliación por GP: la afiliación resultante + si cambió. */
export interface SetRiderAffiliationResult {
  affiliation: RiderAffiliationView;
  /** `false` si el piloto ya tenía esa misma afiliación (no-op, no auditado). */
  changed: boolean;
}

/** Informe de "desde el GP X en adelante" (ADR-0013). */
export interface AffiliationRangeReport {
  riderId: string;
  teamId: string;
  fromGpId: string;
  seasonId: string;
  created: number;
  skipped: Array<{ gpId: string; round: number; reason: string }>;
}

// ── Import de mercado (US-06, ADR-0013) ───────────────────────────────────

/** Informe de import de mercado: cuántos activos se crearon/saltaron. */
export interface MarketImportReport {
  seasonId: string;
  seasonYear: number;
  /** Constructores creados (nuevos). */
  constructorsCreated: number;
  /** Constructores saltados (ya existían). */
  constructorsSkipped: number;
  /** Equipos creados (nuevos). */
  teamsCreated: number;
  /** Equipos saltados (ya existían). */
  teamsSkipped: number;
  /** Pilotos creados (nuevos). */
  ridersCreated: number;
  /** Pilotos saltados (ya existían). */
  ridersSkipped: number;
  /** Afiliaciones creadas (nuevas). */
  affiliationsCreated: number;
  /** Afiliaciones saltadas (ya existían). */
  affiliationsSkipped: number;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

/** Equipo con su constructor (relación `constructor` incluida). */
type TeamWithConstructor = Prisma.TeamGetPayload<{
  include: { constructor: true };
}>;

/** Afiliación con GP (proyección), equipo y constructor completos. */
type AffiliationWithRelations = Prisma.RiderAffiliationGetPayload<{
  include: {
    gp: {
      select: { id: true; seasonId: true; round: true; name: true; date: true };
    };
    team: true;
    constructor: true;
  };
}>;

/** Violación de unique de Prisma (P2002): creación concurrente. */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export class MarketService {
  constructor(private readonly deps: MarketServiceDeps) {}

  // ── Creación idempotente de activos ───────────────────────────────────────

  /**
   * Crea un piloto o reutiliza uno existente (unique `name`). Solo la
   * creación nueva se audita (`rider.created`): reutilizar no es un cambio.
   */
  async createRider(
    input: CreateRiderInput,
    meta: AuditMeta,
  ): Promise<CreateAssetResult<RiderView>> {
    const existing = await this.deps.prisma.rider.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      return { ...this.toRiderView(existing), created: false };
    }
    try {
      const created = await this.deps.prisma.$transaction(async (tx) => {
        const rider = await tx.rider.create({
          data: { name: input.name, number: input.number ?? null },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "rider.created",
          entity: "rider",
          entityId: rider.id,
          afterData: { name: rider.name, number: rider.number },
          ip: meta.ip,
        });
        return rider;
      });
      return { ...this.toRiderView(created), created: true };
    } catch (error) {
      // Creación concurrente: el unique `name` rechaza la segunda (P2002)
      // → se reutiliza el existente (idempotente).
      if (isPrismaUniqueViolation(error)) {
        const row = await this.deps.prisma.rider.findUnique({
          where: { name: input.name },
        });
        if (row) return { ...this.toRiderView(row), created: false };
      }
      throw error;
    }
  }

  /**
   * Crea un constructor o reutiliza uno existente (unique `name`). Solo la
   * creación nueva se audita (`constructor.created`).
   */
  async createConstructor(
    input: CreateConstructorInput,
    meta: AuditMeta,
  ): Promise<CreateAssetResult<ConstructorView>> {
    const existing = await this.deps.prisma.constructor.findUnique({
      where: { name: input.name },
    });
    if (existing) {
      return { ...this.toConstructorView(existing), created: false };
    }
    try {
      const created = await this.deps.prisma.$transaction(async (tx) => {
        const constructor = await tx.constructor.create({
          data: { name: input.name },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "constructor.created",
          entity: "constructor",
          entityId: constructor.id,
          afterData: { name: constructor.name },
          ip: meta.ip,
        });
        return constructor;
      });
      return { ...this.toConstructorView(created), created: true };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        const row = await this.deps.prisma.constructor.findUnique({
          where: { name: input.name },
        });
        if (row) return { ...this.toConstructorView(row), created: false };
      }
      throw error;
    }
  }

  /**
   * Crea un equipo o reutiliza uno existente (unique `name`). El constructor
   * debe existir (NOT_FOUND). Solo la creación nueva se audita
   * (`team.created`).
   */
  async createTeam(
    input: CreateTeamInput,
    meta: AuditMeta,
  ): Promise<CreateAssetResult<TeamView>> {
    const constructor = await this.deps.prisma.constructor.findUnique({
      where: { id: input.constructorId },
    });
    if (!constructor) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "El constructor no existe.",
      });
    }
    const existing = await this.deps.prisma.team.findUnique({
      where: { name: input.name },
      include: { constructor: true },
    });
    if (existing) {
      return { ...this.toTeamView(existing), created: false };
    }
    try {
      const created = await this.deps.prisma.$transaction(async (tx) => {
        const team = await tx.team.create({
          data: { name: input.name, constructorId: input.constructorId },
          include: { constructor: true },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "team.created",
          entity: "team",
          entityId: team.id,
          afterData: { name: team.name, constructorId: team.constructorId },
          ip: meta.ip,
        });
        return team;
      });
      return { ...this.toTeamView(created), created: true };
    } catch (error) {
      if (isPrismaUniqueViolation(error)) {
        const row = await this.deps.prisma.team.findUnique({
          where: { name: input.name },
          include: { constructor: true },
        });
        if (row) return { ...this.toTeamView(row), created: false };
      }
      throw error;
    }
  }

  // ── Lecturas ──────────────────────────────────────────────────────────────

  /** Pilotos ordenados por nombre. */
  async listRiders(): Promise<RiderView[]> {
    const riders = await this.deps.prisma.rider.findMany({
      orderBy: { name: "asc" },
    });
    return riders.map((rider) => this.toRiderView(rider));
  }

  /** Constructores ordenados por nombre. */
  async listConstructors(): Promise<ConstructorView[]> {
    const constructors = await this.deps.prisma.constructor.findMany({
      orderBy: { name: "asc" },
    });
    return constructors.map((constructor) => this.toConstructorView(constructor));
  }

  /** Equipos ordenados por nombre, con su constructor. */
  async listTeams(): Promise<TeamView[]> {
    const teams = await this.deps.prisma.team.findMany({
      orderBy: { name: "asc" },
      include: { constructor: true },
    });
    return teams.map((team) => this.toTeamView(team));
  }

  /** Piloto con sus afiliaciones ordenadas por ronda de GP. */
  async getRider(riderId: string): Promise<RiderDetail> {
    const rider = await this.deps.prisma.rider.findUnique({
      where: { id: riderId },
      include: {
        affiliations: {
          include: {
            gp: {
              select: {
                id: true,
                seasonId: true,
                round: true,
                name: true,
                date: true,
              },
            },
            team: true,
            constructor: true,
          },
          orderBy: { gp: { round: "asc" } },
        },
      },
    });
    if (!rider) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El piloto no existe." });
    }
    return {
      rider: this.toRiderView(rider),
      affiliations: rider.affiliations.map((affiliation) =>
        this.toAffiliationDetail(affiliation),
      ),
    };
  }

  // ── Afiliaciones por GP ───────────────────────────────────────────────────

  /**
   * Afiliación por GP (ajuste fino, US-06).
   * - Piloto, equipo y GP deben existir (NOT_FOUND).
   * - Si el piloto ya tiene esa misma afiliación para el GP: no-op, sin
   *   auditar (no es un cambio).
   * - Si tiene otra afiliación: la reemplaza (auditoría `affiliation.set`
   *   con before/after). Si no tiene: crea (auditoría `affiliation.set`).
   * - El constructor se deriva del equipo (invariante 5).
   */
  async setRiderAffiliation(
    input: SetRiderAffiliationInput,
    meta: AuditMeta,
  ): Promise<SetRiderAffiliationResult> {
    const [rider, team, gp] = await Promise.all([
      this.deps.prisma.rider.findUnique({ where: { id: input.riderId } }),
      this.deps.prisma.team.findUnique({ where: { id: input.teamId } }),
      this.deps.prisma.gp.findUnique({ where: { id: input.gpId } }),
    ]);
    if (!rider) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El piloto no existe." });
    }
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El equipo no existe." });
    }
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const constructorId = team.constructorId;

    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.riderAffiliation.findUnique({
        where: { riderId_gpId: { riderId: input.riderId, gpId: input.gpId } },
      });
      // Misma afiliación → no-op, sin auditar.
      if (
        existing &&
        existing.teamId === team.id &&
        existing.constructorId === constructorId
      ) {
        return { row: existing, changed: false };
      }
      const afterData = {
        riderId: input.riderId,
        teamId: team.id,
        constructorId,
        gpId: input.gpId,
      };
      if (existing) {
        const updated = await tx.riderAffiliation.update({
          where: { id: existing.id },
          data: { teamId: team.id, constructorId },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "affiliation.set",
          entity: "rider_affiliation",
          entityId: updated.id,
          beforeData: {
            teamId: existing.teamId,
            constructorId: existing.constructorId,
          },
          afterData,
          ip: meta.ip,
        });
        return { row: updated, changed: true };
      }
      const created = await tx.riderAffiliation.create({
        data: {
          riderId: input.riderId,
          teamId: team.id,
          constructorId,
          gpId: input.gpId,
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "affiliation.set",
        entity: "rider_affiliation",
        entityId: created.id,
        beforeData: null,
        afterData,
        ip: meta.ip,
      });
      return { row: created, changed: true };
    };

    try {
      const { row, changed } = await this.deps.prisma.$transaction(run);
      return { affiliation: this.toAffiliationView(row), changed };
    } catch (error) {
      // Creación concurrente sobre `(rider, gp)`: el unique rechaza la
      // segunda (P2002) → se reevalúa como reemplazo.
      if (isPrismaUniqueViolation(error)) {
        const { row, changed } = await this.deps.prisma.$transaction(run);
        return { affiliation: this.toAffiliationView(row), changed };
      }
      throw error;
    }
  }

  /**
   * Afiliación "desde el GP X en adelante" (US-06, ADR-0013): rellena el GP
   * de inicio y todos los GPs siguientes de la misma temporada que no
   * tengan afiliación. Los existentes se saltan y se reportan (no se
   * sobreescriben) y los GPs anteriores nunca se tocan.
   *
   * - Piloto, equipo y GP de inicio deben existir (NOT_FOUND).
   * - Transacción atómica: por cada GP creado, auditoría `affiliation.set`;
   *   al final, resumen `affiliation.range_set` (entityId = riderId).
   * - El constructor se deriva del equipo (invariante 5).
   */
  async setRiderAffiliationFrom(
    input: SetRiderAffiliationFromInput,
    meta: AuditMeta,
  ): Promise<AffiliationRangeReport> {
    const [rider, team, fromGp] = await Promise.all([
      this.deps.prisma.rider.findUnique({ where: { id: input.riderId } }),
      this.deps.prisma.team.findUnique({ where: { id: input.teamId } }),
      this.deps.prisma.gp.findUnique({ where: { id: input.fromGpId } }),
    ]);
    if (!rider) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El piloto no existe." });
    }
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El equipo no existe." });
    }
    if (!fromGp) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "El GP de inicio no existe.",
      });
    }
    const constructorId = team.constructorId;

    return this.deps.prisma.$transaction(async (tx) => {
      const gps = await tx.gp.findMany({
        where: { seasonId: fromGp.seasonId, round: { gte: fromGp.round } },
        orderBy: { round: "asc" },
      });
      const skipped: Array<{ gpId: string; round: number; reason: string }> = [];
      let created = 0;
      for (const gp of gps) {
        const existing = await tx.riderAffiliation.findUnique({
          where: { riderId_gpId: { riderId: rider.id, gpId: gp.id } },
          include: { team: true, constructor: true },
        });
        if (existing) {
          skipped.push({
            gpId: gp.id,
            round: gp.round,
            reason: `La ronda ${gp.round} ya tiene afiliación (${existing.team.name})`,
          });
          continue;
        }
        const row = await tx.riderAffiliation.create({
          data: {
            riderId: rider.id,
            teamId: team.id,
            constructorId,
            gpId: gp.id,
          },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "affiliation.set",
          entity: "rider_affiliation",
          entityId: row.id,
          beforeData: null,
          afterData: {
            riderId: rider.id,
            teamId: team.id,
            constructorId,
            gpId: gp.id,
            fromGpId: fromGp.id,
          },
          ip: meta.ip,
        });
        created += 1;
      }
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "affiliation.range_set",
        entity: "rider_affiliation",
        entityId: rider.id,
        beforeData: null,
        afterData: {
          riderId: rider.id,
          teamId: team.id,
          constructorId,
          fromGpId: fromGp.id,
          seasonId: fromGp.seasonId,
          created,
          skipped: skipped.length,
        },
        ip: meta.ip,
      });
      return {
        riderId: rider.id,
        teamId: team.id,
        fromGpId: fromGp.id,
        seasonId: fromGp.seasonId,
        created,
        skipped,
      };
    });
  }

  // ── Mapeo a vistas ────────────────────────────────────────────────────────

  /**
   * Importa un mercado normalizado desde la fuente (US-06, ADR-0013):
   * transacción atómica que crea constructores, equipos, pilotos y
   * afiliaciones (idempotente por nombre/ID de fuente).
   *
   * - Constructores: únicos por `name` (se saltan si existen).
   * - Equipos: únicos por `name` (se saltan si existen).
   * - Pilotos: únicos por `name` (se saltan si existen).
   * - Afiliaciones: rider→equipo (se saltan si ya existen).
   *
   * El constructor se deriva del equipo (invariante 5).
   *
   * Auditoría: `market.imported` con resumen (entityId = seasonId).
   */
  async importMarket(
    input: { normalized: NormalizedMarket; seasonId: string },
    meta: AuditMeta,
  ): Promise<MarketImportReport> {
    const { normalized, seasonId } = input;

    // Validar que el año del mercado coincide con la temporada.
    const season = await this.deps.prisma.season.findUnique({
      where: { id: seasonId },
    });
    if (!season) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "La temporada no existe.",
      });
    }
    if (normalized.year !== season.year) {
      throw new MarketNormalizationError(
        `El mercado es para el año ${normalized.year}, pero la temporada es ${season.year}.`,
      );
    }

    return this.deps.prisma.$transaction(async (tx) => {
      let constructorsCreated = 0;
      let constructorsSkipped = 0;
      let teamsCreated = 0;
      let teamsSkipped = 0;
      let ridersCreated = 0;
      let ridersSkipped = 0;
      const affiliationsCreated = 0;
      const affiliationsSkipped = 0;

      // Mapeo: name → id (BD) para constructores y equipos.
      const constructorByName = new Map<string, string>();
      const teamByName = new Map<string, string>();

      // 1) Constructores (únicos por name).
      for (const ctor of normalized.constructors) {
        const existing = await tx.constructor.findUnique({
          where: { name: ctor.name },
        });
        if (existing) {
          constructorByName.set(ctor.name, existing.id);
          constructorsSkipped += 1;
          continue;
        }
        const created = await tx.constructor.create({
          data: { name: ctor.name },
        });
        constructorByName.set(ctor.name, created.id);
        constructorsCreated += 1;
      }

      // 2) Equipos (únicos por name, FK constructor).
      for (const team of normalized.teams) {
        const existing = await tx.team.findUnique({
          where: { name: team.name },
        });
        if (existing) {
          teamByName.set(team.name, existing.id);
          teamsSkipped += 1;
          continue;
        }
        const constructorId = constructorByName.get(team.manufacturer.name);
        if (!constructorId) {
          throw new MarketNormalizationError(
            `El equipo «${team.name}» referencia un constructor desconocido «${team.manufacturer.name}».`,
          );
        }
        const created = await tx.team.create({
          data: { name: team.name, constructorId },
        });
        teamByName.set(team.name, created.id);
        teamsCreated += 1;
      }

      // 3) Pilotos (únicos por name).
      for (const rider of normalized.riders) {
        const fullName = `${rider.name} ${rider.surname}`.trim();
        const existing = await tx.rider.findUnique({
          where: { name: fullName },
        });
        if (existing) {
          ridersSkipped += 1;
          continue;
        }
        await tx.rider.create({
          data: { name: fullName, number: rider.number ?? null },
        });
        ridersCreated += 1;
      }

      // 4) Afiliaciones (rider→equipo por GP — pero aquí no tenemos GPs).
      //    Las afiliaciones se crean "desde el GP X en adelante" (setRiderAffiliationFrom).
      //    Por ahora, solo reportamos: el admin debe ejecutar "desde GP 1" manualmente.

      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "market.imported",
        entity: "market",
        entityId: seasonId,
        beforeData: null,
        afterData: {
          seasonId,
          seasonYear: normalized.year,
          constructorsCreated,
          constructorsSkipped,
          teamsCreated,
          teamsSkipped,
          ridersCreated,
          ridersSkipped,
        },
        ip: meta.ip,
      });

      return {
        seasonId,
        seasonYear: normalized.year,
        constructorsCreated,
        constructorsSkipped,
        teamsCreated,
        teamsSkipped,
        ridersCreated,
        ridersSkipped,
        affiliationsCreated,
        affiliationsSkipped,
      };
    });
  }

  // ── Mapeo a vistas ────────────────────────────────────────────────────────

  private toRiderView(rider: Rider): RiderView {
    return {
      id: rider.id,
      name: rider.name,
      number: rider.number,
      isActive: rider.isActive,
    };
  }

  private toConstructorView(constructor: Constructor): ConstructorView {
    return { id: constructor.id, name: constructor.name };
  }

  private toTeamView(team: TeamWithConstructor): TeamView {
    return {
      id: team.id,
      name: team.name,
      constructorId: team.constructorId,
      constructorName: team.constructor.name,
    };
  }

  private toAffiliationView(
    affiliation: RiderAffiliation,
  ): RiderAffiliationView {
    return {
      id: affiliation.id,
      riderId: affiliation.riderId,
      teamId: affiliation.teamId,
      constructorId: affiliation.constructorId,
      gpId: affiliation.gpId,
    };
  }

  private toAffiliationDetail(
    affiliation: AffiliationWithRelations,
  ): RiderAffiliationDetail {
    return {
      id: affiliation.id,
      riderId: affiliation.riderId,
      teamId: affiliation.teamId,
      constructorId: affiliation.constructorId,
      gpId: affiliation.gpId,
      gp: {
        id: affiliation.gp.id,
        seasonId: affiliation.gp.seasonId,
        round: affiliation.gp.round,
        name: affiliation.gp.name,
        date: affiliation.gp.date,
      },
      team: { id: affiliation.team.id, name: affiliation.team.name },
      constructor: {
        id: affiliation.constructor.id,
        name: affiliation.constructor.name,
      },
    };
  }
}
