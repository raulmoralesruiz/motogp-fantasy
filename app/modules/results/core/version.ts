/**
 * Versionado de resultados (`results_version`) — FÓRMULA PURA (sin I/O).
 *
 * ADR-0018: formato `rv-<seq>` (seq desde 1), alcance POR GP. Las filas
 * importadas antes del primer recálculo tienen `results_version = null`.
 * Cada recálculo (US-18/US-19) asigna la siguiente versión a todas las
 * filas del GP; la anterior nunca se muta.
 */

const RESULTS_VERSION_PATTERN = /^rv-(\d+)$/;

/**
 * Parsea una `results_version` (`rv-<seq>`); devuelve `null` si el formato
 * no encaja.
 */
export function parseResultsVersion(version: string): number | null {
  const match = RESULTS_VERSION_PATTERN.exec(version);
  return match ? Number(match[1]) : null;
}

/**
 * Siguiente `results_version` de un GP (ADR-0018): `rv-1` si el GP aún no
 * tiene versión, `rv-<seq+1>` en caso contrario. Lanza si la versión
 * actual existe pero no es reconocible (dato corrupto: no se reinicia en
 * silencio).
 */
export function nextResultsVersion(current: string | null): string {
  if (current === null) {
    return "rv-1";
  }
  const seq = parseResultsVersion(current);
  if (seq === null) {
    throw new Error(
      `results_version no reconocible: «${current}» (se esperaba rv-<seq>)`,
    );
  }
  return `rv-${seq + 1}`;
}
