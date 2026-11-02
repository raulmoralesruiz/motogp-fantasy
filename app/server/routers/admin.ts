/**
 * Router de administración (T-08, base; T-14, ADR-0036): la base de
 * autorización del panel global. Todos sus procedimientos pasan por
 * `adminProcedure` (solo `global_admin`; 403 FORBIDDEN en caso contrario).
 *
 * T-14 (monitoreo):
 * - `admin.jobsStatus`: estado de las colas BullMQ (counts + último fallo),
 *   alertas activas (`source_state` por encima del umbral de US-17),
 *   estado del health-check de la fuente (Redis) y si Sentry está habilitado.
 * - `admin.sourceHealth`: probe A DEMANDA a PulseLive (el botón
 *   "Comprobar fuente" del panel; no muta el estado del probe automático).
 *
 * Inyectable (`createAdminRouter`): el probe usa `fetchImpl` fake en tests
 * (sin red), mismo patrón que `createResultsRouter`.
 */
import { toPublicUser } from "@/modules/identity";
import {
  probeSource,
  type ProbeState,
  type SourceProbeResult,
} from "@/modules/results";
import {
  JOBS_QUEUE_GP_PRICES,
  JOBS_QUEUE_RESULTS_POLL,
  PROVISIONAL_RESULTS_POLL,
  PROVISIONAL_SOURCE_PROBE,
} from "@/shared/config";
import type { ResultEventKind } from "@/shared/types";

import type { ProbeStateStore } from "../probe-state";
import { redisProbeStateStore } from "../probe-state-redis";
import { getQueueStatus, type QueueStatus } from "../queues";
import { isSentryEnabled } from "../sentry";
import { adminProcedure, router } from "../trpc";

export interface AdminRouterDeps {
  /**
   * Implementación del probe (default: `probeSource` con el fetch global).
   * Inyectable para tests sin red.
   */
  probeSourceImpl?: (deps: {
    fetchImpl: typeof fetch;
    timeoutMs: number;
  }) => Promise<SourceProbeResult>;
  /** Estado del health-check (default: Redis; memoria en tests). */
  probeStateStore?: ProbeStateStore;
}

/** Alerta activa: (GP, evento) por encima del umbral de fallos (US-17). */
export interface ActiveSourceAlert {
  gpId: string;
  event: ResultEventKind;
  source: string;
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
}

/** Respuesta de `admin.jobsStatus` (panel "Jobs y fuentes", T-14). */
export interface JobsStatus {
  queues: QueueStatus[];
  activeAlerts: ActiveSourceAlert[];
  probe: ProbeState | null;
  /** ¿Sentry habilitado (hay `NEXT_PUBLIC_SENTRY_DSN`)? */
  sentryEnabled: boolean;
}

/** Probe por defecto: `probeSource` con el fetch global. */
function defaultProbeSourceImpl({
  fetchImpl,
  timeoutMs,
}: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<SourceProbeResult> {
  return probeSource({ fetchImpl, timeoutMs, now: new Date() });
}

export function createAdminRouter(deps: AdminRouterDeps = {}) {
  const probeSourceImpl = deps.probeSourceImpl ?? defaultProbeSourceImpl;
  const probeStateStore = deps.probeStateStore ?? redisProbeStateStore;

  return router({
    /** Admin activo y sus roles (prueba de acceso al panel). */
    me: adminProcedure.query(({ ctx }) => toPublicUser(ctx.user)),

    /**
     * Estado de los jobs y la fuente (T-14, ADR-0036): colas BullMQ
     * (counts + último fallo), alertas activas, health-check y Sentry.
     * Solo lectura; nunca muta nada.
     */
    jobsStatus: adminProcedure.query(async ({ ctx }): Promise<JobsStatus> => {
      const [pricesQueue, pollQueue] = await Promise.all([
        getQueueStatus(JOBS_QUEUE_GP_PRICES),
        getQueueStatus(JOBS_QUEUE_RESULTS_POLL),
      ]);
      const sourceStates = await ctx.prisma.sourceState.findMany({
        select: {
          gpId: true,
          event: true,
          source: true,
          consecutiveFailures: true,
          lastError: true,
          lastAttemptAt: true,
          lastSuccessAt: true,
        },
      });
      const threshold = PROVISIONAL_RESULTS_POLL.failureAlertThreshold;
      const activeAlerts = sourceStates
        .filter((row) => row.consecutiveFailures >= threshold)
        .map((row) => ({
          gpId: row.gpId,
          event: row.event as ResultEventKind,
          source: row.source,
          consecutiveFailures: row.consecutiveFailures,
          lastError: row.lastError,
          lastAttemptAt: row.lastAttemptAt
            ? row.lastAttemptAt.toISOString()
            : null,
          lastSuccessAt: row.lastSuccessAt
            ? row.lastSuccessAt.toISOString()
            : null,
        }));
      const probe = await probeStateStore.read();
      return {
        queues: [pricesQueue, pollQueue],
        activeAlerts,
        probe,
        sentryEnabled: isSentryEnabled(),
      };
    }),

    /**
     * Probe A DEMANDA a PulseLive (T-14): el admin comprueba ahora mismo si
     * la fuente responde. Es una MUTACIÓN (acción explícita del admin), no
     * una consulta. No toca el estado del probe automático del worker
     * (cada uno tiene su estado; ADR-0036).
     */
    sourceHealth: adminProcedure.mutation(
      async (): Promise<SourceProbeResult> => {
        return probeSourceImpl({
          fetchImpl: fetch,
          timeoutMs: PROVISIONAL_SOURCE_PROBE.timeoutMs,
        });
      },
    ),
  });
}

/** Router por defecto (producción) — export estable (lo usan los tests). */
export const adminRouter = createAdminRouter();
