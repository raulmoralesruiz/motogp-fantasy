"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { Alert, ScoreBreakdown, fmt } from "@/shared/components";
import { trpc } from "@/trpc/client";

/** Descripción legible de un valor de resultado (posición + estado). */
function describeValues(v: {
  position: number | null;
  started: boolean;
  finished: boolean;
}): string {
  if (!v.started) return "no salió";
  const pos = v.position === null ? "sin posición" : `pos. ${v.position}`;
  return v.finished ? `${pos}, terminó` : `${pos}, DNF`;
}

/**
 * Estados legítimos de `myScore` (US-20/ADR-0031): el servidor los envía
 * como errores tRPC — `PRECONDITION_FAILED` (sin resultados importados) y
 * `NOT_FOUND` (sin lineup). La UI los pinta de neutro (info) con la salida
 * accionable, no de error (rojo): el rojo es solo para fallos reales (F3 P1).
 *
 * `NOT_FOUND` está sobrecargado server-side: también lo usa "El GP no
 * existe." (fallo real, no un estado legítimo). Como el código no distingue
 * ambos, se distingue por el mensaje: solo "…lineup…" es legítimo (F3 P2).
 */
function scoreErrorKind(error: unknown): "no-lineup" | "no-results" | "error" {
  const e = error as { data?: { code?: string }; message?: string } | null;
  const code = e?.data?.code;
  if (code === "PRECONDITION_FAILED") return "no-results";
  if (code === "NOT_FOUND" && /lineup/i.test(e?.message ?? "")) return "no-lineup";
  return "error";
}

/**
 * Render del error de `myScore`: neutro (info) para los estados legítimos
 * (con la salida accionable), rojo solo para un fallo real.
 */
function renderScoreError(error: unknown) {
  const message =
    (error as Error | null)?.message ?? "No se pudo cargar tu puntuación.";
  const kind = scoreErrorKind(error);
  if (kind === "no-lineup") {
    return (
      <Alert variant="info">
        {message}{" "}
        <Link href="/lineups">Monta tu lineup</Link> para puntuar en este GP.
      </Alert>
    );
  }
  if (kind === "no-results") {
    return <Alert variant="info">{message}</Alert>;
  }
  return <Alert variant="error">{message}</Alert>;
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
  // Barrido P3: respetar la deselección explícita del usuario (sin snap-back).
  // La auto-selección elige la última temporada / el GP próximo al cargar; si
  // el usuario elige "— Temporada —" / "— GP —" a propósito, se respeta.
  const [seasonCleared, setSeasonCleared] = useState(false);
  const [gpCleared, setGpCleared] = useState(false);

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const results = trpc.results.myResults.useQuery({ gpId }, { enabled: gpId !== "" });
  const score = trpc.results.myScore.useQuery({ gpId }, { enabled: gpId !== "" });

  // Temporada por defecto: la más reciente (F3, patrón /mercado: la lista va
  // en orden ascendente y la temporada activa es la última).
  // Barrido P3: se salta si el usuario deseleccionó la temporada a propósito
  // (`seasonCleared`) — sin snap-back.
  useEffect(() => {
    if (seasonId !== "" || seasons.data === undefined || seasonCleared) return;
    const last = seasons.data[seasons.data.length - 1];
    if (last) setSeasonId(last.id);
  }, [seasons.data, seasonId, seasonCleared]);

  // GP por defecto: el primer GP programado por ronda (F3, patrón /mercado):
  // la página abre donde el fan va a mirar, no en "— Temporada —".
  // Barrido P3: se salta si el usuario deseleccionó el GP a propósito
  // (`gpCleared`) o la temporada (`seasonCleared`: sin temporada no hay GP) —
  // sin snap-back.
  useEffect(() => {
    if (gpId !== "" || gps.data === undefined || gpCleared || seasonCleared)
      return;
    const next = [...gps.data]
      .sort((a, b) => a.round - b.round)
      .find((g) => g.status === "scheduled");
    if (next) setGpId(next.id);
  }, [gps.data, gpId, gpCleared, seasonCleared]);

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
      {/* .stack: los dos campos del mismo bloque comparten el gap del sistema (F3). */}
      <div className="stack">
        <div className="field">
          <label htmlFor="season">Temporada</label>
          <select
            id="season"
            value={seasonId}
            onChange={(e) => {
              setSeasonId(e.target.value);
              setGpId("");
              // Barrido P3: al cambiar de temporada se re-activa la
              // auto-selección del GP; la deselección de temporada se respeta.
              setGpCleared(false);
              setSeasonCleared(e.target.value === "");
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
            <select
              id="gp"
              value={gpId}
              onChange={(e) => {
                setGpId(e.target.value);
                // Barrido P3: la deselección explícita del GP se respeta.
                setGpCleared(e.target.value === "");
              }}
            >
              <option value="">— GP —</option>
              {gps.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  J{g.round} · {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {/* Barrido P3: la pista es coherente con el selector visible — si no
          hay temporada seleccionada, se pide la temporada (el selector de GP
          no está renderizado); si hay temporada, se pide el GP. Sin
          temporadas no hay pista engañosa. */}
      {gpId === "" && seasonId === "" && seasons.data.length > 0 && (
        <p className="muted">Selecciona una temporada para ver tus resultados.</p>
      )}
      {gpId === "" && seasonId !== "" && (
        <p className="muted">Selecciona un GP para ver tus resultados.</p>
      )}

      {gpId !== "" && results.isPending && <p className="muted">Consultando…</p>}
      {gpId !== "" && results.isError && (
        <Alert variant="error">{results.error.message}</Alert>
      )}

      {data && (
        <div>
          {data.cancelled ? (
            // GP cancelado (CA US-22): evento excepcional, no fallo → ÁMBAR
            // (aviso). Difiere de los estados legítimos rutinarios (sin
            // lineup / sin resultados / sin ligas), que son neutros (info).
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

              {/* Capa de ayuda de vocabulario (F3, patrón /mercado): los
                  términos de esta página se explican una sola vez, en su
                  primera aparición — aquí, justo antes de la primera lista. */}
              <p className="muted">
                Delta (▲/▼): cambio de posición respecto al GP anterior de la
                temporada. General: posición acumulada en la liga. Provisional:
                puntuación calculada con los resultados importados hasta ahora;
                definitiva cuando el GP se confirma. Corrección: ajuste de un
                resultado (anterior → nuevo) con motivo.
              </p>

              <h3>Mis posiciones</h3>
              {data.leagues.length === 0 ? (
                <p className="muted">
                  Aún no formas parte de ninguna liga.{" "}
                  <Link href="/ligas">Explora las ligas</Link> para unirte.
                </p>
              ) : (
                <ul className="status">
                  {data.leagues.map((league) => (
                    <li key={league.leagueId}>
                      <strong>{league.leagueName}</strong>
                      {league.gpPosition !== null ? (
                        <>
                          {" "}— posición {league.gpPosition} (
                          {fmt(league.gpPoints ?? 0)} pts)
                          {league.delta !== null && (
                            <span
                              // Delta es dato, no fallo: sube = positivo (ok),
                              // baja/empate = neutro (muted). El rojo (bad) se
                              // reserva para fallos reales (F3 P2).
                              className={league.delta > 0 ? "ok" : "muted"}
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
                  {/* Barrido P3: la capa de ayuda define "Corrección"; el
                      titular usa el mismo término (antes "Resultados
                      actualizados", que no coincidía con el vocabulario). */}
                  <h3>Correcciones</h3>
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
                  <ul className="status">
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

              {/* h2 (F3 P2): bloque de primer nivel, hermano de "Mis
                  resultados — {GP}"; así las secciones h3 de ScoreBreakdown
                  (Oro/Plata/Constructor) son sus hijos, como en /puntuacion. */}
              <h2>Mi puntuación</h2>
              {score.isPending && <p className="muted">Consultando…</p>}
              {score.isError && renderScoreError(score.error)}
              {score.data && score.data.gpId === gpId && (
                <>
                  <p>
                    Total: <strong>{fmt(score.data.total)} puntos</strong>{" "}
                    {score.data.status === "provisional" ? (
                      // Barrido P3: la línea se limita a la versión de reglas;
                      // la explicación de "provisional" vive en el aviso de
                      // ScoreBreakdown (sin duplicar la señal).
                      <span className="muted">
                        (reglas {score.data.rulesVersion})
                      </span>
                    ) : (
                      <span className="muted">
                        (definitivo · reglas {score.data.rulesVersion} · resultados{" "}
                        {score.data.resultsVersion})
                      </span>
                    )}
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
