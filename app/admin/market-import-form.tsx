"use client";

import { useState, type FormEvent } from "react";

import type { SeasonWithRules } from "@/modules/seasons";
import type { NormalizedMarket } from "@/modules/market";
import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface MarketImportFormProps {
  seasons: SeasonWithRules[];
  onImported: () => void;
}

/**
 * Import de mercado en 2 pasos (US-06, ADR-0013):
 *
 * 1. `market.fetch` — descarga y normaliza el año desde PulseLive
 *    (equipos, riders, constructores) SIN escribir en BD: el admin
 *    revisa el preview.
 * 2. `market.import` — el servidor revalida el preview (Zod) y crea
 *    los constructores, equipos, pilotos y afiliaciones en una
 *    transacción atómica, saltando lo que ya existe.
 */
export default function MarketImportForm({
  seasons,
  onImported,
}: MarketImportFormProps) {
  const utils = trpc.useUtils();
  const importMarket = trpc.market.market.import.useMutation({
    onSuccess: onImported,
  });
  const [year, setYear] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [preview, setPreview] = useState<NormalizedMarket | null>(null);
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
      const market = await utils.market.market.fetch.fetch({
        year: parsed,
      });
      setPreview(market);
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setFetching(false);
    }
  }

  function onImport() {
    if (!preview || !seasonId) return;
    importMarket.mutate({ seasonId, market: preview });
  }

  const issues = importMarket.isError ? zodIssues(importMarket.error) : [];
  const generalError =
    importMarket.isError && issues.length === 0 ? importMarket.error.message : null;

  return (
    <div className="form">
      <p className="muted">
        Importa constructores, equipos y pilotos desde PulseLive (ADR-0013).
        El paso 1 solo lee (preview); el paso 2 crea los activos y salta
        los que ya existen.
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
          {fetching ? "Descargando…" : "1. Descargar mercado"}
        </Button>
      </form>

      {fetchError && <Alert variant="error">{fetchError}</Alert>}

      {preview && (
        <p className="muted">
          Mercado {preview.year} (fuente: {preview.source.name}{" "}
          {preview.source.version}): {preview.constructors.length} constructores,{" "}
          {preview.teams.length} equipos, {preview.riders.length} pilotos,{" "}
          {preview.affiliations.length} afiliaciones.
        </p>
      )}

      {preview && (
        <div>
          <h4>Constructores ({preview.constructors.length})</h4>
          <ul className="status">
            {preview.constructors.map((ctor) => (
              <li key={ctor.name}>
                <strong>{ctor.name}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div>
          <h4>Equipos ({preview.teams.length})</h4>
          <ul className="status">
            {preview.teams.map((team) => (
              <li key={team.name}>
                <strong>{team.name}</strong> — constructor: {team.manufacturer.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div>
          <h4>Pilotos ({preview.riders.length})</h4>
          <ul className="status">
            {preview.riders.map((rider) => (
              <li key={rider.sourceId ?? rider.name}>
                <strong>{rider.name} {rider.surname}</strong>
                {rider.number !== null ? ` (#${rider.number})` : ""}
                {rider.countryIso ? ` (${rider.countryIso})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <div>
          <h4>Afiliaciones ({preview.affiliations.length})</h4>
          <ul className="status">
            {preview.affiliations.map((aff) => (
              <li key={aff.riderSourceId}>
                rider: {aff.riderSourceId.slice(0, 8)}… → equipo: {aff.teamSourceId.slice(0, 8)}…
              </li>
            ))}
          </ul>
        </div>
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
          disabled={importMarket.isPending || seasonId === ""}
        >
          {importMarket.isPending ? "Importando…" : "2. Importar mercado"}
        </Button>
      )}

      {generalError && <Alert variant="error">{generalError}</Alert>}
      {importMarket.isSuccess && (
        <Alert variant="success">
          Importado: {importMarket.data.constructorsCreated} constructores creados,{" "}
          {importMarket.data.constructorsSkipped} saltados;{" "}
          {importMarket.data.teamsCreated} equipos creados,{" "}
          {importMarket.data.teamsSkipped} saltados;{" "}
          {importMarket.data.ridersCreated} pilotos creados,{" "}
          {importMarket.data.ridersSkipped} saltados;{" "}
          {importMarket.data.affiliationsCreated} afiliaciones creadas,{" "}
          {importMarket.data.affiliationsSkipped} saltadas.
          <br />
          <em>
            Las afiliaciones se crean automáticamente para todos los GPs de la
            temporada. A continuación puedes calcular el P0 automático desde el
            panel de precios.
          </em>
        </Alert>
      )}
    </div>
  );
}
