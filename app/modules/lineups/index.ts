/**
 * Módulo `lineups` — lineups, cambios, validación y lockout.
 *
 * Placeholder de Fase 0 (T-03): la estructura existe; el contenido se
 * implementa en Fase 2 (E4: US-09…US-13).
 *
 * Responsabilidad:
 * - Composición exacta: 2 oro + 2 plata + 1 constructor + 1 equipo
 *   (constraint de BD + validación server-side).
 * - Coste ≤ presupuesto recalculado en el servidor con precios congelados
 *   (el cliente nunca envía coste ni presupuesto de confianza).
 * - Transfers (2/GP + exención por lesión + 1 wildcard) con historial auditable.
 * - Lockout server-side: el estado `locked` del GP se evalúa dentro de la
 *   transacción de cambio (ni parcialmente, incluso bajo concurrencia).
 */
export {};
