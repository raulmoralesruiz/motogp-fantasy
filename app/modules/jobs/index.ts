/**
 * Módulo `jobs` — workers de background (import, recompute, prices).
 *
 * Placeholder de Fase 0 (T-03): la estructura existe; el contenido se
 * implementa en Fase 3 (T-10 job de recálculo, US-17 importación automática,
 * US-08 actualización de precios).
 *
 * Responsabilidad:
 * - Workers sobre BullMQ/Redis: importación de resultados, recálculo con lock
 *   por GP, actualización de precios tras cada GP definitivo.
 * - Orquesta los módulos puros (`economy`, `scoring`); nunca al revés
 *   (dirección de dependencias: `jobs/` orquesta módulos).
 */
export {};
