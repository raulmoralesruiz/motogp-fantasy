/**
 * Colas BullMQ de los jobs de background (T-10, ADR-0034).
 *
 * - `gp-prices`: un job por GP (aplica la fórmula de precios, US-08). La web
 *   la encola al marcar el GP definitivo (`markDefinitive`); el worker la
 *   consume (`worker/index.ts`).
 * - `results-poll`: job repeatable de polling de resultados (US-17). El
 *   worker la registra al arrancar y la consume.
 *
 * Conexión: BullMQ crea su propia conexión desde `REDIS_URL` (con
 * `maxRetriesPerRequest: null`, requisito de BullMQ). La creación de la cola
 * es **perezosa** (al primer uso) para que importar este módulo no exija el
 * entorno ni conecte a Redis.
 */
import { Queue } from "bullmq";

import {
  JOBS_QUEUE_GP_PRICES,
  JOBS_QUEUE_RESULTS_POLL,
  PROVISIONAL_JOBS,
  type JobsConfig,
} from "@/shared/config/jobs";

import { getServerEnv } from "./env";

function connection() {
  return { url: getServerEnv().REDIS_URL, maxRetriesPerRequest: null };
}

function jobOptions(config: JobsConfig = PROVISIONAL_JOBS) {
  return {
    attempts: config.attempts,
    backoff: { type: "exponential", delay: config.backoffMs },
  };
}

let gpPricesQueue: Queue | null = null;
function getGpPricesQueue(): Queue {
  gpPricesQueue ??= new Queue(JOBS_QUEUE_GP_PRICES, {
    connection: connection(),
  });
  return gpPricesQueue;
}

/**
 * Encola la fórmula de precios para un GP (US-08, disparo automático T-10).
 * El worker la procesa con lock por GP (un job a la vez por GP).
 */
export async function enqueueGpPrices(gpId: string): Promise<void> {
  await getGpPricesQueue().add("apply-formula", { gpId }, jobOptions());
}

/**
 * Disparo **fire-and-forget** de un job (T-10, ADR-0034): encola sin bloquear
 * el flujo principal que lo invoca; un fallo de cola se loguea y NO se
 * propaga (el admin puede re-disparar manualmente, p. ej.
 * `market.prices.applyFormula`). Se usa en `results.markDefinitive`.
 *
 * `label` identifica la cola en el log (p. ej. `"gp-prices"`).
 */
export function enqueueFireAndForget(
  label: string,
  enqueue: (gpId: string) => Promise<void>,
  gpId: string,
): void {
  void enqueue(gpId).catch((error) => {
    console.error(
      `[jobs] fallo al encolar ${label} (GP ${gpId}):`,
      error instanceof Error ? error.message : error,
    );
  });
}

let resultsPollQueue: Queue | null = null;
function getResultsPollQueue(): Queue {
  resultsPollQueue ??= new Queue(JOBS_QUEUE_RESULTS_POLL, {
    connection: connection(),
  });
  return resultsPollQueue;
}

/**
 * Registra (o actualiza) el job repeatable de polling de resultados (US-17,
 * T-10): se ejecuta cada `intervalMs` (UTC). Lo llama el worker al arrancar
 * (`upsertJobScheduler` es idempotente: re-arrancar el worker no duplica el
 * scheduler).
 */
export async function ensureResultsPollScheduler(intervalMs: number): Promise<void> {
  await getResultsPollQueue().upsertJobScheduler(
    "results-poll:repeatable",
    { every: intervalMs, tz: "UTC" },
    {},
  );
}

// ── Estado de colas (T-14, ADR-0036: panel "Jobs y fuentes") ───────────────

/** Estado de una cola para el panel de administración. */
export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  /** Último job fallido (BullMQ guarda la historia; `null` si nunca falló). */
  lastFailedJob: {
    id: string | null;
    name: string;
    /** ISO (superjson-safe). */
    failedAt: string | null;
    failedReason: string | null;
    attemptsMade: number;
  } | null;
}

const statusQueues = new Map<string, Queue>();

function getStatusQueue(name: string): Queue {
  let queue = statusQueues.get(name);
  if (!queue) {
    // Lazy: solo se crea al consultar el estado (no al importar el módulo).
    queue = new Queue(name, { connection: connection() });
    statusQueues.set(name, queue);
  }
  return queue;
}

/**
 * Counts + último fallo de una cola BullMQ (T-14). Propaga el error si no
 * se puede leer (p. ej. Redis no disponible): el router lo convierte en un
 * mensaje claro en español.
 */
export async function getQueueStatus(name: string): Promise<QueueStatus> {
  const queue = getStatusQueue(name);
  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "delayed",
    "completed",
    "failed",
  );
  const [last] = await queue.getFailed(0, 0);
  return {
    name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    delayed: counts.delayed ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    lastFailedJob: last
      ? {
          id: last.id ?? null,
          name: last.name,
          // BullMQ: `finishedOn` = momento de fin (en un job fallido, el fallo).
          failedAt:
            last.finishedOn != null
              ? new Date(last.finishedOn).toISOString()
              : null,
          failedReason: last.failedReason,
          attemptsMade: last.attemptsMade,
        }
      : null,
  };
}
