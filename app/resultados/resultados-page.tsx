"use client";

import { useState } from "react";

import { Alert, ScoreBreakdown, fmt } from "@/shared/components";
import { trpc } from "@/trpc/client";

/** Descripción legible de un valor de resultado (posición + estado). */
function describeValues(v: {
  position: number | null;
  started: boolean;
  finished: boolean;
}): string {
  if (!v.started) return "no salió";
  const pos = v.position === null ? "s/p" : `pos. ${v.position}`;
  return v.finished ? `${pos}, terminó` : `${pos}, DNF`;
}

/**
 * Resultados y ranking (US-22): el usuario selecciona temporada + GP y ve:
 * - el estado del GP (definitivo, versión de resultados);
 * - su posición en cada liga + el delta vs el GP anterior de la temporada;
 * - el desglose de su puntuación (US-20);
 * - si hubo recálculo, el aviso + el histórico (anterior → nuevo) (US-19);
 * - GP cancelado → "GP cancelado, 0 puntos" (CA US-22).
 *
 * Todo lo calcula el servidor (`results.myResults` + `results.myScore`);
 * el cliente solo compone la vista.
 */
export default function ResultadosPage() {
  const seasons = trpc.seasons.list.useQuery();
  const [seasonId, setSeasonId] = useState("");
  const [gpId, setGpId] = useState("");

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const results = trpc.results.myResults.useQuery({ gpId }, { enabled: gpId !== "" });
  const score = trpc.results.myScore.useQuery({ gpId }, { enabled: gpId !== "" });

  if (seasons.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (seasons.isError) {
    return <Alert variant="error">No se pudo cargar la lista de temporadas.</Alert>;
  }

  // Guardia de datos obsoletas (mismo patrón que `/puntuacion`).
  const data =
    gpId !== "" && results.data && results.data.gp.id === gpId ? results.data : null;

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
      {gpId === "" && <p className="muted">Selecciona un GP para ver tus resultados.</p>}

      {gpId !== "" && results.isPending && <p className="muted">Consultando…</p>}
      {gpId !== "" && results.isError && (
        <Alert variant="error">{results.error.message}</Alert>
      )}

      {data && (
        <div>
          {data.cancelled ? (
            <Alert variant="warning">GP cancelado, 0 puntos.</Alert>
          ) : (
            <>
              <h2>Mis resultados — {data.gp.name}</h2>
              <p>
                {data.state.definitive ? (
                  <>
                    Resultados definitivos{" "}
                    <span className="muted">(versión {data.state.resultsVersion})</span>
                  </>
                ) : (
                  <span className="muted">
                    Aún no hay resultados definitivos en este GP.
                  </span>
                )}
              </p>

              <h3>Mis posiciones</h3>
              {data.leagues.length === 0 ? (
                <p className="muted">Aún no formas parte de ninguna liga.</p>
              ) : (
                <ul>
                  {data.leagues.map((league) => (
                    <li key={league.leagueId}>
                      <strong>{league.leagueName}</strong>
                      {league.gpPosition !== null ? (
                        <>
                          {" "}— posición {league.gpPosition} (
                          {fmt(league.gpPoints ?? 0)} pts)
                          {league.delta !== null && (
                            <span
                              className={
                                league.delta > 0 ? "ok" : league.delta < 0 ? "bad" : "muted"
                              }
                            >
                              {" "}
                              {league.delta > 0
                                ? `▲ +${league.delta}`
                                : league.delta < 0
                                  ? `▼ ${Math.abs(league.delta)}`
                                  : "= 0"}{" "}
                              vs GP anterior
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="muted"> — sin posición en este GP</span>
                      )}
                      {league.overallPosition !== null && (
                        <span className="muted">
                          {" "}· general: {league.overallPosition} (
                          {fmt(league.overallPoints ?? 0)} pts)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {data.recalculation.corrections > 0 && (
                <div>
                  <h3>Resultados actualizados</h3>
                  <Alert variant="info">
                    {data.recalculation.corrections}{" "}
                    {data.recalculation.corrections === 1
                      ? "corrección"
                      : "correcciones"}
                    {data.recalculation.lastAt
                      ? `, última el ${new Date(data.recalculation.lastAt).toLocaleDateString(
                          "es-ES",
                        )}`
                      : ""}
                    .
                  </Alert>
                  <ul>
                    {data.recalculation.history.map((entry, index) => (
                      <li key={`${entry.riderId}-${entry.at.toISOString()}-${index}`}>
                        <strong>{entry.riderName}</strong>
                        {` (${entry.eventLabel}): ${describeValues(entry.before)} → ${describeValues(entry.after)}`}
                        {entry.reason ? (
                          <span className="muted"> — {entry.reason}</span>
                        ) : null}
                        {entry.actor ? (
                          <span className="muted"> (por {entry.actor})</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <h3>Mi puntuación</h3>
              {score.isPending && <p className="muted">Consultando…</p>}
              {score.isError && <Alert variant="error">{score.error.message}</Alert>}
              {score.data && score.data.gpId === gpId && (
                <>
                  <p>
                    Total: <strong>{fmt(score.data.total)} puntos</strong>{" "}
                    <span className="muted">
                      (reglas {score.data.rulesVersion} · resultados{" "}
                      {score.data.resultsVersion})
                    </span>
                  </p>
                  <ScoreBreakdown score={score.data} />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
