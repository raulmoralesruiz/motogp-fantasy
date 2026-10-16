/**
 * Parseo y validación de las reglas de temporada en JSON (US-04, UI admin).
 *
 * Función pura (sin I/O, sin React): ejecuta en cliente la misma
 * validación que revalida el servidor (`seasonRulesSchema`) para la UX;
 * el servidor es la última palabra (AGENTS.md §8).
 */
import { seasonRulesSchema, type SeasonRules } from "@/shared/validation/season-rules";

export type RulesJsonParseResult =
  { ok: true; rules: SeasonRules } | { ok: false; error: string };

/** Parsea el texto JSON y lo valida contra `seasonRulesSchema`. */
export function parseRulesJson(text: string): RulesJsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "El texto no es un JSON válido." };
  }
  const result = seasonRulesSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: issues };
  }
  return { ok: true, rules: result.data };
}
