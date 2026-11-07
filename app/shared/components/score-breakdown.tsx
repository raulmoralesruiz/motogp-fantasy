import type { MyScoreView, RiderScoreView } from "@/modules/results";

import { Alert } from "./alert";

/** Etiquetas en español de un código de bono/penalización (scoring-v1). */
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

/** Formatea un número de puntos (sin ceros sobrantes, coma decimal en es). */
export function fmt(value: number): string {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value);
}

/** Etiquetas en español de los eventos de un fin de semana (ADR-0031). */
const EVENT_LABELS: Record<string, string> = {
  q2: "Q2",
  sprint: "sprint",
  race: "carrera",
};

/** Lista legible de los eventos incluidos en la puntuación (ADR-0031). */
export function eventsLabel(events: Array<"q2" | "sprint" | "race">): string {
  return events.map((e) => EVENT_LABELS[e] ?? e).join(", ");
}

/** Lista legible de bonos/penalizaciones (código + puntos con signo). */
function codesLabel(codes: { code: string; points: number }[]): string {
  if (codes.length === 0) return "—";
  return codes
    .map((c) => `${codeLabel(c.code)} (${c.points > 0 ? "+" : ""}${fmt(c.points)})`)
    .join(", ");
}

/** Desglose de un piloto: peso, puntos ponderados y fin de semana. */
function RiderRow({ rider }: { rider: RiderScoreView }) {
  return (
    <li>
      <strong>{rider.riderName}</strong>{" "}
      <span className="muted">(peso ×{fmt(rider.weight)})</span> →{" "}
      <strong>{fmt(rider.points)} pts</strong>
      {/* .status: el desglose por piloto es una lista de datos del sistema (F3). */}
      <ul className="status">
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
 * Desglose de la puntuación de un lineup (US-20; lo reutiliza US-22):
 * oro/plata con pesos (×1/×0,5) y desglose por piloto (Q2/sprint/carrera/
 * bonos/penalizaciones), constructor y equipo. Los valores son los que
 * escribió el recálculo (US-18/US-19) con el módulo puro `scoring`.
 *
 * Puntuación provisional en vivo (ADR-0031): si `score.status` es
 * `provisional` (aún sin `Score`, GP no definitivo), lo indica con un
 * aviso y los eventos incluidos; los valores son los calculados al vuelo
 * con la misma fórmula del recálculo definitivo.
 */
export function ScoreBreakdown({ score }: { score: MyScoreView }) {
  return (
    <>
      {score.status === "provisional" && (
        <Alert variant="info">
          <strong>Puntuación provisional</strong>: calculada con los resultados importados
          hasta ahora ({eventsLabel(score.eventsIncluded)}). Se confirmará cuando el GP se
          marque definitivo.
        </Alert>
      )}
      <h3>Oro</h3>
      <ul className="status">
        {score.gold.map((rider) => (
          <RiderRow key={rider.riderId} rider={rider} />
        ))}
      </ul>

      <h3>Plata</h3>
      <ul className="status">
        {score.silver.map((rider) => (
          <RiderRow key={rider.riderId} rider={rider} />
        ))}
      </ul>

      <h3>Constructor y equipo</h3>
      <ul className="status">
        <li>
          Constructor: <strong>{score.manufacturer.name}</strong> →{" "}
          <strong>{fmt(score.manufacturer.points)} pts</strong>
        </li>
        <li>
          Equipo: <strong>{score.team.name}</strong> →{" "}
          <strong>{fmt(score.team.points)} pts</strong>
        </li>
      </ul>
    </>
  );
}
