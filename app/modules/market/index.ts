/**
 * Módulo `market` — pilotos, constructores, equipos, afiliaciones y precios.
 *
 * US-06 (hecho): mercado de activos y afiliaciones por GP
 * (`MarketService`, prisma inyectable): creación idempotente por nombre de
 * pilotos, constructores y equipos (reutiliza sin auditar; solo la creación
 * nueva audita `rider.created` / `constructor.created` / `team.created`);
 * afiliación por GP con ajuste fino (`affiliation.set`, before/after) y
 * "desde el GP X en adelante" (ADR-0013: rellena solo GPs sin afiliación,
 * salta y reporta los existentes, nunca toca los anteriores; auditoría por
 * GP + resumen `affiliation.range_set`). El constructor de una afiliación
 * siempre se deriva del equipo en el servidor (invariante 5).
 *
 * US-07 (hecho): precios de apertura P0 + histórico (`PriceService`, prisma
 * inyectable): P0 = fila de `prices` con `gp_id = NULL` (ADR-0014, opción 2);
 * upsert auditado `price.opening_set` (crea con `beforeData = null`, no-op sin
 * auditar si es el mismo valor, actualiza con before/after; P2002 concurrente
 * → re-ejecuta el flujo), `listAssetPrices` y `getPriceHistory`.
 *
 * Pendiente: US-08 (fórmula de precios + ajuste manual).
 *
 * Responsabilidad:
 * - Activos del mercado: pilotos, constructores y equipos (activos distintos,
 *   nunca intercambiables).
 * - Afiliación **por GP** (unique `(rider, gp)`) — permite cambios de equipo.
 * - Precios de apertura (P0) y por GP con histórico completo
 *   (unique `(asset_type, asset_id, gp)`, motivo fórmula/manual, versión).
 * - Orquesta el motor de precios puro (`modules/economy/pricing`) con datos.
 */
export * from "./market-service";
export * from "./price-service";
