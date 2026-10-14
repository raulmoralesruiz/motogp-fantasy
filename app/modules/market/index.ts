/**
 * Módulo `market` — pilotos, constructores, equipos, afiliaciones y precios.
 *
 * Placeholder de Fase 0 (T-03): la estructura existe; el contenido se
 * implementa en Fase 1 (E3: US-06 montar mercado, US-07 precios de apertura,
 * US-08 precios por fórmula + ajuste manual).
 *
 * Responsabilidad:
 * - Activos del mercado: pilotos, constructores y equipos (activos distintos,
 *   nunca intercambiables).
 * - Afiliación **por GP** (unique `(rider, gp)`) — permite cambios de equipo.
 * - Precios de apertura (P0) y por GP con histórico completo
 *   (unique `(asset_type, asset_id, gp)`, motivo fórmula/manual, versión).
 * - Orquesta el motor de precios puro (`modules/economy/pricing`) con datos.
 */
export {};
