/**
 * Módulo `seasons` — temporadas, GPs, circuitos y eventos.
 *
 * US-04 (hecho): temporadas con `season_rules` versionado
 * (`SeasonService`, prisma inyectable): creación atómica de Season +
 * versión inicial + auditoría (`season.created`); alta de nuevas versiones
 * de reglas (las versiones publicadas nunca se mutan — AGENTS.md §5;
 * unique `(season, version)`; auditoría `season.rules_version_added`).
 *
 * Pendiente: US-05 (GPs/circuitos/eventos), US-06 (mercado), …
 *
 * Responsabilidad:
 * - Temporadas con su versión de reglas (`season_rules` JSONB versionada).
 * - GPs (orden, circuito, estado `scheduled → locked → finished/cancelled`).
 * - Circuitos y eventos del fin de semana (Q1/Q2/sprint opcional/race).
 */
export * from "./season-service";
