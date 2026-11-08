"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { Alert, ScoreBreakdown, fmt } from "@/shared/components";
import { defaultGpId } from "@/shared/gp-default";
import { trpc } from "@/trpc/client";

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
 * Mi puntuación con desglose (US-20): el usuario selecciona temporada y GP y
 * ve su puntuación con el desglose por piloto (Q2/sprint/GP/bonos/penal),
 * constructor y equipo, con pesos oro/plata. El total y el desglose son los
 * que escribió el recálculo (US-18/US-19) con el módulo puro `scoring`.
 */
export default function PuntuacionPage() {
  const seasons = trpc.seasons.list.useQuery();
  const [seasonId, setSeasonId] = useState("");
  const [gpId, setGpId] = useState("");
  // Consistencia con /resultados: respetar la deselección explícita del
  // usuario (sin snap-back) — puede elegir "— Temporada —" / "— GP —".
  const [seasonCleared, setSeasonCleared] = useState(false);
  const [gpCleared, setGpCleared] = useState(false);

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const score = trpc.results.myScore.useQuery({ gpId }, { enabled: gpId !== "" });

  // Temporada por defecto: la más reciente (F3, patrón /mercado: la lista va
  // en orden ascendente y la temporada activa es la última). Se salta si el
  // usuario deseleccionó la temporada a propósito (`seasonCleared`) — sin
  // snap-back.
  useEffect(() => {
    if (seasonId !== "" || seasons.data === undefined || seasonCleared) return;
    const last = seasons.data[seasons.data.length - 1];
    if (last) setSeasonId(last.id);
  }, [seasons.data, seasonId, seasonCleared]);

  // GP por defecto (S2 P3 #2): la página es de LECTURA — abre en el último GP
  // con resultados (el que interesa al fan), no en el próximo programado.
  // Si la temporada no tiene GPs finalizados, cae al primer programado.
  // Se salta si el usuario deseleccionó el GP a propósito (`gpCleared`) o la
  // temporada (`seasonCleared`: sin temporada no hay GP) — sin snap-back.
  useEffect(() => {
    if (gpId !== "" || gps.data === undefined || gpCleared || seasonCleared)
      return;
    const target = defaultGpId(gps.data);
    if (target) setGpId(target);
  }, [gps.data, gpId, gpCleared, seasonCleared]);

  if (seasons.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (seasons.isError) {
    return <Alert variant="error">No se pudo cargar la lista de temporadas.</Alert>;
  }

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
              // Al cambiar de temporada se re-activa la auto-selección del GP;
              // la deselección de temporada se respeta.
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
      {gpId === "" && <p className="muted">Selecciona un GP para ver tu puntuación.</p>}

      {gpId !== "" && score.isPending && <p className="muted">Consultando…</p>}
      {gpId !== "" && score.isError && renderScoreError(score.error)}

      {gpId !== "" && score.data && score.data.gpId === gpId && (
        <div>
          <h2>Mi puntuación — {score.data.gpName}</h2>
          <p>
            Total: <strong>{fmt(score.data.total)} puntos</strong>{" "}
            {score.data.status === "provisional" ? (
              // Barrido P3 /resultados (afecta a ambas páginas, mismo patrón):
              // la línea se limita a la versión de reglas; la explicación de
              // "provisional" vive en el aviso de ScoreBreakdown (sin duplicar).
              <span className="muted">(reglas {score.data.rulesVersion})</span>
            ) : (
              <span className="muted">
                (definitivo · reglas {score.data.rulesVersion} · resultados{" "}
                {score.data.resultsVersion})
              </span>
            )}
          </p>

          {/* Capa de ayuda de vocabulario (F3, patrón /mercado): los
              términos de esta página se explican una sola vez, en su
              primera aparición — aquí, justo antes de la primera lista. */}
          <p className="muted">
            Oro: pilotos con peso ×1; plata: peso ×0,5. Q2/sprint/carrera:
            puntos por evento del fin de semana. Bonos/penalizaciones:
            ajustes (pole, ganador, DNF…). Provisional: calculada con los
            resultados importados hasta ahora; definitiva cuando el GP se
            confirma.
          </p>

          <ScoreBreakdown score={score.data} />
        </div>
      )}
    </div>
  );
}
