"use client";

import { useEffect, useState, type FormEvent } from "react";

import {
  BONUS_CODES_BY_EVENT,
  PENALTY_CODES_BY_EVENT,
  deriveStatus,
  resultEventLabel,
} from "@/modules/results/core";
import type {
  GpEventView,
  ImportEventFromSourceResult,
  ImportEventResult,
} from "@/modules/results";
import type { SeasonWithRules } from "@/modules/seasons";
import { Alert, Button, Field } from "@/shared/components";
import { PROVISIONAL_RESULTS_POLL } from "@/shared/config";
import type { ResultBonusCode, ResultPenaltyCode } from "@/shared/types";
import {
  importEventInputSchema,
  linkSourceInputSchema,
  setRiderMappingInputSchema,
} from "@/shared/validation/results";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface ResultsSectionProps {
  seasons: SeasonWithRules[];
}

/** Fila del formulario por piloto (los numéricos se guardan como texto). */
interface RiderRow {
  started: boolean;
  finished: boolean;
  position: string;
  penalties: ResultPenaltyCode[];
  bonuses: ResultBonusCode[];
  rawPoints: string;
}

function emptyRow(): RiderRow {
  return {
    started: false,
    finished: false,
    position: "",
    penalties: [],
    bonuses: [],
    rawPoints: "",
  };
}

const RESULTS_EVENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "pendientes",
  finished: "con resultados",
  neutralized: "neutralizado",
  cancelled: "cancelado",
};

/** Etiqueta de la opción de evento (tipo + estado de resultados). */
function eventOptionLabel(event: GpEventView): string {
  if (event.status === "cancelled") {
    return `${resultEventLabel(event.type)} — evento cancelado`;
  }
  const results =
    event.resultsStatus === null
      ? "sin resultados"
      : (RESULTS_EVENT_STATUS_LABELS[event.resultsStatus] ?? event.resultsStatus);
  return `${resultEventLabel(event.type)} — ${results}`;
}

/** Fecha y hora para la UI de admin (es-ES). */
function formatDateTime(value: Date): string {
  return value.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Sección de importación de resultados (US-16 manual + US-17 automático,
 * ADR-0018/0019): temporada → GP → evento (q2/sprint/race).
 *
 * Manual: una tabla con una fila por piloto del mercado. Los resultados
 * entran como `provisional`; las re-importaciones corrigen con histórico
 * (los resultados no se borran). Regla de inclusión del payload: se incluye
 * un piloto si la fila tiene cualquier dato O si tiene fila pre-cargada en
 * BD (el servidor trata lo inalterado como no-op y lo vaciado como
 * corrección a ABSENT).
 *
 * Automático (US-17): vínculo del GP con la fuente (PulseLive), importación
 * por evento, estado del auto-import (fallos del job) y mapeo de pilotos de
 * la fuente a pilotos del mercado.
 */
export default function ResultsSection({ seasons }: ResultsSectionProps) {
  const [seasonId, setSeasonId] = useState("");
  const [gpId, setGpId] = useState("");
  const [eventId, setEventId] = useState("");
  const [rows, setRows] = useState<Record<string, RiderRow>>({});
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<ImportEventResult | null>(null);
  // US-17 (ADR-0019): estado del bloque de la fuente.
  const [lastSourceImport, setLastSourceImport] = useState<ImportEventFromSourceResult | null>(
    null,
  );
  const [sourceLocalError, setSourceLocalError] = useState<string | null>(null);
  const [linkEventRef, setLinkEventRef] = useState("");
  const [mappingRiderRef, setMappingRiderRef] = useState("");
  const [mappingRiderId, setMappingRiderId] = useState("");

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const selectedGp = gps.data?.find((gp) => gp.id === gpId) ?? null;
  const sourceLinked = selectedGp?.sourceRef ?? null;
  const gpEvents = trpc.results.gpEvents.useQuery({ gpId }, { enabled: gpId !== "" });
  const hasEvent = gpId !== "" && eventId !== "";
  // US-17: los pilotos también los necesita el mapeo de pilotos (por GP,
  // no solo por evento).
  const riders = trpc.market.riders.list.useQuery(undefined, { enabled: gpId !== "" });
  const eventResults = trpc.results.eventResults.useQuery(
    { gpId, eventId },
    { enabled: hasEvent },
  );
  // US-17 (ADR-0019): estado del auto-import, catálogo de eventos de la
  // fuente (solo con sentido sin vínculo) y mapeos de pilotos.
  const sourceState = trpc.results.sourceState.useQuery({ gpId }, { enabled: gpId !== "" });
  const sourceEvents = trpc.results.sourceEvents.useQuery(
    { gpId },
    { enabled: gpId !== "" && sourceLinked === null },
  );
  const riderMappings = trpc.results.riderMappings.useQuery(undefined, {
    enabled: gpId !== "",
  });

  const importMutation = trpc.results.importEvent.useMutation({
    onSuccess: (data) => {
      setLastImport(data);
      setLocalError(null);
      void eventResults.refetch();
      void gpEvents.refetch();
    },
  });

  // US-17 (ADR-0019): mutations de la fuente.
  const importFromSourceMutation = trpc.results.importFromSource.useMutation({
    onSuccess: (data) => {
      setLastSourceImport(data);
      setSourceLocalError(null);
      void sourceState.refetch();
      void gpEvents.refetch();
      void eventResults.refetch();
    },
  });
  const linkMutation = trpc.results.linkSource.useMutation({
    onSuccess: () => {
      setLinkEventRef("");
      setSourceLocalError(null);
      void gps.refetch();
    },
  });
  const unlinkMutation = trpc.results.unlinkSource.useMutation({
    onSuccess: () => {
      setSourceLocalError(null);
      void gps.refetch();
    },
  });
  const setMappingMutation = trpc.results.setRiderMapping.useMutation({
    onSuccess: () => {
      setMappingRiderRef("");
      setMappingRiderId("");
      setSourceLocalError(null);
      void riderMappings.refetch();
    },
  });
  const deleteMappingMutation = trpc.results.deleteRiderMapping.useMutation({
    onSuccess: () => {
      void riderMappings.refetch();
    },
  });

  // Pre-carga: cuando llegan (o cambian) los datos, se reconstruye el
  // formulario con las filas actuales de BD. El structural sharing de
  // TanStack garantiza que el efecto solo se re-ejecuta si los datos
  // realmente cambian (carga inicial o tras una importación exitosa).
  useEffect(() => {
    if (!hasEvent || !eventResults.data || !riders.data) return;
    const next: Record<string, RiderRow> = {};
    for (const rider of riders.data) {
      const row = eventResults.data.find((r) => r.riderId === rider.id);
      next[rider.id] = row
        ? {
            started: row.started,
            finished: row.finished,
            position: row.position === null ? "" : String(row.position),
            penalties: [...row.penalties],
            bonuses: [...row.bonuses],
            rawPoints: row.rawPoints === null ? "" : String(row.rawPoints),
          }
        : emptyRow();
    }
    setRows(next);
    setReason("");
    setLocalError(null);
  }, [hasEvent, eventResults.data, riders.data]);

  // Los mensajes transitorios se reinician al cambiar de evento.
  useEffect(() => {
    setLastImport(null);
    setLocalError(null);
  }, [eventId]);

  // Los mensajes transitorios del bloque de la fuente se reinician al
  // cambiar de GP.
  useEffect(() => {
    setLastSourceImport(null);
    setSourceLocalError(null);
    setLinkEventRef("");
  }, [gpId]);

  const selectedEvent = gpEvents.data?.find((e) => e.id === eventId) ?? null;
  const penaltyCodes = selectedEvent ? PENALTY_CODES_BY_EVENT[selectedEvent.type] : [];
  const bonusCodes = selectedEvent ? BONUS_CODES_BY_EVENT[selectedEvent.type] : [];
  // US-17: eventos importables desde la fuente (q2/sprint/race no cancelados).
  const importableEvents =
    gpEvents.data?.filter(
      (event) =>
        (event.type === "q2" || event.type === "sprint" || event.type === "race") &&
        event.status !== "cancelled",
    ) ?? [];

  function setRow(riderId: string, patch: Partial<RiderRow>) {
    setRows((prev) => {
      const row = prev[riderId];
      if (!row) return prev;
      return { ...prev, [riderId]: { ...row, ...patch } };
    });
  }

  /** Desmarcar «Salió» limpia «Terminó» y la posición (ABSENT). */
  function toggleStarted(riderId: string, started: boolean) {
    setRows((prev) => {
      const row = prev[riderId];
      if (!row) return prev;
      return {
        ...prev,
        [riderId]: {
          ...row,
          started,
          finished: started ? row.finished : false,
          position: started ? row.position : "",
        },
      };
    });
  }

  /** Desmarcar «Terminó» limpia la posición (DNF). */
  function toggleFinished(riderId: string, finished: boolean) {
    setRows((prev) => {
      const row = prev[riderId];
      if (!row) return prev;
      return {
        ...prev,
        [riderId]: { ...row, finished, position: finished ? row.position : "" },
      };
    });
  }

  function togglePenalty(riderId: string, code: ResultPenaltyCode) {
    setRows((prev) => {
      const row = prev[riderId];
      if (!row) return prev;
      const next = row.penalties.includes(code)
        ? row.penalties.filter((c) => c !== code)
        : [...row.penalties, code];
      return { ...prev, [riderId]: { ...row, penalties: next } };
    });
  }

  function toggleBonus(riderId: string, code: ResultBonusCode) {
    setRows((prev) => {
      const row = prev[riderId];
      if (!row) return prev;
      const next = row.bonuses.includes(code)
        ? row.bonuses.filter((c) => c !== code)
        : [...row.bonuses, code];
      return { ...prev, [riderId]: { ...row, bonuses: next } };
    });
  }

  /**
   * Entradas a enviar (ADR-0018): un piloto se incluye si la fila tiene
   * cualquier dato o si tiene fila pre-cargada en BD (lo inalterado es un
   * no-op en el servidor; lo vaciado corrige la fila a ABSENT).
   */
  function buildEntries() {
    const entries: {
      riderId: string;
      position: number | null;
      started: boolean;
      finished: boolean;
      penalties: ResultPenaltyCode[];
      bonuses: ResultBonusCode[];
      rawPoints: number | null;
    }[] = [];
    for (const rider of riders.data ?? []) {
      const row = rows[rider.id];
      if (!row) continue;
      const position = row.position.trim() === "" ? null : Number(row.position);
      const rawPoints = row.rawPoints.trim() === "" ? null : Number(row.rawPoints);
      const hasData =
        row.started ||
        row.finished ||
        position !== null ||
        row.penalties.length > 0 ||
        row.bonuses.length > 0 ||
        rawPoints !== null;
      const preloaded = (eventResults.data ?? []).some((r) => r.riderId === rider.id);
      if (!hasData && !preloaded) continue;
      entries.push({
        riderId: rider.id,
        position,
        started: row.started,
        finished: row.finished,
        penalties: row.penalties,
        bonuses: row.bonuses,
        rawPoints,
      });
    }
    return entries;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gpId || !eventId) return;

    // Pre-check local de los campos numéricos (entrada basura).
    for (const rider of riders.data ?? []) {
      const row = rows[rider.id];
      if (!row) continue;
      if (row.position.trim() !== "" && !/^\d+$/.test(row.position.trim())) {
        setLocalError(`La posición de ${rider.name} debe ser un número entero.`);
        return;
      }
      if (row.rawPoints.trim() !== "" && !/^\d+(\.\d+)?$/.test(row.rawPoints.trim())) {
        setLocalError(`Los puntos crudos de ${rider.name} deben ser un número.`);
        return;
      }
    }

    const entries = buildEntries();
    if (entries.length === 0) return;

    // Validación local con el schema compartido (el servidor revalida).
    const parsed = importEventInputSchema.safeParse({
      gpId,
      eventId,
      entries,
      reason: reason.trim() === "" ? undefined : reason.trim(),
    });
    if (!parsed.success) {
      setLocalError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setLocalError(null);
    importMutation.mutate(parsed.data);
  }

  // US-17: vínculo del GP con la fuente (el catálogo ya resuelve el
  // eventRef; el match por nombre lo haría el servidor si no se pasara).
  function onLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (gpId === "") return;
    const parsed = linkSourceInputSchema.safeParse({ gpId, eventRef: linkEventRef });
    if (!parsed.success) {
      setSourceLocalError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setSourceLocalError(null);
    linkMutation.mutate(parsed.data);
  }

  // US-17: añade un mapeo piloto de fuente → piloto del mercado.
  function onAddMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = setRiderMappingInputSchema.safeParse({
      riderRef: mappingRiderRef.trim(),
      riderId: mappingRiderId,
    });
    if (!parsed.success) {
      setSourceLocalError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setSourceLocalError(null);
    setMappingMutation.mutate(parsed.data);
  }

  const loadError = eventResults.isError
    ? eventResults.error.message
    : riders.isError
      ? riders.error.message
      : null;

  const serverIssues = importMutation.isError ? zodIssues(importMutation.error) : [];
  // Los issues de Zod del servidor (p. ej. revalidación tras un cambio de
  // schema) no son mapeables a un campo individual: se muestran juntos.
  const serverError = importMutation.isError
    ? serverIssues.length > 0
      ? serverIssues.map((issue) => issue.message).join(" ")
      : importMutation.error.message
    : null;
  // US-17: primer error de las mutations de la fuente (reactivo, sin estado).
  const sourceErrorMutation = [
    importFromSourceMutation,
    linkMutation,
    unlinkMutation,
    setMappingMutation,
    deleteMappingMutation,
  ].find((mutation) => mutation.isError);
  let sourceError: string | null = null;
  if (sourceErrorMutation) {
    const sourceIssues = zodIssues(sourceErrorMutation.error);
    sourceError =
      sourceIssues.length > 0
        ? sourceIssues.map((issue) => issue.message).join(" ")
        : sourceErrorMutation.error.message;
  }
  const entries = hasEvent ? buildEntries() : [];

  return (
    <section>
      <div className="field">
        <label htmlFor="resultsSeasonId">Temporada</label>
        <select
          id="resultsSeasonId"
          value={seasonId}
          onChange={(event) => {
            setSeasonId(event.target.value);
            setGpId("");
            setEventId("");
          }}
        >
          <option value="">— Elige una temporada —</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name} ({season.year})
            </option>
          ))}
        </select>
      </div>

      {seasonId === "" && <p className="muted">Elige una temporada para ver sus GPs.</p>}

      {seasonId !== "" && (
        <>
          {gps.isPending ? (
            <p className="muted">Consultando…</p>
          ) : gps.isError ? (
            <p className="bad">No se pudieron cargar los GPs: {gps.error.message}</p>
          ) : gps.data.length === 0 ? (
            <p className="muted">Esta temporada aún no tiene GPs.</p>
          ) : (
            <div className="field">
              <label htmlFor="resultsGpId">GP</label>
              <select
                id="resultsGpId"
                value={gpId}
                onChange={(event) => {
                  setGpId(event.target.value);
                  setEventId("");
                }}
              >
                <option value="">— Elige un GP —</option>
                {gps.data.map((gp) => (
                  <option key={gp.id} value={gp.id}>
                    {`R${gp.round} · ${gp.name}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {gpId !== "" && (
        <>
          {/* US-17 (ADR-0019): importación automática desde la fuente. */}
          <div>
            <h3>Importación automática (PulseLive)</h3>

            {sourceLocalError ? <Alert variant="error">{sourceLocalError}</Alert> : null}
            {sourceError ? <Alert variant="error">{sourceError}</Alert> : null}

            {sourceLinked ? (
              <p>
                Vinculado a la fuente: <code>{sourceLinked}</code>{" "}
                <Button
                  onClick={() => unlinkMutation.mutate({ gpId })}
                  disabled={unlinkMutation.isPending}
                >
                  Desvincular
                </Button>
              </p>
            ) : (
              <form className="form" onSubmit={onLink} noValidate>
                {sourceEvents.isPending ? (
                  <p className="muted">Consultando el catálogo de la fuente…</p>
                ) : sourceEvents.isError ? (
                  <p className="bad">
                    No se pudieron cargar los eventos de la fuente: {sourceEvents.error.message}
                  </p>
                ) : (
                  <>
                    <div className="field">
                      <label htmlFor="resultsSourceEventRef">Evento de la fuente</label>
                      <select
                        id="resultsSourceEventRef"
                        value={linkEventRef}
                        onChange={(event) => setLinkEventRef(event.target.value)}
                      >
                        <option value="">— Elige un evento de la fuente —</option>
                        {sourceEvents.data.map((sourceEvent) => (
                          <option key={sourceEvent.eventRef} value={sourceEvent.eventRef}>
                            {sourceEvent.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button type="submit" disabled={linkMutation.isPending}>
                      Vincular GP
                    </Button>
                  </>
                )}
              </form>
            )}

            {sourceLinked && importableEvents.length > 0 && (
              <p>
                <span className="muted">Importar desde la fuente: </span>
                {importableEvents.map((event) => (
                  <Button
                    key={event.id}
                    onClick={() => importFromSourceMutation.mutate({ gpId, event: event.type })}
                    disabled={importFromSourceMutation.isPending}
                  >
                    Importar {resultEventLabel(event.type)}
                  </Button>
                ))}
              </p>
            )}

            {lastSourceImport ? (
              <Alert variant="success">
                Importación automática: {lastSourceImport.created} creados,{" "}
                {lastSourceImport.corrected} corregidos, {lastSourceImport.unchanged} sin
                cambios y {lastSourceImport.kept} conservados.
                {lastSourceImport.unmapped.length > 0
                  ? ` Sin mapear: ${lastSourceImport.unmapped
                      .map((unmapped) => unmapped.name ?? unmapped.riderRef)
                      .join(", ")}.`
                  : ""}
              </Alert>
            ) : null}

            <h4>Estado del auto-import</h4>
            {sourceState.isPending ? (
              <p className="muted">Consultando…</p>
            ) : sourceState.isError ? (
              <p className="bad">No se pudo cargar el estado: {sourceState.error.message}</p>
            ) : sourceState.data.length === 0 ? (
              <p className="muted">Aún no hay intentos registrados.</p>
            ) : (
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Fallos seguidos</th>
                    <th>Último error</th>
                    <th>Último intento</th>
                    <th>Último éxito</th>
                    <th>Sin mapear</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceState.data.map((state) => (
                    <tr
                      key={state.event}
                      className={
                        state.consecutiveFailures >= PROVISIONAL_RESULTS_POLL.failureAlertThreshold
                          ? "bad"
                          : undefined
                      }
                    >
                      <td>{resultEventLabel(state.event)}</td>
                      <td>{state.consecutiveFailures}</td>
                      <td>{state.lastError ?? "—"}</td>
                      <td>{state.lastAttemptAt ? formatDateTime(state.lastAttemptAt) : "—"}</td>
                      <td>{state.lastSuccessAt ? formatDateTime(state.lastSuccessAt) : "—"}</td>
                      <td>
                        {state.lastUnmapped && state.lastUnmapped.length > 0
                          ? state.lastUnmapped
                              .map((unmapped) => unmapped.name ?? unmapped.riderRef)
                              .join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4>Mapeo de pilotos</h4>
            {riderMappings.isPending ? (
              <p className="muted">Consultando…</p>
            ) : riderMappings.isError ? (
              <p className="bad">No se pudieron cargar los mapeos: {riderMappings.error.message}</p>
            ) : (
              <>
                {riderMappings.data.length === 0 ? (
                  <p className="muted">Aún no hay mapeos de pilotos.</p>
                ) : (
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Referencia en la fuente</th>
                        <th>Piloto del mercado</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {riderMappings.data.map((mapping) => (
                        <tr key={mapping.riderRef}>
                          <td>{mapping.riderRef}</td>
                          <td>{mapping.riderName}</td>
                          <td>
                            <Button
                              onClick={() =>
                                deleteMappingMutation.mutate({ riderRef: mapping.riderRef })
                              }
                              disabled={deleteMappingMutation.isPending}
                            >
                              Eliminar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <form className="form" onSubmit={onAddMapping} noValidate>
                  <Field
                    label="Referencia en la fuente"
                    name="mappingRiderRef"
                    value={mappingRiderRef}
                    onChange={(event) => setMappingRiderRef(event.target.value)}
                    placeholder="ID del piloto en la fuente"
                  />
                  <div className="field">
                    <label htmlFor="resultsMappingRiderId">Piloto del mercado</label>
                    <select
                      id="resultsMappingRiderId"
                      value={mappingRiderId}
                      onChange={(event) => setMappingRiderId(event.target.value)}
                    >
                      <option value="">— Elige un piloto —</option>
                      {(riders.data ?? []).map((rider) => (
                        <option key={rider.id} value={rider.id}>
                          {rider.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="submit"
                    disabled={setMappingMutation.isPending || riders.isPending}
                  >
                    Añadir mapeo
                  </Button>
                </form>
              </>
            )}
          </div>

          {gpEvents.isPending ? (
            <p className="muted">Consultando…</p>
          ) : gpEvents.isError ? (
            <p className="bad">
              No se pudieron cargar los eventos: {gpEvents.error.message}
            </p>
          ) : gpEvents.data.length === 0 ? (
            <p className="muted">Este GP aún no tiene eventos.</p>
          ) : (
            <div className="field">
              <label htmlFor="resultsEventId">Evento</label>
              <select
                id="resultsEventId"
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
              >
                <option value="">— Elige un evento —</option>
                {gpEvents.data.map((event) => (
                  <option key={event.id} value={event.id}>
                    {eventOptionLabel(event)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {hasEvent && (
        <>
          {riders.isPending || eventResults.isPending ? (
            <p className="muted">Consultando…</p>
          ) : riders.isError || eventResults.isError ? (
            <p className="bad">No se pudieron cargar los resultados: {loadError}</p>
          ) : riders.data.length === 0 ? (
            <p className="muted">Aún no hay pilotos en el mercado.</p>
          ) : (
            <form className="form" onSubmit={onSubmit} noValidate>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Piloto</th>
                    <th>Salió</th>
                    <th>Terminó</th>
                    <th>Posición</th>
                    <th>Penalizaciones</th>
                    <th>Bonos</th>
                    <th>Puntos crudos</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {riders.data.map((rider) => {
                    const row = rows[rider.id] ?? emptyRow();
                    return (
                      <tr key={rider.id}>
                        <td>
                          <strong>{rider.name}</strong>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Salió: ${rider.name}`}
                            checked={row.started}
                            onChange={(event) => toggleStarted(rider.id, event.target.checked)}
                          />
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Terminó: ${rider.name}`}
                            disabled={!row.started}
                            checked={row.finished}
                            onChange={(event) =>
                              toggleFinished(rider.id, event.target.checked)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Posición: ${rider.name}`}
                            disabled={!row.finished}
                            value={row.position}
                            onChange={(event) =>
                              setRow(rider.id, { position: event.target.value })
                            }
                          />
                        </td>
                        <td className="codes">
                          {penaltyCodes.map((code) => (
                            <label key={code}>
                              <input
                                type="checkbox"
                                aria-label={`Penalización ${code}: ${rider.name}`}
                                checked={row.penalties.includes(code)}
                                onChange={() => togglePenalty(rider.id, code)}
                              />{" "}
                              {code}
                            </label>
                          ))}
                        </td>
                        <td className="codes">
                          {bonusCodes.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            bonusCodes.map((code) => (
                              <label key={code}>
                                <input
                                  type="checkbox"
                                  aria-label={`Bono ${code}: ${rider.name}`}
                                  checked={row.bonuses.includes(code)}
                                  onChange={() => toggleBonus(rider.id, code)}
                                />{" "}
                                {code}
                              </label>
                            ))
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            aria-label={`Puntos crudos: ${rider.name}`}
                            value={row.rawPoints}
                            onChange={(event) =>
                              setRow(rider.id, { rawPoints: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <span className="muted">
                            {deriveStatus({ started: row.started, finished: row.finished })}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <Field
                label="Motivo (obligatorio si la importación corrige resultados existentes)"
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="p. ej. corrección de la parrilla oficial"
              />

              {localError ? <Alert variant="error">{localError}</Alert> : null}
              {serverError ? <Alert variant="error">{serverError}</Alert> : null}
              {lastImport ? (
                <Alert variant="success">
                  Importación completada: {lastImport.created} creados,{" "}
                  {lastImport.corrected} corregidos, {lastImport.unchanged} sin cambios y{" "}
                  {lastImport.kept} conservados.
                </Alert>
              ) : null}

              <Button type="submit" disabled={importMutation.isPending || entries.length === 0}>
                {importMutation.isPending ? "Importando…" : "Importar resultados"}
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
