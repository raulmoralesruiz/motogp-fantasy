/**
 * Health-check de la web (GET /api/health) — T-02 (WP4).
 * Lo usan el healthcheck de Docker y `deploy.sh`.
 * Es un "liveness" deliberadamente sin dependencias (no consulta la BD):
 * si responde, el servidor Next.js está arriba.
 */
export function GET() {
  return Response.json({ ok: true });
}
