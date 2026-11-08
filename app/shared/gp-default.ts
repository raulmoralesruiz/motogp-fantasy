/**
 * GP por defecto de las páginas de LECTURA (`/resultados`, `/puntuacion`):
 * el último GP con resultados (el que interesa al fan), no el próximo
 * programado (que aún no tiene nada que ver).
 *
 * Criterio (S2 P3 #2, 2026-11-08):
 * 1. El GP `finished` de mayor ronda — `finished` = "publicación de los
 *    resultados definitivos" (gp-status.ts): la señal de que hay datos.
 * 2. Si la temporada no tiene GPs finalizados (temporada recién abierta),
 *    el primer GP `scheduled` por ronda (comportamiento previo).
 * 3. `null` si no hay ninguno (el selector se queda en "— GP —").
 *
 * Las páginas de ACCIÓN (`/mercado`, `/lineups`) NO usan este helper: abren
 * en el próximo programado, donde el usuario puede actuar.
 *
 * Módulo puro (sin I/O): recibe la lista de GPs y devuelve el id por
 * defecto, o `null`.
 */
export interface GpLike {
  id: string;
  round: number;
  // `string` a propósito: la unión canónica vive en
  // `modules/seasons/gp-status.ts` (inaccesible desde `shared/` por layering).
  // Solo se comparan los valores que este helper conoce ("finished",
  // "scheduled"); el resto ("locked", "cancelled") cae a `null`/fallback.
  // Nombre `GpLike` (no `GpStatus`) para no colisionar con `GpStatus` de
  // `shared/types` (estado del piloto en el resultado, otra cosa).
  status: string;
}

export function defaultGpId(gps: readonly GpLike[]): string | null {
  const finished = gps
    .filter((g) => g.status === "finished")
    .sort((a, b) => b.round - a.round);
  const lastFinished = finished[0];
  if (lastFinished) return lastFinished.id;
  const scheduled = gps
    .filter((g) => g.status === "scheduled")
    .sort((a, b) => a.round - b.round);
  const firstScheduled = scheduled[0];
  return firstScheduled ? firstScheduled.id : null;
}
