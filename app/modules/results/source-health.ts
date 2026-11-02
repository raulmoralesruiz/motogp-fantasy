/**
 * Health-check de la fuente de datos (T-14, ADR-0036): sondea el endpoint
 * ligero de PulseLive (`GET /results/seasons`, sin auth) para detectar "la
 * fuente ha dejado de responder" **aunque no haya GPs en la ventana de
 * polling** (el polling de US-17 solo sondea con GP activo).
 *
 * I/O fina con `fetchImpl` inyectado (mismo patrón que
 * `PulseLiveResultsSource` y `ResendEmailSender`: testeable sin red).
 * `now` y la latencia se miden con el reloj real (código de I/O).
 */
import { PULSELIVE_BASE_URL } from "./pulselive-source";

/** Endpoint ligero de sondeo (respuesta pequeña, sin UUIDs de negocio). */
export const PULSELIVE_PROBE_ENDPOINT = "/results/seasons";

/** Resultado de sondear la fuente. */
export interface SourceProbeResult {
  /** `true` si respondió 2xx con la forma esperada (lista de temporadas). */
  ok: boolean;
  /** Latencia en ms (null si no llegó respuesta). */
  latencyMs: number | null;
  /** Motivo del fallo (null si ok); truncado a 500 (coherente con `lastError`). */
  error: string | null;
  /** Momento de la sonda (UTC). */
  probedAt: Date;
}

/**
 * Estado acumulado del health-check (lo mantiene `ProbeStateStore`,
 * persistido en Redis; lo lee `admin.jobsStatus` para el panel de admin).
 * Fechas en ISO (superjson-safe; el estado atraviesa procesos).
 */
export interface ProbeState {
  consecutiveFailures: number;
  lastError: string | null;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastLatencyMs: number | null;
}

export interface SourceProbeDeps {
  /** Implementación de `fetch` (inyectable para tests sin red). */
  fetchImpl: typeof fetch;
  /** Base de la API (default: la del adapter de resultados). */
  baseUrl?: string;
  /** Endpoint a sondear (default: `/results/seasons`). */
  endpoint?: string;
  /** Límite de respuesta (ms) — `PROVISIONAL_SOURCE_PROBE.timeoutMs`. */
  timeoutMs: number;
  /** Momento de la sonda (inyectable para tests). */
  now?: Date;
}

const MAX_ERROR_LENGTH = 500;

/** Trunca el mensaje de error al largo estable de `lastError` (500). */
function truncateError(message: string): string {
  return message.length > MAX_ERROR_LENGTH
    ? message.slice(0, MAX_ERROR_LENGTH)
    : message;
}

/**
 * Ejecuta el probe. Nunca lanza: toda la información de fallo se devuelve
 * en `SourceProbeResult` (el llamador decide alertar según la transición,
 * ADR-0036).
 */
export async function probeSource(
  deps: SourceProbeDeps,
): Promise<SourceProbeResult> {
  const baseUrl = deps.baseUrl ?? PULSELIVE_BASE_URL;
  const endpoint = deps.endpoint ?? PULSELIVE_PROBE_ENDPOINT;
  const startedAt = Date.now();
  const probedAt = deps.now ?? new Date();
  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await deps.fetchImpl(url, {
      method: "GET",
      signal: AbortSignal.timeout(deps.timeoutMs),
      headers: { Accept: "application/json" },
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        error: truncateError(`PulseLive respondió HTTP ${response.status}`),
        probedAt,
      };
    }

    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return {
        ok: false,
        latencyMs,
        error: truncateError(
          "PulseLive no devolvió la lista de temporadas esperada",
        ),
        probedAt,
      };
    }

    return { ok: true, latencyMs, error: null, probedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      latencyMs: null,
      error: truncateError(
        message.toLowerCase().includes("timeout")
          ? `PulseLive no respondió en ${deps.timeoutMs} ms (timeout)`
          : `PulseLive no es alcanzable: ${message}`,
      ),
      probedAt,
    };
  }
}
