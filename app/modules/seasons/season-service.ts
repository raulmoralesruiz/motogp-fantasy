/**
 * Servicio de temporadas (US-04): temporadas con `season_rules` versionado.
 *
 * - `createSeasonWithRules`: transacción atómica Season + SeasonRule
 *   (versión inicial) + auditoría `season.created` (T-09).
 * - `addRulesVersion`: nueva versión en una temporada existente; las
 *   versiones publicadas nunca se mutan (AGENTS.md §5); el duplicado
 *   `(season, version)` se rechaza explícito (CONFLICT) y el unique de BD
 *   es la última barrera ante concurrencia.
 *
 * La versión de la fila (`SeasonRule.version`) se deriva de
 * `rules.rulesVersion`: fuente única de verdad, no pueden divergir.
 *
 * Las reglas se revalidan server-side contra `seasonRulesSchema` en el
 * límite del módulo (el cliente nunca se confía — AGENTS.md §8).
 *
 * Las dependencias se inyectan (prisma): el servicio se prueba sin los
 * singletons de la app (mismo patrón que `AuthService`).
 */
import { TRPCError } from "@trpc/server";
import type {
  Prisma,
  PrismaClient,
  Season,
  SeasonRule,
  SeasonStatus,
} from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import { seasonRulesSchema, type SeasonRules } from "@/shared/validation/season-rules";

export interface SeasonServiceDeps {
  prisma: PrismaClient;
}

/** Metadatos del actor para auditoría (T-09). */
export interface AuditMeta {
  actorId: string;
  ip: string;
}

export interface CreateSeasonWithRulesInput {
  name: string;
  year: number;
  startDate?: Date;
  endDate?: Date;
  rules: SeasonRules;
}

export interface AddRulesVersionInput {
  seasonId: string;
  rules: SeasonRules;
}

/** Versión de reglas publicada (proyección de solo lectura). */
export interface SeasonRulesVersion {
  id: string;
  version: string;
  rules: SeasonRules;
  createdAt: Date;
}

/** Temporada con todas sus versiones de reglas (orden cronológico). */
export interface SeasonWithRules {
  id: string;
  name: string;
  year: number;
  startDate: Date | null;
  endDate: Date | null;
  status: SeasonStatus;
  rules: SeasonRulesVersion[];
}

type SeasonWithRulesRow = Season & { rules: SeasonRule[] };

export class SeasonService {
  constructor(private readonly deps: SeasonServiceDeps) {}

  /**
   * Crea una temporada con su primera versión de reglas (US-04).
   * Atómico: Season + SeasonRule + auditoría en la misma transacción.
   */
  async createSeasonWithRules(
    input: CreateSeasonWithRulesInput,
    meta: AuditMeta,
  ): Promise<SeasonWithRules> {
    const rules = this.validateRules(input.rules);
    const created = await this.deps.prisma.$transaction(async (tx) => {
      const season = await tx.season.create({
        data: {
          name: input.name,
          year: input.year,
          startDate: input.startDate ?? null,
          endDate: input.endDate ?? null,
          rules: {
            create: {
              version: rules.rulesVersion,
              rules: rules as Prisma.InputJsonValue,
            },
          },
        },
        include: { rules: true },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "season.created",
        entity: "season",
        entityId: season.id,
        afterData: {
          name: season.name,
          year: season.year,
          rulesVersion: rules.rulesVersion,
        },
        ip: meta.ip,
      });
      return season;
    });
    return this.toSeasonWithRules(created);
  }

  /**
   * Añade una nueva versión de reglas a una temporada existente (US-04).
   *
   * - La temporada debe existir (NOT_FOUND).
   * - Duplicado `(season, version)` → CONFLICT; el unique de BD es la
   *   última barrera ante concurrencia.
   * - Las versiones anteriores nunca se mutan (AGENTS.md §5).
   */
  async addRulesVersion(
    input: AddRulesVersionInput,
    meta: AuditMeta,
  ): Promise<SeasonRulesVersion> {
    const rules = this.validateRules(input.rules);
    const version = rules.rulesVersion;

    const season = await this.deps.prisma.season.findUnique({
      where: { id: input.seasonId },
    });
    if (!season) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La temporada no existe." });
    }

    const existing = await this.deps.prisma.seasonRule.findUnique({
      where: { seasonId_version: { seasonId: input.seasonId, version } },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `La temporada ya tiene la versión de reglas ${version}.`,
      });
    }

    const rule = await this.deps.prisma.$transaction(async (tx) => {
      const created = await tx.seasonRule.create({
        data: {
          seasonId: input.seasonId,
          version,
          rules: rules as Prisma.InputJsonValue,
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "season.rules_version_added",
        entity: "season_rules",
        entityId: created.id,
        afterData: { seasonId: input.seasonId, version },
        ip: meta.ip,
      });
      return created;
    });

    return {
      id: rule.id,
      version: rule.version,
      rules: rule.rules as unknown as SeasonRules,
      createdAt: rule.createdAt,
    };
  }

  /** Todas las temporadas con sus versiones de reglas (orden cronológico). */
  async listSeasons(): Promise<SeasonWithRules[]> {
    const seasons = await this.deps.prisma.season.findMany({
      include: { rules: true },
      orderBy: [{ year: "asc" }, { name: "asc" }],
    });
    return seasons.map((season) => this.toSeasonWithRules(season));
  }

  /** Una temporada con sus versiones de reglas. NOT_FOUND si no existe. */
  async getSeason(seasonId: string): Promise<SeasonWithRules> {
    const season = await this.deps.prisma.season.findUnique({
      where: { id: seasonId },
      include: { rules: true },
    });
    if (!season) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La temporada no existe." });
    }
    return this.toSeasonWithRules(season);
  }

  /**
   * Proyecta una temporada con sus versiones de reglas. `rules` se castea
   * a `SeasonRules`: las filas solo entran en BD tras pasar
   * `seasonRulesSchema` (se valida en la escritura), así que el cast es
   * seguro.
   */
  private toSeasonWithRules(season: SeasonWithRulesRow): SeasonWithRules {
    return {
      id: season.id,
      name: season.name,
      year: season.year,
      startDate: season.startDate,
      endDate: season.endDate,
      status: season.status,
      rules: [...season.rules]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((rule) => ({
          id: rule.id,
          version: rule.version,
          rules: rule.rules as unknown as SeasonRules,
          createdAt: rule.createdAt,
        })),
    };
  }

  /**
   * Revalida las reglas server-side (el cliente nunca se confía —
   * AGENTS.md §8): el payload debe pasar `seasonRulesSchema` completo.
   */
  private validateRules(rules: unknown): SeasonRules {
    const result = seasonRulesSchema.safeParse(rules);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Reglas de temporada inválidas: ${issues}`,
      });
    }
    return result.data;
  }
}
