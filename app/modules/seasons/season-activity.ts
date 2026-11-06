/**
 * Selección de temporada para la consola del fin de semana del panel de
 * administración (impeccable P1-1): fórmula PURA de «¿sobre qué temporada
 * opera la consola?» a partir de la actividad por temporada.
 *
 * Problema que resuelve: la consola elegía «la temporada más reciente por
 * año» y, en una BD viva con temporadas de test, acababa apuntando a una
 * temporada sin GPs → «Siguiente paso» vacío, sin distinguir «sistema
 * sano, nada que hacer», «hay trabajo pendiente en otra temporada» y
 * «todavía no hay nada» (crítica 2026-11-05, P1-1).
 *
 * Regla (orden de prioridad):
 * 1. `open` — temporadas con GPs sin cerrar (estados no terminales,
 *    derivados de la tabla de transiciones de `gp-status.ts`). Varias
 *    candidatas → la de mayor año (la más reciente con trabajo
 *    pendiente).
 * 2. `closed` — ninguna tiene GPs sin cerrar, pero hay GPs: la más
 *    reciente (año) que tiene GPs. La consola la presenta como «cerrada,
 *    sin pendientes».
 * 3. `empty` — ninguna temporada tiene GPs (o no hay temporadas): la
 *    consola dice por qué y ofrece las salidas (crear temporada, añadir
 *    GPs, importar calendario).
 *
 * Módulo puro (sin I/O, patrón `economy`/`scoring`): `GpService`
 * calcula la actividad contra la BD (`seasonActivity`) y la UI aplica
 * esta selección y escribe el motivo y las salidas (la copia vive en la
 * UI, como en el resto del panel).
 */

/** Actividad de una temporada (entrada de la selección). */
export interface SeasonActivity {
  seasonId: string;
  name: string;
  year: number;
  /** Total de GPs de la temporada (todos los estados). */
  totalGps: number;
  /** GPs sin cerrar (estados no terminales: `scheduled`/`locked`). */
  openGps: number;
}

/** Resultado de la selección: la temporada de la consola + el porqué. */
export type ConsoleSeasonSelection =
  | { kind: "open"; activity: SeasonActivity }
  | { kind: "closed"; activity: SeasonActivity }
  | { kind: "empty" };

/** La más reciente (año) de un conjunto no vacío; en empate, la primera. */
function newestByYear(activities: SeasonActivity[]): SeasonActivity {
  return activities.reduce((best, current) =>
    current.year > best.year ? current : best,
  );
}

/**
 * Elige la temporada sobre la que opera la consola (regla 1-2-3 del
 * cabecera). Determinista: en empate de años gana la primera del
 * conjunto (la BD entrega año desc, nombre asc — `GpService`).
 */
export function selectConsoleSeason(
  activities: SeasonActivity[],
): ConsoleSeasonSelection {
  const withGps = activities.filter((a) => a.totalGps > 0);
  const openSeasons = withGps.filter((a) => a.openGps > 0);
  if (openSeasons.length > 0) {
    return { kind: "open", activity: newestByYear(openSeasons) };
  }
  if (withGps.length > 0) {
    return { kind: "closed", activity: newestByYear(withGps) };
  }
  return { kind: "empty" };
}
