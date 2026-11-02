/**
 * Worker de background (T-10, ADR-0034): consume las colas BullMQ.
 *
 * - `gp-prices`: aplica la fórmula de precios (US-08) con lock por GP — un
 *   job a la vez por GP (CA de T-10). Si el lock está ocupado, reintenta con
 *   backoff (BullMQ); la idempotencia de `applyFormulaForGp` evita duplicados.
 * - `results-poll`: polling periódico de resultados (US-17), job repeatable
 *   registrado al arrancar (cada `PROVISIONAL_RESULTS_POLL.intervalMinutes`).
 *
 * Orquesta los módulos (`market`, `results`, `jobs`); nunca al revés
 * (dirección de dependencias: `jobs/` orquesta módulos).
 *
 * Ejecución: `npm run worker` (tsx worker/index.ts). Contenedor `motogp-worker`.
 * Requiere `DATABASE_URL` + `REDIS_URL` en el entorno (validados por Zod).
 */
import { Worker, type Job } from "bullmq";

import { applyPricesForGp, pollResults } from "@/modules/jobs";
import { PriceService } from "@/modules/market";
import { PulseLiveResultsSource, ResultsService } from "@/modules/results";
import {
  JOBS_QUEUE_GP_PRICES,
  JOBS_QUEUE_RESULTS_POLL,
  PROVISIONAL_JOBS,
} from "@/shared/config/jobs";
import { PROVISIONAL_RESULTS_POLL } from "@/shared/config/results-poll";
import { getServerEnv } from "@/server/env";
import { prisma } from "@/server/prisma";
import { redisGpLockStore } from "@/server/gp-lock-redis";
import { ensureResultsPollScheduler } from "@/server/queues";
import { createEventRefResolver } from "@/server/event-ref-resolver";

// ── Dependencias (DI) ──────────────────────────────────────────────────────
const source = new PulseLiveResultsSource({
  eventRefResolver: createEventRefResolver(prisma),
});
const priceService = new PriceService({ prisma });
const resultsService = new ResultsService({ prisma, source, eventCatalog: source });

function connection() {
  return { url: getServerEnv().REDIS_URL, maxRetriesPerRequest: null };
}

// ── Processors ─────────────────────────────────────────────────────────────
async function processGpPrices(job: Job): Promise<void> {
  const { gpId } = job.data as { gpId: string };
  const out = await applyPricesForGp(gpId, {
    priceService,
    lockStore: redisGpLockStore,
  });
  if (out.locked) {
    // Lock ocupado por otro job del mismo GP: reintenta (BullMQ backoff).
    // Si el dueño termina, libera; si muere, el lock expira por TTL.
    throw new Error(
      `gp-prices: lock ocupado para GP ${gpId} (reintento ${job.attemptsMade + 1}/${PROVISIONAL_JOBS.attempts})`,
    );
  }
  console.log(
    `[gp-prices] GP ${gpId}: created=${out.result?.created} updated=${out.result?.updated} unchanged=${out.result?.unchanged} skippedLocked=${out.result?.skippedLocked}`,
  );
}

async function processResultsPoll(): Promise<void> {
  const now = new Date();
  const out = await pollResults(now, { prisma, resultsService });
  const imported = out.outcomes.filter((o) => o.kind === "imported").length;
  const skipped = out.outcomes.filter((o) => o.kind === "skipped").length;
  const failed = out.outcomes.filter((o) => o.kind === "failed").length;
  console.log(
    `[results-poll] imported=${imported} skipped=${skipped} failed=${failed} alerts=${out.alerts.length}`,
  );
}

// ── Arranque ───────────────────────────────────────────────────────────────
const workers: Worker[] = [];

async function main(): Promise<void> {
  // Job repeatable de polling (idempotente: re-arrancar no duplica).
  await ensureResultsPollScheduler(
    PROVISIONAL_RESULTS_POLL.intervalMinutes * 60 * 1000,
  );

  const pricesWorker = new Worker(JOBS_QUEUE_GP_PRICES, processGpPrices, {
    connection: connection(),
    concurrency: 1,
  });
  const pollWorker = new Worker(JOBS_QUEUE_RESULTS_POLL, processResultsPoll, {
    connection: connection(),
    concurrency: 1,
  });
  workers.push(pricesWorker, pollWorker);

  pricesWorker.on("failed", (job, error) =>
    console.error(`[gp-prices] fallo ${job?.id}: ${error.message}`),
  );
  pollWorker.on("failed", (job, error) =>
    console.error(`[results-poll] fallo ${job?.id}: ${error.message}`),
  );

  console.log(
    `[worker] listo: ${JOBS_QUEUE_GP_PRICES} + ${JOBS_QUEUE_RESULTS_POLL} ` +
      `(poll cada ${PROVISIONAL_RESULTS_POLL.intervalMinutes} min)`,
  );
}

function shutdown(signal: string): void {
  console.log(`[worker] ${signal}: cerrando...`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref?.();
  Promise.allSettled(workers.map((w) => w.close()))
    .then(() => prisma.$disconnect())
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[worker] fallo al arrancar:", error);
  process.exit(1);
});
