/**
 * Servicio de GPs, circuitos y eventos de fin de semana (US-05).
 *
 * - `createCircuit`: idempotente por `(name, country)`: si existe, se
 *   reutiliza sin auditar (no es un cambio); solo la creación nueva
 *   audita `circuit.created`.
 * - `createGp`: GP + eventos atómico (Q2 y carrera obligatorias; Q1 y
 *   sprint opcionales) + auditoría `gp.created`.
 * - `addWeekendEvent`: añade un evento faltante a un GP existente
 *   (auditoría `gp.event_added`).
 * - `updateGpStatus`: aplica la tabla de transiciones pura
 *   (`gp-status.ts`) y audita `gp.status_changed` (before/after).
 * - `updateGpLockout`: fija o borra `lockoutAt` (auditoría
 *   `gp.lockout_changed` con before/after).
 * - `importCalendar`: transacción atómica all-or-nothing (ADR-0012):
 *   upsert de circuitos, salta las rondas existentes (informe, no error),
 *   crea GPs + eventos; auditoría `calendar.imported` + una `gp.created`
 *   por GP creado.
 *
 * El payload del calendario se revalida server-side contra
 * `normalizedSeasonCalendarSchema` en el límite del módulo (el cliente
 * nunca se confía — AGENTS.md §8).
 *
 * Las dependencias se inyectan (prisma): el servicio se prueba sin los
 * singletons de la app (mismo patrón que `SeasonService`).
 */
import { TRPCError } from "@trpc/server";
import type {
  Circuit,
  Gp,
  GpStatus,
  Prisma,
  PrismaClient,
  WeekendEvent,
  WeekendEventStatus,
  WeekendEventType,
} from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import {
  normalizedSeasonCalendarSchema,
  type NormalizedSeasonCalendar as SeasonCalendarPayload,
} from "@/shared/validation/seasons";

import { WEEKEND_EVENT_ORDER } from "./calendar-source";
import { allowedGpStatusTransitions, canTransitionGpStatus } from "./gp-status";
import type { AuditMeta } from "./season-service";

export interface GpServiceDeps {
  prisma: PrismaClient;
}

// ── Inputs (contratos del servicio; el router pasa los datos parseados por Zod) ──

export interface CreateCircuitInput {
  name: string;
  country: string;
  location?: string | null;
}

export interface CreateGpEventInput {
  type: WeekendEventType;
  startTime?: Date | null;
}

export interface CreateGpInput {
  seasonId: string;
  round: number;
  name: string;
  circuitId: string;
  date: Date;
  lockoutAt?: Date | null;
  events: CreateGpEventInput[];
}

export interface AddWeekendEventInput {
  gpId: string;
  type: WeekendEventType;
  startTime?: Date | null;
}

export interface UpdateGpStatusInput {
  gpId: string;
  status: GpStatus;
}

export interface UpdateGpLockoutInput {
  gpId: string;
  lockoutAt: Date | null;
}

export interface ImportCalendarInput {
  seasonId: string;
  calendar: SeasonCalendarPayload;
}

// ── Vistas (solo lectura para la UI) ───────────────────────────────────────

export interface CircuitView {
  id: string;
  name: string;
  country: string;
  location: string | null;
}

export interface CreateCircuitResult extends CircuitView {
  /** `false` si el circuito ya existía (reutilizado, no auditado). */
  created: boolean;
}

export interface WeekendEventView {
  id: string;
  type: WeekendEventType;
  orderNum: number;
  startTime: Date | null;
  status: WeekendEventStatus;
}

export interface GpView {
  id: string;
  seasonId: string;
  round: number;
  name: string;
  circuit: CircuitView;
  date: Date;
  status: GpStatus;
  lockoutAt: Date | null;
  /** En orden canónico: q1, q2, sprint, race. */
  events: WeekendEventView[];
}

export interface CalendarImportReport {
  seasonId: string;
  year: number;
  created: number;
  skipped: Array<{ round: number; reason: string }>;
}

// ── Utilidades ─────────────────────────────────────────────────────────────

type GpWithRelations = Gp & { circuit: Circuit; weekendEvents: WeekendEvent[] };

/** Violación de unique de Prisma (P2002): creación concurrente. */
function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

const EVENT_LABELS: Record<WeekendEventType, string> = {
  q1: "Q1",
  q2: "Q2",
  sprint: "sprint",
  race: "carrera",
};

const STATUS_LABELS: Record<GpStatus, string> = {
  scheduled: "programado",
  locked: "bloqueado",
  finished: "finalizado",
  cancelled: "cancelado",
};

export class GpService {
  constructor(private readonly deps: GpServiceDeps) {}

  /**
   * Crea un circuito o reutiliza uno existente (unique `(name, country)`).
   * Solo la creación nueva se audita (`circuit.created`): reutilizar un
   * circuito existente no es un cambio.
   */
  async createCircuit(
    input: CreateCircuitInput,
    meta: AuditMeta,
  ): Promise<CreateCircuitResult> {
    const existing = await this.deps.prisma.circuit.findUnique({
      where: { name_country: { name: input.name, country: input.country } },
    });
    if (existing) {
      return { ...this.toCircuitView(existing), created: false };
    }
    try {
      const created = await this.deps.prisma.$transaction(async (tx) => {
        const circuit = await tx.circuit.create({
          data: {
            name: input.name,
            country: input.country,
            location: input.location ?? null,
          },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "circuit.created",
          entity: "circuit",
          entityId: circuit.id,
          afterData: {
            name: circuit.name,
            country: circuit.country,
            location: circuit.location,
          },
          ip: meta.ip,
        });
        return circuit;
      });
      return { ...this.toCircuitView(created), created: true };
    } catch (error) {
      // Creación concurrente: el unique `(name, country)` rechaza la
      // segunda (P2002) → se reutiliza el existente (idempotente).
      if (isPrismaUniqueViolation(error)) {
        const row = await this.deps.prisma.circuit.findUnique({
          where: { name_country: { name: input.name, country: input.country } },
        });
        if (row) return { ...this.toCircuitView(row), created: false };
      }
      throw error;
    }
  }

  /** Circuitos ordenados por país y nombre. */
  async listCircuits(): Promise<CircuitView[]> {
    const circuits = await this.deps.prisma.circuit.findMany({
      orderBy: [{ country: "asc" }, { name: "asc" }],
    });
    return circuits.map((circuit) => this.toCircuitView(circuit));
  }

  /**
   * Crea un GP con sus eventos (US-05): Q2 y carrera obligatorias (ya
   * garantizado por Zod), ronda única por temporada (unique de BD como
   * última barrera). Atómico: GP + eventos + auditoría `gp.created`.
   */
  async createGp(input: CreateGpInput, meta: AuditMeta): Promise<GpView> {
    const season = await this.deps.prisma.season.findUnique({
      where: { id: input.seasonId },
    });
    if (!season) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La temporada no existe." });
    }
    const circuit = await this.deps.prisma.circuit.findUnique({
      where: { id: input.circuitId },
    });
    if (!circuit) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El circuito no existe." });
    }
    const roundTaken = await this.deps.prisma.gp.findUnique({
      where: { seasonId_round: { seasonId: input.seasonId, round: input.round } },
    });
    if (roundTaken) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `La ronda ${input.round} ya está usada en la temporada ${season.name} (${roundTaken.name}).`,
      });
    }

    try {
      const created = await this.deps.prisma.$transaction(async (tx) => {
        const gp = await tx.gp.create({
          data: {
            seasonId: input.seasonId,
            round: input.round,
            name: input.name,
            circuitId: input.circuitId,
            date: input.date,
            lockoutAt: input.lockoutAt ?? null,
            weekendEvents: {
              create: input.events.map((event) => ({
                type: event.type,
                orderNum: 1,
                startTime: event.startTime ?? null,
              })),
            },
          },
          include: { circuit: true, weekendEvents: true },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "gp.created",
          entity: "gp",
          entityId: gp.id,
          afterData: {
            seasonId: gp.seasonId,
            round: gp.round,
            name: gp.name,
            circuitId: gp.circuitId,
            date: gp.date.toISOString(),
            lockoutAt: gp.lockoutAt?.toISOString() ?? null,
            events: input.events.map((event) => event.type),
          },
          ip: meta.ip,
        });
        return gp;
      });
      return this.toGpView(created);
    } catch (error) {
      // Creación concurrente de la misma ronda: el unique `(seasonId, round)`
      // rechaza la segunda (P2002).
      if (isPrismaUniqueViolation(error)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La ronda ${input.round} ya está usada en la temporada ${season.name}.`,
        });
      }
      throw error;
    }
  }

  /** GPs de una temporada ordenados por ronda. */
  async listGps(seasonId: string): Promise<GpView[]> {
    const season = await this.deps.prisma.season.findUnique({
      where: { id: seasonId },
    });
    if (!season) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La temporada no existe." });
    }
    const gps = await this.deps.prisma.gp.findMany({
      where: { seasonId },
      orderBy: { round: "asc" },
      include: { circuit: true, weekendEvents: true },
    });
    return gps.map((gp) => this.toGpView(gp));
  }

  /** GP con su circuito y eventos. */
  async getGp(gpId: string): Promise<GpView> {
    const gp = await this.deps.prisma.gp.findUnique({
      where: { id: gpId },
      include: { circuit: true, weekendEvents: true },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    return this.toGpView(gp);
  }

  /**
   * Añade un evento de fin de semana que falta en un GP (US-05: Q1 y
   * sprint son opcionales y se pueden añadir después). Atómico: evento +
   * auditoría `gp.event_added`.
   */
  async addWeekendEvent(
    input: AddWeekendEventInput,
    meta: AuditMeta,
  ): Promise<GpView> {
    const gp = await this.deps.prisma.gp.findUnique({
      where: { id: input.gpId },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    const existing = await this.deps.prisma.weekendEvent.findFirst({
      where: { gpId: input.gpId, type: input.type },
    });
    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `El GP ya tiene un evento de ${EVENT_LABELS[input.type]}.`,
      });
    }

    const updated = await this.deps.prisma.$transaction(async (tx) => {
      const event = await tx.weekendEvent.create({
        data: {
          gpId: input.gpId,
          type: input.type,
          orderNum: 1,
          startTime: input.startTime ?? null,
        },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "gp.event_added",
        entity: "weekend_event",
        entityId: event.id,
        afterData: {
          gpId: gp.id,
          type: input.type,
          startTime: input.startTime?.toISOString() ?? null,
        },
        ip: meta.ip,
      });
      return tx.gp.findUniqueOrThrow({
        where: { id: gp.id },
        include: { circuit: true, weekendEvents: true },
      });
    });
    return this.toGpView(updated);
  }

  /**
   * Cambia el estado del GP aplicando la tabla pura (`gp-status.ts`).
   * Mismo estado: no-op sin auditoría. Transición inválida: BAD_REQUEST
   * con los estados permitidos. Atómico: update + auditoría
   * `gp.status_changed` (before/after).
   */
  async updateGpStatus(
    input: UpdateGpStatusInput,
    meta: AuditMeta,
  ): Promise<GpView> {
    const gp = await this.deps.prisma.gp.findUnique({
      where: { id: input.gpId },
      include: { circuit: true, weekendEvents: true },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    if (gp.status === input.status) {
      // No-op: el GP ya está en ese estado (sin auditoría).
      return this.toGpView(gp);
    }
    if (!canTransitionGpStatus(gp.status, input.status)) {
      const allowed = allowedGpStatusTransitions(gp.status);
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          allowed.length > 0
            ? `Cambio de estado no válido: desde «${STATUS_LABELS[gp.status]}» solo se puede pasar a ${allowed
                .map((s) => `«${STATUS_LABELS[s]}»`)
                .join(" o ")}.`
            : `Cambio de estado no válido: «${STATUS_LABELS[gp.status]}» es un estado terminal.`,
      });
    }

    const updated = await this.deps.prisma.$transaction(async (tx) => {
      const row = await tx.gp.update({
        where: { id: gp.id },
        data: { status: input.status },
        include: { circuit: true, weekendEvents: true },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "gp.status_changed",
        entity: "gp",
        entityId: gp.id,
        beforeData: { status: gp.status },
        afterData: { status: row.status },
        ip: meta.ip,
      });
      return row;
    });
    return this.toGpView(updated);
  }

  /**
   * Fija o borra `lockoutAt` (US-05: opcional en la creación y editable
   * después, auditado). Atómico: update + auditoría `gp.lockout_changed`
   * (before/after).
   */
  async updateGpLockout(
    input: UpdateGpLockoutInput,
    meta: AuditMeta,
  ): Promise<GpView> {
    const gp = await this.deps.prisma.gp.findUnique({
      where: { id: input.gpId },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }

    const updated = await this.deps.prisma.$transaction(async (tx) => {
      const row = await tx.gp.update({
        where: { id: gp.id },
        data: { lockoutAt: input.lockoutAt },
        include: { circuit: true, weekendEvents: true },
      });
      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "gp.lockout_changed",
        entity: "gp",
        entityId: gp.id,
        beforeData: { lockoutAt: gp.lockoutAt?.toISOString() ?? null },
        afterData: { lockoutAt: row.lockoutAt?.toISOString() ?? null },
        ip: meta.ip,
      });
      return row;
    });
    return this.toGpView(updated);
  }

  /**
   * Importa el calendario normalizado en una temporada (US-05, ADR-0012).
   *
   * - Revalida el payload server-side (el cliente nunca se confía).
   * - `calendar.year` debe coincidir con `season.year` (BAD_REQUEST).
   * - Transacción atómica all-or-nothing: upsert de circuitos, salta las
   *   rondas existentes (informe, no error) y crea GPs + eventos.
   * - Auditoría: `circuit.created` por circuito nuevo, `gp.created` por
   *   GP y `calendar.imported` con el resumen.
   */
  async importCalendar(
    input: ImportCalendarInput,
    meta: AuditMeta,
  ): Promise<CalendarImportReport> {
    const calendar = this.validateCalendar(input.calendar);
    const season = await this.deps.prisma.season.findUnique({
      where: { id: input.seasonId },
    });
    if (!season) {
      throw new TRPCError({ code: "NOT_FOUND", message: "La temporada no existe." });
    }
    if (calendar.year !== season.year) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `El año del calendario (${calendar.year}) no coincide con el año de la temporada (${season.year}).`,
      });
    }

    return this.deps.prisma.$transaction(async (tx) => {
      const skipped: Array<{ round: number; reason: string }> = [];
      let created = 0;

      for (const gp of [...calendar.gps].sort((a, b) => a.round - b.round)) {
        const existing = await tx.gp.findUnique({
          where: { seasonId_round: { seasonId: season.id, round: gp.round } },
        });
        if (existing) {
          skipped.push({
            round: gp.round,
            reason: `La ronda ${gp.round} ya existe (${existing.name}).`,
          });
          continue;
        }
        const circuitId = await this.upsertCircuitInTx(tx, gp.circuit, meta);
        const row = await tx.gp.create({
          data: {
            seasonId: season.id,
            round: gp.round,
            name: gp.name,
            circuitId,
            date: gp.date,
            lockoutAt: null,
            weekendEvents: {
              create: gp.events.map((event) => ({
                type: event.type,
                orderNum: 1,
                startTime: event.startTime ?? null,
              })),
            },
          },
        });
        await appendAudit(tx, {
          actorId: meta.actorId,
          action: "gp.created",
          entity: "gp",
          entityId: row.id,
          afterData: {
            seasonId: season.id,
            round: gp.round,
            name: gp.name,
            circuitId,
            date: row.date.toISOString(),
            events: gp.events.map((event) => event.type),
            source: calendar.source.name,
            seasonRef: calendar.seasonRef,
          },
          ip: meta.ip,
        });
        created += 1;
      }

      await appendAudit(tx, {
        actorId: meta.actorId,
        action: "calendar.imported",
        entity: "season",
        entityId: season.id,
        afterData: {
          year: calendar.year,
          source: calendar.source.name,
          seasonRef: calendar.seasonRef,
          created,
          skipped: skipped.length,
        },
        ip: meta.ip,
      });

      return { seasonId: season.id, year: calendar.year, created, skipped };
    });
  }

  // ── Privados ─────────────────────────────────────────────────────────────

  /** Crea o reutiliza un circuito dentro de una transacción (idempotente). */
  private async upsertCircuitInTx(
    tx: Prisma.TransactionClient,
    circuit: { name: string; country: string; location?: string | null },
    meta: AuditMeta,
  ): Promise<string> {
    const existing = await tx.circuit.findUnique({
      where: { name_country: { name: circuit.name, country: circuit.country } },
    });
    if (existing) return existing.id;
    const created = await tx.circuit.create({
      data: {
        name: circuit.name,
        country: circuit.country,
        location: circuit.location ?? null,
      },
    });
    await appendAudit(tx, {
      actorId: meta.actorId,
      action: "circuit.created",
      entity: "circuit",
      entityId: created.id,
      afterData: {
        name: created.name,
        country: created.country,
        location: created.location,
        source: "calendar",
      },
      ip: meta.ip,
    });
    return created.id;
  }

  /** Revalida el calendario server-side (AGENTS.md §8). */
  private validateCalendar(calendar: unknown): SeasonCalendarPayload {
    const result = normalizedSeasonCalendarSchema.safeParse(calendar);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Calendario no válido: ${issues}`,
      });
    }
    return result.data;
  }

  private toCircuitView(circuit: Circuit): CircuitView {
    return {
      id: circuit.id,
      name: circuit.name,
      country: circuit.country,
      location: circuit.location,
    };
  }

  private toGpView(gp: GpWithRelations): GpView {
    return {
      id: gp.id,
      seasonId: gp.seasonId,
      round: gp.round,
      name: gp.name,
      circuit: this.toCircuitView(gp.circuit),
      date: gp.date,
      status: gp.status,
      lockoutAt: gp.lockoutAt,
      events: [...gp.weekendEvents]
        .sort(
          (a, b) =>
            WEEKEND_EVENT_ORDER[a.type] - WEEKEND_EVENT_ORDER[b.type] ||
            a.orderNum - b.orderNum,
        )
        .map((event) => ({
          id: event.id,
          type: event.type,
          orderNum: event.orderNum,
          startTime: event.startTime,
          status: event.status,
        })),
    };
  }
}
