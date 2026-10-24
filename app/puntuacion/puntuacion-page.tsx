"use client";

import { useState } from "react";

import { Alert } from "@/shared/components";
import { trpc } from "@/trpc/client";

/** Etiqueta en español de un código de bono/penalización (scoring-v1). */
const CODE_LABELS: Record<string, string> = {
  pole: "Pole",
  "fastest-lap": "Vuelta rápida",
  winner: "Ganador",
  "positions-gained": "Posiciones ganadas",
  extraordinary: "Extraordinario",
  dnf: "DNF",
  dq: "DQ",
  "time-penalty": "Penalización de tiempo",
};

function codeLabel(code: string): string {
  return CODE_LABELS[code] ?? code;
}

/** Formatea un número de puntos (sin ceros sobrantes, coma decimal es). */
function fmt(value: number): string {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

/** Lista legible de bonos/penalizaciones (código + puntos con signo). */
function codesLabel(codes: { code: string; points: number }[]): string {
  if (codes.length === 0) return "—";
  return codes
    .map((c) => `${codeLabel(c.code)} (${c.points > 0 ? "+" : ""}${fmt(c.points)})`)
    .join(", ");
}

/** Desglose de un piloto: peso, puntos ponderados y fin de semana. */
function RiderRow({
  rider,
}: {
  rider: {
    riderId: string;
    riderName: string;
    weight: number;
    points: number;
    breakdown: {
      q2: number;
      sprint: number;
      mainRace: number;
      bonuses: { code: string; points: number }[];
      penalties: { code: string; points: number }[];
      total: number;
    };
  };
}) {
  return (
    <li>
      <strong>{rider.riderName}</strong>{" "}
      <span className="muted">(peso ×{fmt(rider.weight)})</span> →{" "}
      <strong>{fmt(rider.points)} pts</strong>
      <ul>
        <li>Q2: {fmt(rider.breakdown.q2)}</li>
        <li>Sprint: {fmt(rider.breakdown.sprint)}</li>
        <li>Carrera: {fmt(rider.breakdown.mainRace)}</li>
        <li>Bonos: {codesLabel(rider.breakdown.bonuses)}</li>
        <li>Penalizaciones: {codesLabel(rider.breakdown.penalties)}</li>
        <li>Total piloto: {fmt(rider.breakdown.total)}</li>
      </ul>
    </li>
  );
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

          <h3>Oro</h3>
          <ul>
            {score.data.gold.map((rider) => (
              <RiderRow key={rider.riderId} rider={rider} />
            ))}
          </ul>

          <h3>Plata</h3>
          <ul>
            {score.data.silver.map((rider) => (
              <RiderRow key={rider.riderId} rider={rider} />
            ))}
          </ul>

          <h3>Constructor y equipo</h3>
          <ul>
            <li>
              Constructor: <strong>{score.data.constructor.name}</strong> →{" "}
              <strong>{fmt(score.data.constructor.points)} pts</strong>
            </li>
            <li>
              Equipo: <strong>{score.data.team.name}</strong> →{" "}
              <strong>{fmt(score.data.team.points)} pts</strong>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
