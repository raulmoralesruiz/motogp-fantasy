/**
 * Módulo `jobs` — workers de background (import, recompute, prices).
 *
 * US-08 (hecho): job de precios por GP (`applyPricesForGp`), con lock por GP
 * inyectado (`GpLockStore`); orquesta `PriceService.applyFormulaForGp`.
 *
 * Pendiente (fase de resultados, US-16…US-20): implementación de producción
 * del lock (Redis), cola/worker BullMQ y disparo automático tras cada GP
 * definitivo. Placeholder T-03: job de recálculo (T-10) e importación
 * automática (US-17).
 *
 * Responsabilidad:
 * - Workers sobre BullMQ/Redis: importación de resultados, recálculo con lock
 *   por GP, actualización de precios tras cada GP definitivo.
 * - Orquesta los módulos puros (`economy`, `scoring`) y de dominio
 *   (`market`); nunca al revés (dirección de dependencias: `jobs/` orquesta
 *   módulos).
 */
export * from "./prices";
