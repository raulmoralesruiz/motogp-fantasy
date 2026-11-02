/**
 * Alertas operativas (T-14, ADR-0036) — NÚCLEO PURO (sin I/O).
 *
 * Política de **transición** (la clave anti-spam): se alerta solo cuando
 * los fallos consecutivos **cruzan** el umbral y cuando **recuperan**.
 * Mientras el fallo persiste por encima del umbral NO se repite la
 * alerta (el polling corre cada 5 min: repetir en cada ciclo saturaría el
 * buzón durante horas por un mismo incidente).
 *
 * Aplica a las tres fuentes de fallo (ADR-0036):
 * - polling de resultados (US-17): `source_state.consecutive_failures`;
 * - probe de la fuente (T-14): estado del health-check de PulseLive;
 * - fallo final de job BullMQ (agota `attempts`).
 *
 * Sin I/O: solo recibe y devuelve datos (mismo espíritu que `economy` y
 * `scoring`; lo ejecuta la capa de servidor `app/server/poll-cycle.ts`).
 */

/** Transición de un contador de fallos respecto al umbral (N). */
export type AlertTransition = "threshold_reached" | "recovered" | "none";

/**
 * Evalúa la transición de `prevFailures` → `newFailures` contra el umbral
 * `threshold` (≥ 1):
 * - `"threshold_reached"`: `prev < threshold ∧ new ≥ threshold` (se alerta);
 * - `"recovered"`: `prev ≥ threshold ∧ new < threshold` (se avisa del OK);
 * - `"none"`: no hay cambio de estado (no se alerta).
 */
export function evaluateAlertTransition(
  prevFailures: number,
  newFailures: number,
  threshold: number,
): AlertTransition {
  if (prevFailures < threshold && newFailures >= threshold) {
    return "threshold_reached";
  }
  if (prevFailures >= threshold && newFailures < threshold) {
    return "recovered";
  }
  return "none";
}

/**
 * ¿Es el fallo de BullMQ el **último** (agotados los reintentos)?
 * `attemptsMade` es el nº de intentos ya consumidos al fallar;
 * `maxAttempts` viene de `PROVISIONAL_JOBS.attempts` (3).
 */
export function isFinalFailure(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade >= maxAttempts;
}

/**
 * Alerta operativa (unión discriminada): la define quien la detecta
 * (poll-cycle / worker), la formatea este módulo y la entrega el sink
 * (`app/server/alert-sink.ts`: email + Sentry + log).
 */
export type OpsAlert =
  | {
      /** Polling de resultados: (GP, evento) alcanzó el umbral de fallos. */
      kind: "source-poll-failure";
      gpName: string;
      eventLabel: string;
      consecutiveFailures: number;
      lastError: string;
    }
  | {
      /** Polling de resultados: el (GP, evento) volvió a importarse bien. */
      kind: "source-poll-recovered";
      gpName: string;
      eventLabel: string;
    }
  | {
      /** Probe de la fuente: PulseLive no responde (umbral de fallos). */
      kind: "source-probe-failure";
      consecutiveFailures: number;
      lastError: string;
    }
  | {
      /** Probe de la fuente: PulseLive volvió a responder. */
      kind: "source-probe-recovered";
      lastLatencyMs: number | null;
    }
  | {
      /** Job BullMQ falló tras agotar los reintentos. */
      kind: "job-failed";
      queue: string;
      jobId: string;
      attempts: number;
      reason: string;
    };

const SUBJECTS: Record<OpsAlert["kind"], string> = {
  "source-poll-failure": "Auto-import de resultados fallando (umbral alcanzado)",
  "source-poll-recovered": "Auto-import de resultados recuperado",
  "source-probe-failure": "La fuente PulseLive no está respondiendo",
  "source-probe-recovered": "La fuente PulseLive volvió a responder",
  "job-failed": "Un job de fondo falló tras agotar reintentos",
};

/**
 * Asunto del email de alerta (español, AGENTS.md §2). Prefijo estable + la
 * `kind` (stable machine-readable) para filtrado en el buzón.
 */
export function alertSubject(alert: OpsAlert): string {
  return `[alerta motogp] ${alert.kind} — ${SUBJECTS[alert.kind]}`;
}

/**
 * Cuerpo HTML del email de alerta. Mensaje breve y accionable: qué pasó,
 * dato clave (fallos/último error) y qué hacer (ver el panel de admin).
 * Sin datos de usuario (GDPR, AGENTS.md §8): solo datos de juego/operativos.
 */
export function alertBodyHtml(alert: OpsAlert): string {
  const title = SUBJECTS[alert.kind];
  const lines: string[] = [];
  switch (alert.kind) {
    case "source-poll-failure":
      lines.push(
        `<p>El auto-import de resultados de <strong>${alert.gpName}</strong> (${alert.eventLabel}) lleva <strong>${alert.consecutiveFailures}</strong> fallos consecutivos y se mantiene en espera de reintentos.</p>`,
        `<p>Último error: <code>${alert.lastError}</code></p>`,
      );
      break;
    case "source-poll-recovered":
      lines.push(
        `<p>El auto-import de resultados de <strong>${alert.gpName}</strong> (${alert.eventLabel}) ha vuelto a funcionar correctamente.</p>`,
      );
      break;
    case "source-probe-failure":
      lines.push(
        `<p>PulseLive lleva <strong>${alert.consecutiveFailures}</strong> comprobaciones consecutivas sin responder (health-check automático cada 5 min).</p>`,
        `<p>Último error: <code>${alert.lastError}</code></p>`,
      );
      break;
    case "source-probe-recovered":
      lines.push(
        `<p>PulseLive ha vuelto a responder${
          alert.lastLatencyMs != null ? ` (última latencia: ${alert.lastLatencyMs} ms)` : ""
        }.</p>`,
      );
      break;
    case "job-failed":
      lines.push(
        `<p>El job <code>${alert.queue}</code> (id <code>${alert.jobId}</code>) falló tras ${alert.attempts} intentos.</p>`,
        `<p>Motivo: <code>${alert.reason}</code></p>`,
      );
      break;
  }
  lines.push(
    "<p>Puedes revisar el estado en el panel de administración (sección «Jobs y fuentes») y el detalle en los logs del contenedor.</p>",
  );
  return `<h2>${title}</h2>${lines.join("")}`;
}
