/**
 * Worker de background (T-10, ADR-0034; T-14, ADR-0036): consume las
 * colas BullMQ.
 *
 * - `gp-prices`: aplica la fórmula de precios (US-08) con lock por GP — un
 *   job a la vez por GP (CA de T-10). Si el lock está ocupado, reintenta con
 *   backoff (BullMQ); la idempotencia de `applyFormulaForGp` evita duplicados.
 * - `results-poll`: ciclo de polling de resultados (US-17) **con health-check
 *   de la fuente y alertas** (T-14, ADR-0036): probe de PulseLive aunque no
 *   haya GPs en ventana, polling y alertas en transición (email + Sentry).
 *
 * Monitoreo (T-14, ADR-0036):
 * - Sentry (`@sentry/node`): si hay `NEXT_PUBLIC_SENTRY_DSN` captura el
 *   **fallo final** de cada job (tras agotar reintentos) y el fallo de
 *   arranque; sin DSN es un no-op (modo provisional).
 * - Alertas: `OPS_ALERT_EMAIL` + Sentry, vía `createAlertSink` (nunca lanza).
 *
 * Orquesta los módulos (`market`, `results`, `jobs`); nunca al revés
 * (dirección de dependencias: `jobs/` orquesta módulos).
 *
 * Ejecución: `npm run worker` (tsx worker/index.ts). Contenedor `motogp-worker`.
 * Requiere `DATABASE_URL` + `REDIS_URL` en el entorno (validados por Zod).
 */
import { Worker, type Job } from "bullmq";

import * as Sentry from "@sentry/node";

import {
  applyPricesForGp,
  isFinalFailure,
  type OpsAlert,
} from "@/modules/jobs";
import { PriceService } from "@/modules/market";
import { chooseNotificationSender } from "@/modules/notifications";
import { PulseLiveResultsSource, ResultsService } from "@/modules/results";
import {
  JOBS_QUEUE_GP_PRICES,
  JOBS_QUEUE_RESULTS_POLL,
  PROVISIONAL_JOBS,
  PROVISIONAL_RESULTS_POLL,
  PROVISIONAL_SOURCE_PROBE,
} from "@/shared/config";

import { createAlertSink, type AlertSink } from "@/server/alert-sink";
import { getServerEnv } from "@/server/env";
import { prisma } from "@/server/prisma";
import { redisGpLockStore } from "@/server/gp-lock-redis";
import { runResultsPollCycle } from "@/server/poll-cycle";
import { redisProbeStateStore } from "@/server/probe-state-redis";
import { ensureResultsPollScheduler } from "@/server/queues";
import { createEventRefResolver } from "@/server/event-ref-resolver";
import { captureException } from "@/server/sentry";

// ── Monitoreo (T-14, ADR-0036) ─────────────────────────────────────────────

const env = getServerEnv();

// Sentry: solo si hay DSN (no-op en modo provisional).
if (env.NEXT_PUBLIC_SENTRY_DSN && env.NEXT_PUBLIC_SENTRY_DSN.trim()) {
  Sentry.init({
    dsn: env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    // Solo errores; sin tracing.
  });
}

/**
 * Sink de alertas del worker (email + Sentry + log). El sender reutiliza el
 * de US-36 (Resend si hay API key; log provisional si no, ADR-0033).
 */
const alertSink: AlertSink = createAlertSink({
  to: env.OPS_ALERT_EMAIL,
  sender: chooseNotificationSender({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
  }),
});

/** Entrega una alerta de fallo final de job (el sink nunca lanza). */
function sendJobFailedAlert(queue: string, job: Job, error: Error): void {
  const alert: OpsAlert = {
    kind: "job-failed",
    queue,
    jobId: job.id ?? "desconocida",
    attempts: job.attemptsMade,
    reason: error.message,
  };
  void alertSink.send(alert).catch((err) => {
    console.error("[worker] fallo inesperado entregando la alerta:", err);
  });
}

/**
 * Handler de `failed` de BullMQ (T-14): log de SIEMPRE (reintentos
 * incluidos) +, solo en el **fallo final** (agotados los reintentos),
 * captura en Sentry + alerta por email (uno por job, no por reintento).
 */
function onJobFailed(queue: string) {
  return (job: Job | undefined, error: Error) => {
    console.error(`[${queue}] fallo ${job?.id}: ${error.message}`);
    if (!job || !isFinalFailure(job.attemptsMade, PROVISIONAL_JOBS.attempts)) {
      return; // reintento pendiente: solo log
    }
    captureException(error, {
      "job.queue": queue,
      "job.id": job.id ?? "desconocida",
      "job.attempts": String(job.attemptsMade),
    });
    sendJobFailedAlert(queue, job, error);
  };
}

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
  const out = await runResultsPollCycle(now, {
    prisma,
    resultsService,
    probe: { fetchImpl: fetch },
    probeConfig: PROVISIONAL_SOURCE_PROBE,
    pollConfig: PROVISIONAL_RESULTS_POLL,
    probeState: redisProbeStateStore,
    alertSink,
  });
  const imported = out.poll.outcomes.filter((o) => o.kind === "imported").length;
  const skipped = out.poll.outcomes.filter((o) => o.kind === "skipped").length;
  const failed = out.poll.outcomes.filter((o) => o.kind === "failed").length;
  console.log(
    `[results-poll] probe=${out.probe.result.ok ? "ok" : "fallo"} imported=${imported} skipped=${skipped} failed=${failed} alertas=${out.alerts.length}`,
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

  pricesWorker.on("failed", onJobFailed(JOBS_QUEUE_GP_PRICES));
  pollWorker.on("failed", onJobFailed(JOBS_QUEUE_RESULTS_POLL));

  console.log(
    `[worker] listo: ${JOBS_QUEUE_GP_PRICES} + ${JOBS_QUEUE_RESULTS_POLL} ` +
      `(poll cada ${PROVISIONAL_RESULTS_POLL.intervalMinutes} min, probe de fuente incluido) ` +
      `[sentry=${env.NEXT_PUBLIC_SENTRY_DSN ? "activo" : "inactivo"} alertas=${env.OPS_ALERT_EMAIL ? env.OPS_ALERT_EMAIL : "sin email"}]`,
  );
}

function shutdown(signal: string): void {
  console.log(`[worker] ${signal}: cerrando...`);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref?.();
  // Deja ir las capturas pendientes antes de salir (no-op si no hay DSN).
  void Sentry.flush(2000)
    .then(() => Promise.allSettled(workers.map((w) => w.close())))
    .then(() => prisma.$disconnect())
    .finally(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[worker] fallo al arrancar:", error);
  // T-14: el fallo de arranque también va a Sentry (si está habilitado).
  captureException(error, { "worker": "startup" });
  process.exit(1);
});
