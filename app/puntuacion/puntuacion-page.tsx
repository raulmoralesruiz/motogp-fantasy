"use client";

import { useState } from "react";

import { Alert, ScoreBreakdown, fmt } from "@/shared/components";
import { trpc } from "@/trpc/client";

/**
 * Mi puntuación con desglose (US-20): el usuario selecciona temporada y GP y
 * ve su puntuación con el desglose por piloto (Q2/sprint/GP/bonos/penal),
 * constructor y equipo, con pesos oro/plata. El total y el desglose son los
 * que escribió el recálculo (US-18/US-19) con el módulo puro `scoring`.
 */
export default function PuntuacionPage() {
  const seasons = trpc.seasons.list.useQuery();
  const [seasonId, setSeasonId] = useState("");
  const [gpId, setGpId] = useState("");

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const score = trpc.results.myScore.useQuery({ gpId }, { enabled: gpId !== "" });

  if (seasons.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (seasons.isError) {
    return <Alert variant="error">No se pudo cargar la lista de temporadas.</Alert>;
  }

  return (
    <div>
      <h2>Temporada y GP</h2>
      <div className="field">
        <label htmlFor="season">Temporada</label>
        <select
          id="season"
          value={seasonId}
          onChange={(e) => {
            setSeasonId(e.target.value);
            setGpId("");
          }}
        >
          <option value="">— Temporada —</option>
          {seasons.data.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {seasonId !== "" && (
        <div className="field">
          <label htmlFor="gp">GP</label>
          <select id="gp" value={gpId} onChange={(e) => setGpId(e.target.value)}>
            <option value="">— GP —</option>
            {gps.data?.map((g) => (
              <option key={g.id} value={g.id}>
                J{g.round} · {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {gpId === "" && <p className="muted">Selecciona un GP para ver tu puntuación.</p>}

      {gpId !== "" && score.isPending && <p className="muted">Consultando…</p>}
      {gpId !== "" && score.isError && (
        <Alert variant="error">{score.error.message}</Alert>
      )}

      {gpId !== "" && score.data && score.data.gpId === gpId && (
        <div>
          <h2>Mi puntuación — {score.data.gpName}</h2>
          <p>
            Total: <strong>{fmt(score.data.total)} puntos</strong>{" "}
            <span className="muted">
              (reglas {score.data.rulesVersion} · resultados{" "}
              {score.data.resultsVersion})
            </span>
          </p>

          <ScoreBreakdown score={score.data} />
        </div>
      )}
    </div>
  );
}
