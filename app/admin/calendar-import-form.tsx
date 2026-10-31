"use client";

import { useState, type FormEvent } from "react";

import type { NormalizedSeasonCalendar, SeasonWithRules } from "@/modules/seasons";
import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface CalendarImportFormProps {
  seasons: SeasonWithRules[];
  onImported: () => void;
}

/**
 * Import de calendario en 2 pasos (US-05, ADR-0012):
 *
 * 1. `calendar.fetch` — descarga y normaliza el año desde la fuente
 *    (PulseLive) SIN escribir en BD: el admin revisa el preview.
 * 2. `calendar.import` — el servidor revalida el preview (Zod) y crea los
 *    GPs en una transacción atómica, saltando las rondas ya existentes.
 */
export default function CalendarImportForm({
  seasons,
  onImported,
}: CalendarImportFormProps) {
  const utils = trpc.useUtils();
  const importCalendar = trpc.seasons.calendar.import.useMutation({
    onSuccess: onImported,
  });
  const [year, setYear] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [preview, setPreview] = useState<NormalizedSeasonCalendar | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function onFetch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = Number(year);
    if (!Number.isInteger(parsed)) return;
    setFetching(true);
    setFetchError(null);
    setPreview(null);
    try {
      // Fetch manual (no useQuery): el admin lo dispara con el botón y el
      // resultado se guarda en estado local (preview).
      const calendar = await utils.seasons.calendar.fetch.fetch({
        year: parsed,
      });
      setPreview(calendar);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setFetching(false);
    }
  }

  function onImport() {
    if (!preview || !seasonId) return;
    importCalendar.mutate({ seasonId, calendar: preview });
  }

  const issues = importCalendar.isError ? zodIssues(importCalendar.error) : [];
  const generalError =
    importCalendar.isError && issues.length === 0 ? importCalendar.error.message : null;

  return (
    <div className="form">
      <p className="muted">
        Importa el calendario de una temporada desde PulseLive (ADR-0012). El paso 1 solo
        lee (preview); el paso 2 crea los GPs y salta las rondas ya existentes.
      </p>

      <form onSubmit={onFetch} noValidate>
        <Field
          label="Año"
          name="year"
          type="number"
          placeholder="2026"
          required
          value={year}
          onChange={(event) => setYear(event.target.value)}
        />
        <Button type="submit" disabled={fetching || year === ""}>
          {fetching ? "Descargando…" : "1. Descargar calendario"}
        </Button>
      </form>

      {fetchError && <Alert variant="error">{fetchError}</Alert>}

      {preview && (
        <p className="muted">
          Calendario {preview.year} (fuente: {preview.source.name}{" "}
          {preview.source.version}): {preview.gps.length} GPs.
        </p>
      )}
      {preview && (
        <ul className="status">
          {preview.gps.map((gp) => (
            <li key={gp.round}>
              R{gp.round} · {gp.name} — {gp.circuit.name} ({gp.circuit.country})
              {gp.circuit.location ? `, ${gp.circuit.location}` : ""} ·{" "}
              {new Date(gp.date).toLocaleDateString("es-ES")} · eventos:{" "}
              {gp.events.map((event) => event.type).join(", ")}
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <div className="field">
          <label htmlFor="importSeasonId">Importar en la temporada</label>
          <select
            id="importSeasonId"
            value={seasonId}
            onChange={(event) => setSeasonId(event.target.value)}
          >
            <option value="">— Elige una temporada —</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name} ({season.year})
              </option>
            ))}
          </select>
        </div>
      )}
      {preview && (
        <Button
          type="button"
          onClick={onImport}
          disabled={importCalendar.isPending || seasonId === ""}
        >
          {importCalendar.isPending ? "Importando…" : "2. Importar GPs"}
        </Button>
      )}

      {generalError && <Alert variant="error">{generalError}</Alert>}
      {importCalendar.isSuccess && (
        <Alert variant="success">
          Importados {importCalendar.data.created} GPs;{" "}
          {importCalendar.data.updated} horas actualizadas;{" "}
          {importCalendar.data.skipped.length} saltados
          {importCalendar.data.skipped.length > 0
            ? ` (${importCalendar.data.skipped
                .map((item) => `R${item.round}`)
                .join(", ")})`
            : ""}
          .
        </Alert>
      )}
    </div>
  );
}
