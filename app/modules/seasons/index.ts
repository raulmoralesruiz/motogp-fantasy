/**
 * Módulo `seasons` — temporadas, GPs, circuitos y eventos.
 *
 * US-04 (hecho): temporadas con `season_rules` versionado
 * (`SeasonService`, prisma inyectable): creación atómica de Season +
 * versión inicial + auditoría (`season.created`); alta de nuevas versiones
 * de reglas (las versiones publicadas nunca se mutan — AGENTS.md §5;
 * unique `(season, version)`; auditoría `season.rules_version_added`).
 *
 * US-05 (hecho): circuitos, GPs y eventos de fin de semana
 * (`GpService`, prisma inyectable) + import de calendario en 2 pasos
 * (`CalendarSource` + `PulseLiveCalendarSource`, ADR-0012): `calendar.fetch`
 * (preview normalizado) → `calendar.import` (transacción atómica, salta
 * rondas existentes, auditoría `calendar.imported`). Tabla de transiciones
 * de estado pura (`gp-status.ts`): `scheduled → locked → finished/cancelled`.
 *
 * Pendiente: US-06 (mercado), …
 *
 * Responsabilidad:
 * - Temporadas con su versión de reglas (`season_rules` JSONB versionada).
 * - GPs (orden, circuito, estado `scheduled → locked → finished/cancelled`).
 * - Circuitos y eventos del fin de semana (Q1/Q2/sprint opcional/race).
 * - Calendario de temporada desde la fuente externa (adapter `CalendarSource`).
 */
export * from "./calendar-source";
export * from "./gp-service";
export * from "./gp-status";
export * from "./season-service";
