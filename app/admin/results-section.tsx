"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useSearchParams } from "next/navigation";

import {
  BONUS_CODES_BY_EVENT,
  PENALTY_CODES_BY_EVENT,
  RESULT_CODE_LABELS,
  RESULT_STATUS_LABELS,
  deriveStatus,
  resultEventLabel,
} from "@/modules/results/core";
import type {
  EventFlagResult,
  GpEventView,
  ImportEventFromSourceResult,
  ImportEventResult,
  MarkDefinitiveResult,
} from "@/modules/results";
import type { SeasonWithRules } from "@/modules/seasons";
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  RowAction,
  type ConfirmRequest,
} from "@/shared/components";
import { PROVISIONAL_RESULTS_POLL } from "@/shared/config";
import type { ResultBonusCode, ResultPenaltyCode } from "@/shared/types";
import {
  eventFlagInputSchema,
  importEventInputSchema,
  linkSourceInputSchema,
  markDefinitiveInputSchema,
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

/**
 * Etiqueta de la opción de evento (tipo + estado real): los flags
 * `cancelled`/`neutralized` de `results_events` son la fuente de verdad
 * (ADR-0020); el enum de estado de `results_events` nunca refleja esos
 * valores, así que la UI los ignora.
 */
function eventOptionLabel(event: GpEventView): string {
  const base = resultEventLabel(event.type);
  if (event.cancelled) {
    return `${base} — cancelado (no puntúa)`;
  }
  if (event.neutralized) {
    return `${base} — neutralizado`;
  }
  if (event.status === "cancelled") {
    return `${base} — evento cancelado`;
  }
  return `${base} — ${event.resultCount > 0 ? "con resultados" : "sin resultados"}`;
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
  const [lastSourceImport, setLastSourceImport] =
    useState<ImportEventFromSourceResult | null>(null);
  const [sourceLocalError, setSourceLocalError] = useState<string | null>(null);
  const [linkEventRef, setLinkEventRef] = useState("");
  const [mappingRiderRef, setMappingRiderRef] = useState("");
  const [mappingRiderId, setMappingRiderId] = useState("");
  // US-18 (ADR-0020): definitivo + estados de evento.
  const [lastDefinitive, setLastDefinitive] = useState<MarkDefinitiveResult | null>(null);
  const [definitiveLocalError, setDefinitiveLocalError] = useState<string | null>(null);
  const [eventFlagMessage, setEventFlagMessage] = useState<string | null>(null);
  const [eventLocalError, setEventLocalError] = useState<string | null>(null);
  // Confirmación con impacto (patrón del sistema) para las acciones que
  // puntuarán lineups o cambiarán el estado de un evento.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  // Paso 2 (importación manual): abierto por defecto; se colapsa cuando el GP
  // ya está vinculado a la fuente (el auto-import es entonces la vía habitual).
  const [manualOpen, setManualOpen] = useState(true);
  // Protección de trabajo (harden): hay cambios sin importar en la tabla y el
  // cambio de contexto (temporada/GP/evento) pendiente de confirmar.
  const [dirty, setDirty] = useState(false);
  const [pendingChange, setPendingChange] = useState<ConfirmRequest | null>(null);
  // Si el cambio pendiente vino de la URL (consola «Fin de semana», enlace
  // compartido), al cancelar la confirmación se revierte la URL al contexto
  // de la cascada: si no, el operador queda con URL y cascada desincronizadas
  // y el re-click en la CTA no haría nada (el router no «navega» a la misma
  // URL). Los cambios manuales (selectores) nunca tocan la URL: no revierten.
  const pendingFromUrl = useRef(false);
  // Revisión/diff del paso 2: la copia de las filas tal como llegaron (BD /
  // auto-import) para marcar qué ha corregido el operador antes de importar.
  const [baseline, setBaseline] = useState<Record<string, RiderRow>>({});

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const selectedGp = gps.data?.find((gp) => gp.id === gpId) ?? null;
  const sourceLinked = selectedGp?.sourceRef ?? null;
  /** Etiqueta del GP para títulos e impactos de confirmación. */
  const gpLabel = selectedGp
    ? `R${selectedGp.round} · ${selectedGp.name}`
    : "el GP elegido";
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
  const sourceState = trpc.results.sourceState.useQuery(
    { gpId },
    { enabled: gpId !== "" },
  );
  const sourceEvents = trpc.results.sourceEvents.useQuery(
    { gpId },
    { enabled: gpId !== "" && sourceLinked === null },
  );
  const riderMappings = trpc.results.riderMappings.useQuery(undefined, {
    enabled: gpId !== "",
  });
  // US-18 (ADR-0020): estado de definitivo del GP (derivado de las filas).
  const gpState = trpc.results.gpState.useQuery({ gpId }, { enabled: gpId !== "" });

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

  // US-18 (ADR-0020): definitivo + estados de evento.
  const markDefinitiveMutation = trpc.results.markDefinitive.useMutation({
    onSuccess: (data) => {
      setLastDefinitive(data);
      setDefinitiveLocalError(null);
      void gpState.refetch();
      void gpEvents.refetch();
      void eventResults.refetch();
    },
  });
  const cancelEventMutation = trpc.results.cancelEvent.useMutation({
    onSuccess: (data: EventFlagResult) => {
      setEventFlagMessage(
        data.noop
          ? "El evento ya estaba cancelado (sin cambios)."
          : "Evento cancelado: no puntuará (0 para todos).",
      );
      setEventLocalError(null);
      void gpState.refetch();
      void gpEvents.refetch();
      void eventResults.refetch();
    },
  });
  const neutralizeEventMutation = trpc.results.neutralizeEvent.useMutation({
    onSuccess: (data: EventFlagResult) => {
      setEventFlagMessage(
        data.noop
          ? "El evento ya estaba neutralizado (sin cambios)."
          : "Evento neutralizado: se puntuará con el resultado oficial declarado.",
      );
      setEventLocalError(null);
      void gpState.refetch();
      void gpEvents.refetch();
      void eventResults.refetch();
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
    setBaseline(next);
    setReason("");
    setLocalError(null);
    setDirty(false);
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

  // US-18 (ADR-0020): mensajes transitorios del definitivo/estados de
  // evento se reinician al cambiar de GP.
  useEffect(() => {
    setLastDefinitive(null);
    setDefinitiveLocalError(null);
    setEventFlagMessage(null);
    setEventLocalError(null);
  }, [gpId]);

  // Al vincular/desvincular la fuente se ajusta el paso manual: colapsado con
  // fuente (vía habitual = auto-import), abierto sin ella. El toggle manual
  // del operador no se toca salvo que el vínculo cambie.
  useEffect(() => {
    setManualOpen(sourceLinked === null);
  }, [sourceLinked]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (seasonId) params.set("season", seasonId);
    else params.delete("season");
    if (gpId) params.set("gp", gpId);
    else params.delete("gp");
    if (eventId) params.set("event", eventId);
    else params.delete("event");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [seasonId, gpId, eventId]);

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

  const searchParams = useSearchParams();
  // El query string del router que se aplicó por última vez a la cascada:
  // distingue «el contexto llegó por URL» (consola «Fin de semana», enlace
  // compartido, F5) de «el operador movió los selectores» (que no se
  // sobreescribe nunca).
  const lastSyncedSearch = useRef("");

  // La selección vive también en la URL: F5 o un enlace compartido recuperan
  // el contexto del ritual en lugar de vaciar la cascada (harden). La
  // consola «Fin de semana» del panel navega a la misma ruta con
  // ?season=&gp= (adapt): cuando el query string del router cambia de
  // verdad, se aplica el contexto con la semántica de la cascada (un GP
  // nuevo vacía el evento) — y con la misma protección de trabajo que un
  // cambio manual si hay cambios sin importar (harden).
  useEffect(() => {
    const search = searchParams.toString();
    if (search === lastSyncedSearch.current) return;
    lastSyncedSearch.current = search;

    const season = searchParams.get("season");
    const gp = searchParams.get("gp");
    const event = searchParams.get("event");
    if (season === null && gp === null && event === null) return;
    // Solo actúa si algún nivel de la cascada cambia de verdad (si no, un
    // click en la consola con la cascada ya en ese contexto no pediría
    // descartar el trabajo pendiente).
    const seasonChanges = season !== null && season !== seasonId;
    const gpChanges = gp !== null && gp !== gpId;
    const eventChanges =
      gp !== null ? (event ?? "") !== eventId : event !== null && event !== eventId;
    if (!seasonChanges && !gpChanges && !eventChanges) return;

    const apply = () => {
      if (season !== null && season !== seasonId) {
        // Cambiar temporada resetea la cascada (misma semántica que el
        // selector); un GP/evento presentes en la URL reanclan la cascada.
        setSeasonId(season);
        setGpId(gp ?? "");
        setEventId(gp !== null ? (event ?? "") : "");
      } else if (gp !== null) {
        setGpId(gp);
        setEventId(event ?? "");
      } else if (event !== null) {
        setEventId(event);
      }
      setDirty(false);
    };
    if (dirty) {
      pendingFromUrl.current = true;
      setPendingChange({
        title: "Tienes resultados sin importar",
        impact:
          `Se perderán los cambios de la tabla${
            selectedEvent ? ` de ${resultEventLabel(selectedEvent.type)}` : ""
          } que no hayas importado. ` +
          "Si quieres conservarlos, cancela y pulsa «Importar resultados».",
        irreversible: true,
        confirmLabel: "Sí, descartar los cambios",
        onConfirm: apply,
      });
      return;
    }
    apply();
  }, [searchParams, seasonId, gpId, eventId, dirty, selectedEvent]);

  function setRow(riderId: string, patch: Partial<RiderRow>) {
    setDirty(true);
    setRows((prev) => {
      const row = prev[riderId];
      if (!row) return prev;
      return { ...prev, [riderId]: { ...row, ...patch } };
    });
  }

  /** Desmarcar «Salió» limpia «Terminó» y la posición (ABSENT). */
  function toggleStarted(riderId: string, started: boolean) {
    setDirty(true);
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
    setDirty(true);
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
    setDirty(true);
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
    setDirty(true);
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

  /**
   * Marcar el GP como definitivo (US-18, ADR-0020): confirmación con impacto
   * (las filas afectadas); el servidor voltea las filas y ejecuta el primer
   * recálculo (rv-1) en la misma transacción.
   */
  function onMarkDefinitive() {
    const state = gpState.data;
    if (!gpId || !state) return;
    setConfirmRequest({
      title: `Marcar ${gpLabel} como definitivo`,
      impact:
        `Se puntuarán los lineups de ${gpLabel} (${
          state.resultsVersion
            ? `recálculo tras ${state.resultsVersion}`
            : "primer recálculo, rv-1"
        }). ` +
        `Afecta a ${state.counts.provisional} fila(s) provisional(es) y ` +
        `${state.counts.corrected} corregida(s).`,
      confirmLabel: "Sí, marcar definitivo",
      onConfirm: () => {
        const parsed = markDefinitiveInputSchema.safeParse({ gpId });
        if (!parsed.success) {
          setDefinitiveLocalError(
            parsed.error.issues.map((issue) => issue.message).join(" "),
          );
          return;
        }
        setDefinitiveLocalError(null);
        markDefinitiveMutation.mutate(parsed.data);
      },
    });
  }

  /**
   * Estado de evento (US-18, ADR-0020): cancelar (no puntúa; irreversible)
   * o neutralizar (metadatos: se puntúa con el resultado oficial), con
   * confirmación cuantificada con las filas afectadas del evento.
   */
  function onEventFlag(event: GpEventView, action: "cancel" | "neutralize") {
    if (!gpId) return;
    const label = resultEventLabel(event.type);
    const filas =
      event.resultCount > 0
        ? ` Afecta a las ${event.resultCount} fila(s) de resultado de este evento.`
        : " El evento aún no tiene resultados importados.";
    setConfirmRequest(
      action === "cancel"
        ? {
            title: `Cancelar ${label}`,
            impact:
              `El evento no puntuará (0 para todos) y el recálculo lo saltará.` +
              filas +
              ` Acción irreversible: no se puede des-cancelar ni neutralizar después.`,
            irreversible: true,
            confirmLabel: "Sí, cancelar el evento",
            onConfirm: () => applyEventFlag(event, "cancel"),
          }
        : {
            title: `Neutralizar ${label}`,
            impact:
              `Se registra que ${label} se disputó con resultado oficial neutralizado ` +
              `(se puntuará con el resultado oficial declarado; el flag no altera los puntos).` +
              filas,
            confirmLabel: "Sí, neutralizar el evento",
            onConfirm: () => applyEventFlag(event, "neutralize"),
          },
    );
  }

  /** Ejecuta el cambio de estado de evento una vez confirmado. */
  function applyEventFlag(event: GpEventView, action: "cancel" | "neutralize") {
    const parsed = eventFlagInputSchema.safeParse({ gpId, eventId: event.id });
    if (!parsed.success) {
      setEventLocalError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    setEventLocalError(null);
    const mutation = action === "cancel" ? cancelEventMutation : neutralizeEventMutation;
    mutation.mutate(parsed.data);
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

  /**
   * Precarga el formulario de mapeo con una referencia sin mapear (US-17):
   * el operador no tiene que teclear a mano el ID que la fuente ya lista.
   */
  function prefillMapping(riderRef: string) {
    setMappingRiderRef(riderRef);
    document.getElementById("mappingRiderRef")?.focus();
  }

  type ContextChange = { kind: "season" | "gp" | "event"; value: string };

  /**
   * Cambio de contexto (temporada/GP/evento) con protección de trabajo: si
   * hay cambios sin importar en la tabla, se confirma el descarte antes de
   * perderlos (harden).
   */
  function applyContextChange(change: ContextChange) {
    pendingFromUrl.current = false;
    if (dirty) {
      setPendingChange({
        title: "Tienes resultados sin importar",
        impact:
          `Se perderán los cambios de la tabla${
            selectedEvent ? ` de ${resultEventLabel(selectedEvent.type)}` : ""
          } que no hayas importado. ` +
          "Si quieres conservarlos, cancela y pulsa «Importar resultados».",
        irreversible: true,
        confirmLabel: "Sí, descartar los cambios",
        onConfirm: () => commitContextChange(change),
      });
      return;
    }
    commitContextChange(change);
  }

  function commitContextChange(change: ContextChange) {
    if (change.kind === "season") {
      setSeasonId(change.value);
      setGpId("");
      setEventId("");
    } else if (change.kind === "gp") {
      setGpId(change.value);
      setEventId("");
    } else {
      setEventId(change.value);
    }
    setDirty(false);
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
  // US-18 (ADR-0020): errores de servidor del definitivo y de los estados
  // de evento (reactivo, sin estado).
  const definitiveServerIssues = markDefinitiveMutation.isError
    ? zodIssues(markDefinitiveMutation.error)
    : [];
  const definitiveError = markDefinitiveMutation.isError
    ? definitiveServerIssues.length > 0
      ? definitiveServerIssues.map((issue) => issue.message).join(" ")
      : markDefinitiveMutation.error.message
    : null;
  const eventFlagErrorMutation = [cancelEventMutation, neutralizeEventMutation].find(
    (mutation) => mutation.isError,
  );
  let eventServerError: string | null = null;
  if (eventFlagErrorMutation) {
    const eventIssues = zodIssues(eventFlagErrorMutation.error);
    eventServerError =
      eventIssues.length > 0
        ? eventIssues.map((issue) => issue.message).join(" ")
        : eventFlagErrorMutation.error.message;
  }
  const entries = hasEvent ? buildEntries() : [];
  // Regla de la Señal: el primario de la tarjeta es el siguiente paso del
  // ritual — «Marcar definitivo» cuando el evento ya tiene resultados;
  // «Importar resultados» mientras se capturan o corrigen.
  const closePrimary = gpState.data
    ? gpState.data.totalResults > 0 && !gpState.data.definitive
    : false;
  // Revisión/diff del paso 2: qué ha corregido el operador sobre las filas
  // importadas (baseline) antes de pulsar «Importar resultados».
  const modifiedRiders = new Set(
    Object.keys(rows).filter(
      (riderId) => JSON.stringify(rows[riderId]) !== JSON.stringify(baseline[riderId]),
    ),
  );

  return (
    <section>
      <div className="field">
        <label htmlFor="resultsSeasonId">Temporada</label>
        <select
          id="resultsSeasonId"
          value={seasonId}
          onChange={(event) =>
            applyContextChange({ kind: "season", value: event.target.value })
          }
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
            <Alert variant="error">
              No se pudieron cargar los GPs: {gps.error.message}
            </Alert>
          ) : gps.data.length === 0 ? (
            <p className="muted">Esta temporada aún no tiene GPs.</p>
          ) : (
            <div className="field">
              <label htmlFor="resultsGpId">GP</label>
              <select
                id="resultsGpId"
                value={gpId}
                onChange={(event) =>
                  applyContextChange({ kind: "gp", value: event.target.value })
                }
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
          {/* Elección de evento: el flujo crítico empieza aquí
              (elegir evento → tabla de importación manual). */}
          {gpEvents.isPending ? (
            <p className="muted">Consultando…</p>
          ) : gpEvents.isError ? (
            <Alert variant="error">
              No se pudieron cargar los eventos: {gpEvents.error.message}
            </Alert>
          ) : gpEvents.data.length === 0 ? (
            <p className="muted">Este GP aún no tiene eventos.</p>
          ) : (
            <div className="field">
              <label htmlFor="resultsEventId">Evento</label>
              <select
                id="resultsEventId"
                value={eventId}
                onChange={(event) =>
                  applyContextChange({ kind: "event", value: event.target.value })
                }
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

      {gpId !== "" && (
        <>
          {/* US-17 (ADR-0019): importación automática desde la fuente. */}
          <div>
            <h3>1. Importación automática (PulseLive)</h3>

            {sourceLocalError ? <Alert variant="error">{sourceLocalError}</Alert> : null}
            {sourceError ? <Alert variant="error">{sourceError}</Alert> : null}

            {sourceLinked ? (
              <p>
                Vinculado a la fuente: <code>{sourceLinked}</code>{" "}
                <RowAction
                  onClick={() =>
                    setConfirmRequest({
                      title: `Desvincular la fuente de ${gpLabel}`,
                      impact:
                        `El auto-import dejará de actualizar ${gpLabel} y tendrás que ` +
                        "volver a vincularlo. Los resultados ya importados no se tocan.",
                      confirmLabel: "Sí, desvincular la fuente",
                      onConfirm: () => unlinkMutation.mutate({ gpId }),
                    })
                  }
                  disabled={unlinkMutation.isPending}
                >
                  Desvincular
                </RowAction>
              </p>
            ) : (
              <form className="form" onSubmit={onLink} noValidate>
                {sourceEvents.isPending ? (
                  <p className="muted">Consultando el catálogo de la fuente…</p>
                ) : sourceEvents.isError ? (
                  <Alert variant="error">
                    No se pudieron cargar los eventos de la fuente:{" "}
                    {sourceEvents.error.message}
                  </Alert>
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
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={linkMutation.isPending}
                    >
                      Vincular GP
                    </Button>
                  </>
                )}
              </form>
            )}

            {sourceLinked && (
              <p>
                <span className="muted">Importar desde la fuente: </span>
                {selectedEvent === null ? (
                  <span className="muted">elige un evento para importarlo.</span>
                ) : importableEvents.some(
                    (candidate) => candidate.id === selectedEvent.id,
                  ) ? (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      importFromSourceMutation.mutate({ gpId, event: selectedEvent.type })
                    }
                    disabled={importFromSourceMutation.isPending}
                  >
                    Importar {resultEventLabel(selectedEvent.type)}
                  </Button>
                ) : (
                  <span className="muted">
                    este evento no es importable desde la fuente.
                  </span>
                )}
              </p>
            )}

            {lastSourceImport ? (
              <Alert variant="success">
                Importación automática (
                {selectedEvent ? resultEventLabel(selectedEvent.type) : "evento"}):{" "}
                {lastSourceImport.created} creados, {lastSourceImport.corrected}{" "}
                corregidos, {lastSourceImport.unchanged} sin cambios y{" "}
                {lastSourceImport.kept} conservados.
              </Alert>
            ) : null}
            {lastSourceImport && lastSourceImport.unmapped.length > 0 && (
              <p>
                <span className="muted">Sin mapear: </span>
                {lastSourceImport.unmapped.map((unmapped) => (
                  <span key={unmapped.riderRef}>
                    {unmapped.name ?? unmapped.riderRef}{" "}
                    <RowAction onClick={() => prefillMapping(unmapped.riderRef)}>
                      Mapear
                    </RowAction>{" "}
                  </span>
                ))}
              </p>
            )}

            <h4>Estado del auto-import</h4>
            {sourceState.isPending ? (
              <p className="muted">Consultando…</p>
            ) : sourceState.isError ? (
              <Alert variant="error">
                No se pudo cargar el estado: {sourceState.error.message}
              </Alert>
            ) : sourceState.data.length === 0 ? (
              <p className="muted">Aún no hay intentos registrados.</p>
            ) : (
              <div className="table-scroll">
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
                    {sourceState.data.map((state) => {
                      const overThreshold =
                        state.consecutiveFailures >=
                        PROVISIONAL_RESULTS_POLL.failureAlertThreshold;
                      return (
                        <tr
                          key={state.event}
                          className={overThreshold ? "bad" : undefined}
                        >
                          <td>{resultEventLabel(state.event)}</td>
                          <td>
                            {state.consecutiveFailures}
                            {overThreshold ? (
                              <span className="bad"> — ▲ umbral de fallos</span>
                            ) : null}
                          </td>
                          <td>{state.lastError ?? "—"}</td>
                          <td>
                            {state.lastAttemptAt
                              ? formatDateTime(state.lastAttemptAt)
                              : "—"}
                          </td>
                          <td>
                            {state.lastSuccessAt
                              ? formatDateTime(state.lastSuccessAt)
                              : "—"}
                          </td>
                          <td>
                            {state.lastUnmapped && state.lastUnmapped.length > 0
                              ? state.lastUnmapped.map((unmapped) => (
                                  <span key={unmapped.riderRef}>
                                    {unmapped.name ?? unmapped.riderRef}{" "}
                                    <RowAction
                                      onClick={() => prefillMapping(unmapped.riderRef)}
                                    >
                                      Mapear
                                    </RowAction>{" "}
                                  </span>
                                ))
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <h4>Mapeo de pilotos</h4>
            {riderMappings.isPending ? (
              <p className="muted">Consultando…</p>
            ) : riderMappings.isError ? (
              <Alert variant="error">
                No se pudieron cargar los mapeos: {riderMappings.error.message}
              </Alert>
            ) : (
              <>
                {riderMappings.data.length === 0 ? (
                  <p className="muted">Aún no hay mapeos de pilotos.</p>
                ) : (
                  <div className="table-scroll">
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
                              <RowAction
                                onClick={() =>
                                  setConfirmRequest({
                                    title: `Eliminar el mapeo de ${mapping.riderName}`,
                                    impact:
                                      "El piloto dejará de resolverse automáticamente " +
                                      "con este mapeo en las próximas importaciones.",
                                    irreversible: true,
                                    confirmLabel: "Sí, eliminar el mapeo",
                                    onConfirm: () =>
                                      deleteMappingMutation.mutate({
                                        riderRef: mapping.riderRef,
                                      }),
                                  })
                                }
                                disabled={deleteMappingMutation.isPending}
                              >
                                Eliminar
                              </RowAction>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <form className="form" onSubmit={onAddMapping} noValidate>
                  <Field
                    label="Referencia en la fuente"
                    name="mappingRiderRef"
                    id="mappingRiderRef"
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
                    variant="secondary"
                    disabled={setMappingMutation.isPending || riders.isPending}
                    disabledReason={
                      riders.isPending
                        ? "Cargando la lista de pilotos del mercado…"
                        : undefined
                    }
                  >
                    Añadir mapeo
                  </Button>
                </form>
              </>
            )}
          </div>
        </>
      )}

      <details
        className="ritual-step"
        open={manualOpen}
        onToggle={(event) => setManualOpen(event.currentTarget.open)}
      >
        <summary>
          <h3>
            2. Importación manual —{" "}
            {selectedEvent ? resultEventLabel(selectedEvent.type) : "elige un evento"}
          </h3>
        </summary>
        {!hasEvent && (
          <p className="muted">Elige un evento para revisar sus resultados.</p>
        )}
        {hasEvent && eventResults.data ? (
          <p className="muted">
            {eventResults.data.length > 0
              ? `${eventResults.data.length} filas importadas. Revisa lo que trajo la fuente y corrige lo que haga falta.`
              : "Aún no hay resultados importados para este evento: captúralos en la tabla o impórtalos desde el paso 1."}
            {modifiedRiders.size > 0
              ? ` ${modifiedRiders.size} modificada(s) sin importar.`
              : ""}
          </p>
        ) : null}
        {hasEvent && (
          <>
            {riders.isPending || eventResults.isPending ? (
              <p className="muted">Consultando…</p>
            ) : riders.isError || eventResults.isError ? (
              <Alert variant="error">No se pudieron cargar los resultados: {loadError}</Alert>
            ) : riders.data.length === 0 ? (
              <p className="muted">Aún no hay pilotos en el mercado.</p>
            ) : (
              <form className="form" onSubmit={onSubmit} noValidate>
                <div className="table-scroll">
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
                              <label className="check-cell">
                                <input
                                  type="checkbox"
                                  aria-label={`Salió: ${rider.name}`}
                                  checked={row.started}
                                  onChange={(event) =>
                                    toggleStarted(rider.id, event.target.checked)
                                  }
                                />
                              </label>
                            </td>
                            <td>
                              <label className="check-cell">
                                <input
                                  type="checkbox"
                                  aria-label={`Terminó: ${rider.name}`}
                                  disabled={!row.started}
                                  checked={row.finished}
                                  onChange={(event) =>
                                    toggleFinished(rider.id, event.target.checked)
                                  }
                                />
                              </label>
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
                                    aria-label={`${RESULT_CODE_LABELS[code]}: ${rider.name}`}
                                    checked={row.penalties.includes(code)}
                                    onChange={() => togglePenalty(rider.id, code)}
                                  />{" "}
                                  {RESULT_CODE_LABELS[code]}
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
                                      aria-label={`${RESULT_CODE_LABELS[code]}: ${rider.name}`}
                                      checked={row.bonuses.includes(code)}
                                      onChange={() => toggleBonus(rider.id, code)}
                                    />{" "}
                                    {RESULT_CODE_LABELS[code]}
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
                                {
                                  RESULT_STATUS_LABELS[
                                    deriveStatus({
                                      started: row.started,
                                      finished: row.finished,
                                    })
                                  ]
                                }
                                {modifiedRiders.has(rider.id) ? " · modificada" : ""}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <Field
                  label="Motivo (obligatorio si la importación corrige resultados existentes)"
                  name="reason"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setDirty(true);
                  }}
                  placeholder="p. ej. corrección de la parrilla oficial"
                />

                {localError ? <Alert variant="error">{localError}</Alert> : null}
                {serverError ? <Alert variant="error">{serverError}</Alert> : null}
                {lastImport ? (
                  <Alert variant="success">
                    Importación completada (
                    {selectedEvent ? resultEventLabel(selectedEvent.type) : "evento"}):{" "}
                    {lastImport.created} creados, {lastImport.corrected} corregidos,{" "}
                    {lastImport.unchanged} sin cambios y {lastImport.kept} conservados.
                  </Alert>
                ) : null}

                <Button
                  type="submit"
                  variant={closePrimary ? "secondary" : "primary"}
                  disabled={importMutation.isPending || entries.length === 0}
                  disabledReason={
                    entries.length === 0
                      ? "Rellena al menos una fila de la tabla: sin datos no hay nada que importar."
                      : undefined
                  }
                >
                  {importMutation.isPending ? "Importando…" : "Importar resultados"}
                </Button>
              </form>
            )}
          </>
        )}
      </details>

      {gpId !== "" && (
        <>
          {/* US-18 (ADR-0020): definitivo + estados de evento. */}
          <div>
            <h3>
              3. Definitivo y estados de evento —{" "}
              {selectedEvent ? resultEventLabel(selectedEvent.type) : "elige un evento"}
            </h3>

            {definitiveLocalError ? (
              <Alert variant="error">{definitiveLocalError}</Alert>
            ) : null}
            {definitiveError ? <Alert variant="error">{definitiveError}</Alert> : null}
            {eventLocalError ? <Alert variant="error">{eventLocalError}</Alert> : null}
            {eventServerError ? <Alert variant="error">{eventServerError}</Alert> : null}
            {eventFlagMessage ? (
              <Alert variant="success">{eventFlagMessage}</Alert>
            ) : null}
            {lastDefinitive ? (
              <Alert variant="success">
                {lastDefinitive.noop
                  ? "El GP ya era definitivo (sin cambios)."
                  : `GP definitivo: ${lastDefinitive.madeDefinitive} fila(s) a definitivo, ` +
                    `${lastDefinitive.reconfirmed} reconfirmadas y ${lastDefinitive.lineupsScored} ` +
                    `lineups puntuados (${lastDefinitive.resultsVersion}).`}
              </Alert>
            ) : null}

            {gpState.isPending ? (
              <p className="muted">Consultando…</p>
            ) : gpState.isError ? (
              <Alert variant="error">
                No se pudo cargar el estado: {gpState.error.message}
              </Alert>
            ) : (
              <>
                <p>
                  Estado:{" "}
                  <strong>
                    {gpState.data.definitive
                      ? `definitivo${
                          gpState.data.resultsVersion
                            ? ` (${gpState.data.resultsVersion})`
                            : ""
                        }`
                      : "provisional"}
                  </strong>{" "}
                  · {gpState.data.counts.provisional} provisional(es),{" "}
                  {gpState.data.counts.definitive} definitivo(s),{" "}
                  {gpState.data.counts.corrected} corregido(s) ·{" "}
                  {gpState.data.totalResults} resultados · {gpState.data.lineups} lineups
                </p>
                {gpState.data.totalResults === 0 ? (
                  <p className="muted">
                    Importa los resultados antes de marcar el GP definitivo.
                  </p>
                ) : !gpState.data.definitive ? (
                  <Button
                    onClick={onMarkDefinitive}
                    disabled={markDefinitiveMutation.isPending}
                  >
                    {markDefinitiveMutation.isPending ? "Marcando…" : "Marcar definitivo"}
                  </Button>
                ) : null}

                {gpEvents.data && gpEvents.data.length > 0 && (
                  <p>
                    <span className="muted">Estados de evento: </span>
                    {gpEvents.data.map((event) => {
                      if (event.id !== eventId) {
                        // Los demás eventos solo muestran su estado: las
                        // acciones viven en el evento elegido (un solo
                        // mecanismo de selección alimenta todo el ritual).
                        return <span key={event.id}>{eventOptionLabel(event)} </span>;
                      }
                      // Solo se ofrece lo que el servidor ejecutará
                      // (ADR-0020): cancelar es irreversible (después no hay
                      // transición) y neutralizar es idempotente (repetir =
                      // no-op). Nunca se ofrece neutralizar sobre cancelado:
                      // el cancelado excluye el evento del recálculo, así que
                      // la neutralización posterior no tendría efecto.
                      const canCancel = !event.cancelled;
                      const canNeutralize = !event.cancelled && !event.neutralized;
                      return (
                        <span key={event.id}>
                          {eventOptionLabel(event)}:{" "}
                          {canCancel ? (
                            <RowAction
                              onClick={() => onEventFlag(event, "cancel")}
                              disabled={
                                cancelEventMutation.isPending ||
                                neutralizeEventMutation.isPending
                              }
                            >
                              Cancelar evento
                            </RowAction>
                          ) : null}{" "}
                          {canNeutralize ? (
                            <RowAction
                              onClick={() => onEventFlag(event, "neutralize")}
                              disabled={
                                cancelEventMutation.isPending ||
                                neutralizeEventMutation.isPending
                              }
                            >
                              Neutralizar evento
                            </RowAction>
                          ) : null}{" "}
                          {!canCancel && !canNeutralize ? (
                            <span className="muted">sin transiciones</span>
                          ) : null}
                        </span>
                      );
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}

      {confirmRequest ? (
        <ConfirmDialog
          {...confirmRequest}
          onClose={() => setConfirmRequest(null)}
          onConfirm={() => {
            const run = confirmRequest.onConfirm;
            setConfirmRequest(null);
            run();
          }}
        />
      ) : null}

      {pendingChange ? (
        <ConfirmDialog
          {...pendingChange}
          onClose={() => {
            setPendingChange(null);
            if (!pendingFromUrl.current) return;
            pendingFromUrl.current = false;
            // Cancelar un cambio que vino de la URL: revierte la URL al
            // contexto de la cascada (la fuente de verdad) para que URL y
            // cascada vuelvan a coincidir y el operador pueda reintentar la
            // CTA (un re-click a la misma URL no re-dispararía la navegación).
            const params = new URLSearchParams();
            if (seasonId) params.set("season", seasonId);
            if (gpId) params.set("gp", gpId);
            if (eventId) params.set("event", eventId);
            const query = params.toString();
            window.history.replaceState(
              null,
              "",
              query ? `?${query}` : window.location.pathname,
            );
            lastSyncedSearch.current = query;
          }}
          onConfirm={() => {
            pendingFromUrl.current = false;
            const run = pendingChange.onConfirm;
            setPendingChange(null);
            run();
          }}
        />
      ) : null}
    </section>
  );
}
