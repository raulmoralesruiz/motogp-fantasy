"use client";

import { useState } from "react";

import type { CircuitView, SeasonWithRules } from "@/modules/seasons";
import { trpc } from "@/trpc/client";

import CreateGpForm from "./create-gp-form";
import GpActions from "./gp-actions";

interface GpsSectionProps {
  seasons: SeasonWithRules[];
  circuits: CircuitView[];
}

/**
 * Sección de GPs (US-05, flujo 18): selector de temporada, lista de GPs
 * con sus acciones (estado, lockout, añadir evento) y creación manual de
 * GPs (fallback de la import de calendario, ADR-0012).
 */
export default function GpsSection({ seasons, circuits }: GpsSectionProps) {
  const [seasonId, setSeasonId] = useState("");
  const gps = trpc.seasons.gps.list.useQuery(
    { seasonId },
    { enabled: seasonId !== "" },
  );

  return (
    <section>
      <div className="field">
        <label htmlFor="gpSeasonId">Temporada</label>
        <select
          id="gpSeasonId"
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

      {seasonId === "" && (
        <p className="muted">Elige una temporada para ver sus GPs.</p>
      )}

      {seasonId !== "" && (
        <>
          {gps.isPending ? (
            <p className="muted">Consultando…</p>
          ) : gps.isError ? (
            <p className="bad">
              No se pudieron cargar los GPs: {gps.error.message}
            </p>
          ) : gps.data.length === 0 ? (
            <p className="muted">Esta temporada aún no tiene GPs.</p>
          ) : (
            <ul className="status">
              {gps.data.map((gp) => (
                <li key={gp.id}>
                  <GpActions gp={gp} onChanged={() => void gps.refetch()} />
                </li>
              ))}
            </ul>
          )}

          <h3>Crear GP manual</h3>
          <CreateGpForm
            seasonId={seasonId}
            circuits={circuits}
            onCreated={() => void gps.refetch()}
          />
        </>
      )}
    </section>
  );
}
