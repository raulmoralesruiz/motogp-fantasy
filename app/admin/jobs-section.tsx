"use client";

/**
 * Sección "Jobs y fuentes" del panel de admin (T-14, ADR-0036):
 * - Colas BullMQ: counts (esperas/activas/diferidas/completadas/fallidas)
 *   + último job fallido (motivo y momento).
 * - Fuente PulseLive: estado del health-check automático (probe cada ciclo
 *   del worker) + alertas activas (umbral de US-17) + botón "Comprobar
 *   fuente" (probe a demanda, `admin.sourceHealth`).
 * - Sentry: habilitado o desactivado (DSN).
 *
 * Solo `global_admin` (server-side: `adminProcedure`); la UI es una vista
 * (AGENTS.md §8). Refresco cada 30 s (panel de monitorización, no de datos
 * de juego).
 */
import { useState } from "react";

import { resultEventLabel } from "@/modules/results/core";
import type { SourceProbeResult } from "@/modules/results";
import { Alert, Button } from "@/shared/components";
import { trpc } from "@/trpc/client";

/** Fecha y hora para la UI de admin (es-ES). */
function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Contadores de una cola (fila del estado). */
function QueueCounts({
  name,
  counts,
  lastFailed,
}: {
  name: string;
  counts: {
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
  };
  lastFailed: {
    name: string;
    failedAt: string | null;
    failedReason: string | null;
    attemptsMade: number;
  } | null;
}) {
  return (
    <div>
      <h3>{name}</h3>
      <ul className="status">
        <li>
          en espera: <strong>{counts.waiting}</strong>
        </li>
        <li>
          activos: <strong>{counts.active}</strong>
        </li>
        <li>
          diferidos (reintento): <strong>{counts.delayed}</strong>
        </li>
        <li>
          completados: <strong>{counts.completed}</strong>
        </li>
        <li>
          fallidos: <strong>{counts.failed}</strong>
        </li>
      </ul>
      {lastFailed && (
        <Alert variant="warning">
          Último fallo: «{lastFailed.name}» — {lastFailed.failedReason ?? "sin motivo"}
          {lastFailed.failedAt
            ? ` (${formatDateTime(lastFailed.failedAt)})`
            : ""} tras {lastFailed.attemptsMade} intento(s).
        </Alert>
      )}
    </div>
  );
}

export default function JobsSection() {
  const status = trpc.admin.jobsStatus.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const checkSource = trpc.admin.sourceHealth.useMutation();
  const [probe, setProbe] = useState<SourceProbeResult | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  async function handleProbe() {
    setProbe(null);
    setProbeError(null);
    try {
      setProbe(await checkSource.mutateAsync());
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error));
    }
  }

  if (status.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (status.isError) {
    return (
      <Alert variant="error">
        No se pudo cargar el estado de los jobs: {status.error.message}
      </Alert>
    );
  }

  const { queues, activeAlerts, probe: probeState, sentryEnabled } = status.data;

  return (
    <div className="stack">
      <div>
        <h3>Colas de jobs (BullMQ)</h3>
        <div className="stack">
          {queues.map((queue) => (
            <QueueCounts
              key={queue.name}
              name={queue.name}
              counts={{
                waiting: queue.waiting,
                active: queue.active,
                delayed: queue.delayed,
                completed: queue.completed,
                failed: queue.failed,
              }}
              lastFailed={queue.lastFailedJob}
            />
          ))}
        </div>
      </div>

      <div>
        <h3>Fuente de datos (PulseLive)</h3>
        {probeState ? (
          <ul className="status">
            <li>
              última comprobación:{" "}
              <strong>{formatDateTime(probeState.lastAttemptAt)}</strong>
              {probeState.lastLatencyMs != null && ` (${probeState.lastLatencyMs} ms)`}
            </li>
            <li>
              fallos consecutivos: <strong>{probeState.consecutiveFailures}</strong>
            </li>
            <li>
              último éxito:{" "}
              {probeState.lastSuccessAt
                ? formatDateTime(probeState.lastSuccessAt)
                : "sin éxito registrado"}
            </li>
            {probeState.lastError && (
              <li>
                último error: <code>{probeState.lastError}</code>
              </li>
            )}
          </ul>
        ) : (
          <p className="muted">Aún no hay comprobaciones registradas.</p>
        )}

        {activeAlerts.length > 0 ? (
          <div>
            <h4>Alertas activas (umbral alcanzado)</h4>
            <ul className="status">
              {activeAlerts.map((alert) => (
                <li key={`${alert.gpId}:${alert.event}`}>
                  <strong>{resultEventLabel(alert.event)}</strong> — GP{" "}
                  <code>{alert.gpId.slice(0, 8)}</code>: {alert.consecutiveFailures}{" "}
                  fallos
                  {alert.lastError ? (
                    <>
                      {" "}
                      (<code>{alert.lastError}</code>)
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted spaced">
            Sin alertas activas (ningún auto-import por encima del umbral).
          </p>
        )}

        <div className="action-row">
          <Button
            type="button"
            onClick={() => void handleProbe()}
            disabled={checkSource.isPending}
          >
            {checkSource.isPending ? "Comprobando…" : "Comprobar fuente ahora"}
          </Button>
        </div>
        {probeError && <Alert variant="error">{probeError}</Alert>}
        {probe &&
          (probe.ok ? (
            <Alert variant="success">
              PulseLive responde (latencia: {probe.latencyMs} ms,{" "}
              {formatDateTime(probe.probedAt.toISOString())}).
            </Alert>
          ) : (
            <Alert variant="error">PulseLive no responde: {probe.error}</Alert>
          ))}
      </div>

      <div>
        <h3>Sentry (errores)</h3>
        {sentryEnabled ? (
          <Alert variant="success">
            Activo: los errores de la web, el worker y los jobs llegan al proyecto de
            Sentry (DSN fijado).
          </Alert>
        ) : (
          <Alert variant="info">
            Desactivado: fija <code>NEXT_PUBLIC_SENTRY_DSN</code> y haz build para
            activarlo.
          </Alert>
        )}
      </div>
    </div>
  );
}
