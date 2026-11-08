/**
 * Formato de números para la UI (es-ES): coma decimal, sin ceros sobrantes.
 *
 * Los precios y puntos se muestran siempre con la convención española
 * (17,4 / 170,5) — la UI y los mensajes de error están en español
 * (AGENTS.md §2). Única fuente de formato: los componentes y páginas
 * importan `formatNumber` en lugar de interpolar números crudos.
 */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 2,
  }).format(value);
}
