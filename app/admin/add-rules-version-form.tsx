"use client";

import { useMemo, useState, type FormEvent } from "react";

import { PROVISIONAL_SEASON_RULES } from "@/shared/config/season-rules";
import { Alert, Button } from "@/shared/components";
import type { SeasonWithRules } from "@/modules/seasons";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

import { parseRulesJson } from "./rules-json";
import { RulesJsonField } from "./rules-json-field";

interface AddRulesVersionFormProps {
  seasons: SeasonWithRules[];
  onCreated: () => void;
}

/**
 * Formulario para añadir una versión de reglas a una temporada existente
 * (US-04, flujo 18). Pre-rellena con la última versión de la temporada
 * seleccionada (o `PROVISIONAL_SEASON_RULES`); las versiones publicadas
 * nunca se mutan (AGENTS.md §5).
 */
export default function AddRulesVersionForm({
  seasons,
  onCreated,
}: AddRulesVersionFormProps) {
  const addVersion = trpc.seasons.addRulesVersion.useMutation({ onSuccess: onCreated });
  const [seasonId, setSeasonId] = useState("");
  const [rulesText, setRulesText] = useState(() =>
    JSON.stringify(PROVISIONAL_SEASON_RULES, null, 2),
  );

  /** Última versión de la temporada, o PROVISIONAL si no tiene ninguna. */
  function prefillFor(id: string): string {
    const season = seasons.find((s) => s.id === id);
    const latest = season?.rules[season.rules.length - 1];
    return JSON.stringify(latest?.rules ?? PROVISIONAL_SEASON_RULES, null, 2);
  }

  function selectSeason(id: string) {
    setSeasonId(id);
    setRulesText(id ? prefillFor(id) : JSON.stringify(PROVISIONAL_SEASON_RULES, null, 2));
  }

  const rulesResult = useMemo(() => parseRulesJson(rulesText), [rulesText]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!seasonId) return;
    if (!rulesResult.ok) return; // el campo ya muestra el error local
    addVersion.mutate({ seasonId, rules: rulesResult.rules });
  }

  const issues = addVersion.isError ? zodIssues(addVersion.error) : [];
  const rulesError = issues.find((issue) => issue.path?.[0] === "rules")?.message ?? null;
  const generalError =
    addVersion.isError && issues.length === 0 ? addVersion.error.message : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {generalError && <Alert variant="error">{generalError}</Alert>}
      {addVersion.isSuccess && (
        <Alert variant="success">
          Nueva versión de reglas añadida (las versiones anteriores no se modifican).
        </Alert>
      )}
      <div className="field">
        <label htmlFor="seasonId">Temporada</label>
        <select
          id="seasonId"
          name="seasonId"
          value={seasonId}
          onChange={(event) => selectSeason(event.target.value)}
        >
          <option value="">— Elige una temporada —</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name} ({season.year})
            </option>
          ))}
        </select>
      </div>
      <RulesJsonField
        id="rulesVersion"
        label="Nueva versión de reglas (JSON)"
        value={rulesText}
        onChange={setRulesText}
        error={rulesResult.ok ? rulesError : rulesResult.error}
      />
      <Button
        type="submit"
        disabled={addVersion.isPending || !seasonId || !rulesResult.ok}
      >
        {addVersion.isPending ? "Añadiendo…" : "Añadir versión"}
      </Button>
    </form>
  );
}
