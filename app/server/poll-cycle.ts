/**
 * Ciclo de polling de resultados con alertas (T-14, ADR-0036) — la
 * orquestación que ejecuta el worker de `results-poll`:
 *
 * 1. **Probe de la fuente** (health-check): sondea PulseLive AUNQUE no
 *    haya GPs en la ventana (CA de T-14: "la fuente alerta si deja de
 *    responder"); el estado persiste en `ProbeStateStore` (Redis).
 * 2. **Polling de resultados** (US-17, `pollResults`).
 * 3. **Alertas en transición** (ADR-0036): se avisa al cruzar el umbral de
 *    fallos y al recuperar — NUNCA se repite mientras el fallo persiste
 *    (evita un email por ciclo de 5 min).
 *
 * Extracción de `worker/index.ts` para testabilidad: el worker no debe
 * auto-ejecutarse al importarse. Todas las dependencias se inyectan
 * (prisma, servicio, fetch, stores, sink) — testeable sin red ni Redis.
 */
import type { PrismaClient } from "@prisma/client";

import {
  evaluateAlertTransition,
  pollResults,
  type AlertTransition,
  type OpsAlert,
  type PollResultsResult,
  type ResultsPollDeps,
} from "@/modules/jobs";
import {
  probeSource,
  type ProbeState,
  type SourceProbeResult,
} from "@/modules/results";
import { resultEventLabel } from "@/modules/results/core";
import type { ResultsPollConfig, SourceProbeConfig } from "@/shared/config";
import type { ResultEventKind } from "@/shared/types";

import type { AlertSink } from "./alert-sink";
import type { ProbeStateStore } from "./probe-state";

/** Dependencias del ciclo (todo inyectable para tests). */
export interface PollCycleDeps extends ResultsPollDeps {
  /** Probe de la fuente: fetch + URLs (defaults del adapter si no se fijan). */
  probe: {
    fetchImpl: typeof fetch;
    baseUrl?: string;
    endpoint?: string;
  };
  /** Configuración del probe (timeout + umbral de alerta). */
  probeConfig: SourceProbeConfig;
  /** Configuración del polling (ventana + umbral de alerta). */
  pollConfig: ResultsPollConfig;
  /** Estado del health-check (Redis en prod; memoria en tests). */
  probeState: ProbeStateStore;
  /** Entrega de alertas (email + Sentry + log; nunca lanza). */
  alertSink: AlertSink;
}

export interface PollCycleResult {
  /** Resultado y estado del probe de la fuente. */
  probe: {
    result: SourceProbeResult;
    state: ProbeState;
    transition: AlertTransition;
  };
  /** Resultado del polling de resultados (US-17). */
  poll: PollResultsResult;
  /** Alertas enviadas en este ciclo (0 si no hubo transición). */
  alerts: OpsAlert[];
}

/** Nombres de GP de un conjunto de IDs (para los mensajes de alerta). */
async function gpNames(
  prisma: PrismaClient,
  gpIds: string[],
): Promise<Map<string, string>> {
  if (gpIds.length === 0) return new Map();
  const rows = await prisma.gp.findMany({
    where: { id: { in: gpIds } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name] as const));
}

/** Envía una alerta sin que su fallo (imposible por contrato) rompa el ciclo. */
async function safeSend(
  sink: AlertSink,
  alert: OpsAlert,
  sent: OpsAlert[],
): Promise<void> {
  try {
    await sink.send(alert);
    sent.push(alert);
  } catch (error) {
    console.error(
      "[poll-cycle] fallo inesperado entregando la alerta:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Ejecuta un ciclo completo (probe + polling + alertas). `now` se inyecta
 * (testable sin reloj real, coherente con US-17).
 */
export async function runResultsPollCycle(
  now: Date,
  deps: PollCycleDeps,
): Promise<PollCycleResult> {
  const alerts: OpsAlert[] = [];

  // 1) Probe de la fuente (independiente de la ventana de GPs).
  const probeResult = await probeSource({
    fetchImpl: deps.probe.fetchImpl,
    baseUrl: deps.probe.baseUrl,
    endpoint: deps.probe.endpoint,
    timeoutMs: deps.probeConfig.timeoutMs,
    now,
  });
  const prevProbe = await deps.probeState.read();
  const probeStateNext = await deps.probeState.recordAttempt({
    ok: probeResult.ok,
    error: probeResult.error,
    latencyMs: probeResult.latencyMs,
    at: probeResult.probedAt,
  });
  const probeTransition = evaluateAlertTransition(
    prevProbe?.consecutiveFailures ?? 0,
    probeStateNext.consecutiveFailures,
    deps.probeConfig.failureAlertThreshold,
  );
  if (probeTransition === "threshold_reached") {
    await safeSend(
      deps.alertSink,
      {
        kind: "source-probe-failure",
        consecutiveFailures: probeStateNext.consecutiveFailures,
        lastError: probeResult.error ?? "sin detalle",
      },
      alerts,
    );
  } else if (probeTransition === "recovered") {
    await safeSend(
      deps.alertSink,
      {
        kind: "source-probe-recovered",
        lastLatencyMs: probeResult.latencyMs,
      },
      alerts,
    );
  }

  // 2) Polling de resultados (US-17). Antes: quiénes estaban en alerta
  //    (para detectar recuperaciones tras el ciclo). `source_state` tiene
  //    clave compuesta (gpId, event, source): se empareja por ese triple.
  type SourceStateRow = {
    gpId: string;
    event: string;
    source: string;
    consecutiveFailures: number;
  };
  const keyOf = (row: { gpId: string; event: string; source: string }) =>
    `${row.gpId}|${row.event}|${row.source}`;

  const failingBefore = (
    await deps.prisma.sourceState.findMany({
      where: {
        consecutiveFailures: { gte: deps.pollConfig.failureAlertThreshold },
      },
      select: { gpId: true, event: true, source: true, consecutiveFailures: true },
    })
  ) as SourceStateRow[];
  const poll = await pollResults(
    now,
    { prisma: deps.prisma, resultsService: deps.resultsService },
    deps.pollConfig,
  );

  // 3) Alertas del polling (transiciones), con nombres de GP para el mensaje.
  const relevantGpIds = [
    ...new Set([
      ...poll.outcomes.filter((o) => o.kind === "failed").map((o) => o.gpId),
      ...failingBefore.map((r) => r.gpId),
    ]),
  ];
  const names = await gpNames(deps.prisma, relevantGpIds);
  const nameOf = (gpId: string) => names.get(gpId) ?? `GP ${gpId.slice(0, 8)}`;

  for (const outcome of poll.outcomes) {
    if (outcome.kind !== "failed") continue;
    // `recordSourceFailure` incrementa en 1: prev = new − 1.
    const transition = evaluateAlertTransition(
      outcome.consecutiveFailures - 1,
      outcome.consecutiveFailures,
      deps.pollConfig.failureAlertThreshold,
    );
    if (transition === "threshold_reached") {
      await safeSend(
        deps.alertSink,
        {
          kind: "source-poll-failure",
          gpName: nameOf(outcome.gpId),
          eventLabel: resultEventLabel(outcome.event),
          consecutiveFailures: outcome.consecutiveFailures,
          lastError: outcome.error,
        },
        alerts,
      );
    }
  }

  // 4) Recuperaciones del polling (estaban en alerta y ya no).
  if (failingBefore.length > 0) {
    const after = (
      await deps.prisma.sourceState.findMany({
        where: {
          OR: failingBefore.map((r) => ({
            gpId: r.gpId,
            event: r.event,
            source: r.source,
          })),
        },
        select: {
          gpId: true,
          event: true,
          source: true,
          consecutiveFailures: true,
        },
      })
    ) as SourceStateRow[];
    for (const row of failingBefore) {
      const current = after.find((a) => keyOf(a) === keyOf(row));
      if (
        current === undefined ||
        current.consecutiveFailures >= deps.pollConfig.failureAlertThreshold
      ) {
        continue;
      }
      await safeSend(
        deps.alertSink,
        {
          kind: "source-poll-recovered",
          gpName: nameOf(row.gpId),
          eventLabel: resultEventLabel(
            row.event as unknown as ResultEventKind,
          ),
        },
        alerts,
      );
    }
  }

  return {
    probe: {
      result: probeResult,
      state: probeStateNext,
      transition: probeTransition,
    },
    poll,
    alerts,
  };
}
