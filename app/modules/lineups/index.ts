/**
 * Módulo `lineups` — lineups, cambios, validación y lockout.
 *
 * Fase 2 (E4, US-09…US-13, ADR-0017):
 * - `core/` — FÓRMULAS PURAS (sin I/O): composición 2+2+1+1, coste con
 *   precios congelados del GP, presupuesto derivado de movimientos,
 *   contabilidad de cambios y diferencia mínima. Auditado por el check de
 *   pureza (T-03).
 * - `LineupService` (US-09, prisma inyectable): `save` en una sola
 *   transacción (lock de fila del GP + gate de lockout + validación/coste
 *   puros + presupuesto + diff mínimo + exenciones + reemplazo de slots),
 *   `get` (lineup del usuario: coste/presupuesto/saldo/cambios) y
 *   `builder` (contexto de mercado por GP con precios congelados).
 *
 * Responsabilidad:
 * - Composición exacta: 2 oro + 2 plata + 1 constructor + 1 equipo
 *   (constraint de BD + validación server-side).
 * - Coste ≤ presupuesto recalculado en el servidor con precios congelados
 *   (el cliente nunca envía coste ni presupuesto de confianza).
 * - Transfers (2/GP + exención por lesión + 1 wildcard) con historial auditable.
 * - Lockout server-side: el gate `status=locked ∨ now ≥ lockoutAt` se
 *   evalúa dentro de la transacción de cambio (ni parcialmente, incluso
 *   bajo concurrencia).
 */
export * from "./core";
export * from "./lineup-service";
