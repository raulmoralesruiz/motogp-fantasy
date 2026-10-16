"use client";

import { useMemo, useState, type FormEvent } from "react";

import { PROVISIONAL_SEASON_RULES } from "@/shared/config/season-rules";
import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

import { parseRulesJson } from "./rules-json";
import { RulesJsonField } from "./rules-json-field";

interface CreateSeasonFormProps {
  onCreated: () => void;
}

/**
 * Formulario de creación de temporada (US-04, flujo 18): nombre, año,
 * fechas opcionales y reglas iniciales (pre-rellenadas con
 * `PROVISIONAL_SEASON_RULES`, validadas en vivo contra el schema
 * compartido; el servidor revalida — AGENTS.md §8).
 */
export default function CreateSeasonForm({ onCreated }: CreateSeasonFormProps) {
  const create = trpc.seasons.create.useMutation({ onSuccess: onCreated });
  const [rulesText, setRulesText] = useState(() =>
    JSON.stringify(PROVISIONAL_SEASON_RULES, null, 2),
  );

  const rulesResult = useMemo(() => parseRulesJson(rulesText), [rulesText]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rulesResult.ok) return; // el campo ya muestra el error local
    const data = new FormData(event.currentTarget);
    const startDate = data.get("startDate");
    const endDate = data.get("endDate");
    create.mutate({
      name: String(data.get("name") ?? ""),
      year: Number(data.get("year") ?? 0),
      // Las fechas vacías se omiten (undefined): `z.coerce.date()` no
      // acepta la cadena vacía.
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate: endDate ? new Date(String(endDate)) : undefined,
      rules: rulesResult.rules,
    });
  }

  const issues = create.isError ? zodIssues(create.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const rulesError = issues.find((issue) => issue.path?.[0] === "rules")?.message ?? null;
  const generalError =
    create.isError && issues.length === 0 ? create.error.message : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {generalError && <Alert variant="error">{generalError}</Alert>}
      {create.isSuccess && (
        <Alert variant="success">
          Temporada creada con su primera versión de reglas.
        </Alert>
      )}
      <Field
        label="Nombre"
        name="name"
        placeholder="Temporada 2026"
        required
        error={fieldError("name")}
      />
      <Field label="Año" name="year" type="number" required error={fieldError("year")} />
      <Field
        label="Fecha de inicio (opcional)"
        name="startDate"
        type="date"
        error={fieldError("startDate")}
      />
      <Field
        label="Fecha de fin (opcional)"
        name="endDate"
        type="date"
        error={fieldError("endDate")}
      />
      <RulesJsonField
        id="rules"
        label="Reglas (JSON versionado)"
        value={rulesText}
        onChange={setRulesText}
        error={rulesResult.ok ? rulesError : rulesResult.error}
      />
      <Button type="submit" disabled={create.isPending || !rulesResult.ok}>
        {create.isPending ? "Creando…" : "Crear temporada"}
      </Button>
    </form>
  );
}
