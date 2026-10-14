/**
 * Parámetros por temporada (B, carry, tablas de puntuación, límites) — T-18.
 *
 * Los valores PROVISIONAL (docs: `economy.md` §4, `scoring.md`,
 * `game-rules.md`) se calibran en las tareas `D-xx`. En producción viven en
 * `season_rules` (JSONB versionado); aquí viven como defaults tipados.
 */
export * from "./season-rules.js";
