/**
 * Módulo `admin` — panel de administración y auditoría.
 *
 * **Auditoría (T-09):** `audit_log` es append-only — el trigger de BD
 * `audit_log_append_only` rechaza UPDATE/DELETE (la garantía vive en
 * Postgres, no en la app). `appendAudit` es la única forma de escribir
 * una entrada, siempre dentro de la misma transacción que la acción
 * auditada.
 *
 * El panel de admin (temporadas, GPs, mercado, precios, resultados,
 * recálculos, sanciones) se implementa en E2 (US-04…US-08) y se completa
 * en las fases siguientes.
 */
export { appendAudit, type AuditEntry } from "./audit";
