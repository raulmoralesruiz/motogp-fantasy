"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Button,
  ConfirmDialog,
  type ConfirmRequest,
} from "@/shared/components";
import { formatNumber } from "@/shared/format";
import { trpc } from "@/trpc/client";

/** Borrador del lineup (IDs de activos; el servidor recalcula el coste). */
interface Draft {
  gold: [string, string];
  silver: [string, string];
  constructorId: string;
  teamId: string;
}

const EMPTY_DRAFT: Draft = {
  gold: ["", ""],
  silver: ["", ""],
  constructorId: "",
  teamId: "",
};

/** Piloto del contexto del builder (solo los campos que usa la UI). */
interface RiderOption {
  riderId: string;
  name: string;
  teamName: string;
  price: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Entrada del historial (los 3 campos que usa la etiqueta de cambio). */
type ChangeRef = {
  type: string;
  assetType: string | null;
  assetId: string | null;
};

/** Mercado del GP para resolver nombres (solo los campos que se usan). */
type MarketNames = {
  riders: Array<{ riderId: string; name: string }>;
  constructors: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
} | null;

/**
 * Nombre del activo de una entrada del historial, resuelto contra el mercado
 * del GP (invariante 5: constructor ≠ equipo). Si el activo ya no está en
 * el mercado —o la entrada no lleva activo—, se devuelve el ID tal cual:
 * nunca se oculta.
 */
function assetName(change: ChangeRef, market: MarketNames): string | null {
  if (change.assetId === null || change.assetType === null) return null;
  if (change.assetType === "rider") {
    return (
      market?.riders.find((r) => r.riderId === change.assetId)?.name ??
      change.assetId
    );
  }
  if (change.assetType === "constructor") {
    return (
      market?.constructors.find((c) => c.id === change.assetId)?.name ??
      change.assetId
    );
  }
  if (change.assetType === "team") {
    return (
      market?.teams.find((t) => t.id === change.assetId)?.name ??
      change.assetId
    );
  }
  return change.assetId;
}

/** Verbos de los movimientos de activos (F3: en español, no tipo crudo). */
const CHANGE_VERBS: Record<string, string> = {
  add: "Alta",
  remove: "Baja",
  swap: "Cambio",
};

/**
 * Etiqueta de una entrada del historial en español (F3): verbo + nombre del
 * activo, sin tipos en inglés ni IDs crudos salvo como fallback.
 */
function changeLabel(change: ChangeRef, market: MarketNames): string {
  if (change.type === "wildcard") return "Wildcard (reset completo)";
  if (change.type === "gold_silver") {
    const name = assetName(change, market);
    return name ? `Reasignación oro↔plata de ${name}` : "Reasignación oro↔plata";
  }
  const verb = CHANGE_VERBS[change.type];
  if (verb === undefined) return change.type;
  const name = assetName(change, market);
  return name ? `${verb} de ${name}` : verb;
}

/**
 * Slots pendientes de rellenar, en lenguaje de fan (F3: decir QUÉ falta,
 * no recitar la fórmula completa "2 oro, 2 plata, constructor y equipo").
 */
function missingSlots(draft: Draft): string[] {
  const missing: string[] = [];
  if (draft.gold[0] === "") missing.push("piloto oro 1");
  if (draft.gold[1] === "") missing.push("piloto oro 2");
  if (draft.silver[0] === "") missing.push("piloto plata 1");
  if (draft.silver[1] === "") missing.push("piloto plata 2");
  if (draft.constructorId === "") missing.push("constructor");
  if (draft.teamId === "") missing.push("equipo");
  return missing;
}

/** ¿Dos listas de slots con los mismos IDs? (insensible al orden). */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** ¿El borrador coincide con el lineup guardado? (orden insensible en oro/plata). */
function draftMatchesSaved(
  draft: Draft,
  slots: {
    gold: readonly string[];
    silver: readonly string[];
    constructorId: string | null;
    teamId: string | null;
  },
): boolean {
  return (
    sameList(draft.gold, slots.gold) &&
    sameList(draft.silver, slots.silver) &&
    draft.constructorId === (slots.constructorId ?? "") &&
    draft.teamId === (slots.teamId ?? "")
  );
}

/** ¿El borrador tiene algún slot rellenado? (F3 P1-1: trabajo sin guardar sin lineup previo). */
function anySlotFilled(draft: Draft): boolean {
  return (
    draft.gold[0] !== "" ||
    draft.gold[1] !== "" ||
    draft.silver[0] !== "" ||
    draft.silver[1] !== "" ||
    draft.constructorId !== "" ||
    draft.teamId !== ""
  );
}

/**
 * Razón de una entrada del historial en texto llano (F3: sin IDs crudos):
 * los identificadores internos (`exencion:<uuid>`) se traducen; lo
 * desconocido se muestra tal cual, igual que `assetName` (nunca se oculta).
 */
function reasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  if (reason.startsWith("exencion:")) return "exención consumida";
  return reason;
}

/**
 * Builder de lineups (US-09). El cliente solo envía IDs: coste y
 * presupuesto se recalculan siempre en el servidor (invariante 2). El
 * coste en vivo es solo de presentación.
 */
export default function LineupsPage() {
  const queryClient = useQueryClient();
  const seasons = trpc.seasons.list.useQuery();
  const [seasonId, setSeasonId] = useState("");
  const [gpId, setGpId] = useState("");

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });
  const builder = trpc.lineups.builder.useQuery({ gpId }, { enabled: gpId !== "" });
  const lineup = trpc.lineups.get.useQuery({ gpId }, { enabled: gpId !== "" });
  const history = trpc.lineups.history.useQuery({ gpId }, { enabled: gpId !== "" });

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const prefilledFor = useRef<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Confirmación con impacto pendiente (patrón del sistema: nunca
  // `window.confirm` — el impacto se lee y la acción se nombra).
  const [confirmRequest, setConfirmRequest] =
    useState<ConfirmRequest | null>(null);
  // Reloj local para re-evaluar el lockout (F3): `gpClosed` compara contra
  // la hora del último render; un tick cada 30 s mantiene la lectura al día
  // sin recargar nada (en el envío el servidor sigue mandando).
  const [now, setNow] = useState(() => new Date());

  // Temporada por defecto: la más reciente (F3, patrón /mercado: la lista va
  // en orden ascendente y la temporada activa es la última).
  useEffect(() => {
    if (seasonId !== "" || seasons.data === undefined) return;
    const last = seasons.data[seasons.data.length - 1];
    if (last) setSeasonId(last.id);
  }, [seasons.data, seasonId]);

  // GP por defecto: el primer GP programado por ronda (F3, patrón /mercado):
  // la página abre donde el fan va a trabajar, no en "— Temporada —".
  useEffect(() => {
    if (gpId !== "" || gps.data === undefined) return;
    const next = [...gps.data]
      .sort((a, b) => a.round - b.round)
      .find((g) => g.status === "scheduled");
    if (next) setGpId(next.id);
  }, [gps.data, gpId]);

  // Tick de reloj (F3): cada 30 s el estado del lockout se re-evalúa sin que
  // la UI se quede "abierto" pasado el cierre (el envío lo rechaza el
  // servidor; la lectura no debe depender del error).
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Al cambiar de GP: borrador vacío y mensajes limpios.
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    prefilledFor.current = null;
    setSuccess(null);
    setError(null);
  }, [gpId]);

  // Cuando llega el lineup guardado del GP actual: rellenar el borrador.
  useEffect(() => {
    if (lineup.data && lineup.data.gpId === gpId && prefilledFor.current !== gpId) {
      prefilledFor.current = gpId;
      // No pisar la entrada del usuario (barrido P3): si el fan ya eligió
      // algún slot antes de que llegue `lineup.data` (carrera rara), el
      // prefill se salta — el borrador vacío sigue rellenándose a tope.
      if (anySlotFilled(draft)) return;
      setDraft({
        gold: [lineup.data.slots.gold[0] ?? "", lineup.data.slots.gold[1] ?? ""],
        silver: [lineup.data.slots.silver[0] ?? "", lineup.data.slots.silver[1] ?? ""],
        constructorId: lineup.data.slots.constructorId ?? "",
        teamId: lineup.data.slots.teamId ?? "",
      });
    }
  }, [lineup.data, gpId, draft]);

  const save = trpc.lineups.save.useMutation({
    // `variables.gpId` (F3 P1): el GP de ENVÍO, no el del último render. Si el
    // usuario cambia de GP mientras la mutación vuela, el éxito debe nombrar e
    // invalidar el GP que SÍ se guardó, no el que se ve en pantalla (señal
    // falsa de éxito + caché obsoleta del GP guardado).
    onSuccess: (result, variables) => {
      const gpName =
        gps.data?.find((g) => g.id === variables.gpId)?.name ?? "el GP";
      const base = `Lineup guardado para ${gpName}. Cambios restantes: ${result.remainingChanges}.`;
      // 0 cambios restantes (barrido P3): la salida accionable es el
      // wildcard (el error server-side ya lo sugiere) — solo si la temporada
      // aún lo tiene disponible, para no prometer un recurso gastado.
      setSuccess(
        result.remainingChanges === 0 && wildcardAvailable
          ? `${base} Si no te quedan cambios, puedes usar tu wildcard de temporada.`
          : base,
      );
      setError(null);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.get, { gpId: variables.gpId }),
      });
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.history, { gpId: variables.gpId }),
      });
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.builder, { gpId: variables.gpId }),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo guardar el lineup.");
      setSuccess(null);
    },
  });

  /**
   * Wildcard (US-12, ADR-0017): reset completo sin consumir cambios del GP.
   * El servidor es el que manda (lockout, 1/temporada, presupuesto); la UI
   * solo pregunta, envía los IDs y re-consulta.
   */
  const wildcard = trpc.lineups.wildcard.useMutation({
    // `variables.gpId` (F3 P1): el GP de envío, no el del último render (misma
    // guarda que `save`).
    onSuccess: (_result, variables) => {
      setSuccess(
        "Wildcard aplicado: lineup reemplazado sin consumir cambios de este GP.",
      );
      setError(null);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.get, { gpId: variables.gpId }),
      });
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.history, { gpId: variables.gpId }),
      });
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.builder, { gpId: variables.gpId }),
      });
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo aplicar el wildcard.",
      );
      setSuccess(null);
    },
  });

  const riders: RiderOption[] = useMemo(
    () =>
      (builder.data?.riders ?? []).map((r) => ({
        riderId: r.riderId,
        name: r.name,
        teamName: r.teamName,
        price: r.price,
      })),
    [builder.data],
  );

  const draftCost = useMemo(() => {
    const values: number[] = [];
    for (const id of [...draft.gold, ...draft.silver]) {
      const rider = riders.find((r) => r.riderId === id);
      if (!rider || rider.price === null) return null;
      values.push(rider.price);
    }
    const ctor = builder.data?.constructors.find((c) => c.id === draft.constructorId);
    if (!ctor || ctor.price === null) return null;
    const team = builder.data?.teams.find((t) => t.id === draft.teamId);
    if (!team || team.price === null) return null;
    return round2(values.reduce((a, b) => a + b, 0) + ctor.price + team.price);
  }, [draft, riders, builder.data]);

  /**
   * Precio del piloto elegido en un slot (F3: a un vistazo, no solo
   * plegado en el `<option>`). `null` si no hay piloto elegido o no está
   * en el mercado del GP.
   */
  function riderPriceLabel(riderId: string): string | null {
    const found = riders.find((r) => r.riderId === riderId);
    if (found === undefined) return null;
    return found.price === null
      ? "Sin precio para este GP."
      : `Precio: ${formatNumber(found.price)}`;
  }

  /** Precio del constructor/equipo elegido (misma intención, F3). */
  function assetPriceLabel(
    list: { id: string; price: number | null }[],
    id: string,
  ): string | null {
    if (id === "") return null;
    const found = list.find((x) => x.id === id);
    if (found === undefined) return null;
    return found.price === null
      ? "Sin precio para este GP."
      : `Precio: ${formatNumber(found.price)}`;
  }

  // `now` (tick de 30 s), no `new Date()` del último render: el estado no
  // puede quedarse congelado en "abierto" pasado el lockout.
  //
  // Hardening: el GP no admite guardados por tres motivos distintos —
  // `locked` (lockout explícito o por plazo), `finished` (carrera ya
  // disputada) o `cancelled` (carrera cancelada — 0 puntos). Antes solo se
  // miraba `locked`/`lockoutAt`: un GP cancelado (o finalizado con el
  // lockout ya pasado) seguía "guardable" en la UI. La prioridad es la más
  // terminal primero: un GP cancelado no es "bloqueado por plazo".
  const gpClosedReason: "locked" | "finished" | "cancelled" | null = builder.data
    ? builder.data.gp.status === "cancelled"
      ? "cancelled"
      : builder.data.gp.status === "finished"
        ? "finished"
        : builder.data.gp.status === "locked" ||
            (builder.data.gp.lockoutAt !== null && now >= builder.data.gp.lockoutAt)
          ? "locked"
          : null
    : null;

  const gpClosed = gpClosedReason !== null;

  /**
   * Motivo escrito del cierre del GP (nunca un control bloqueado sin
   * explicación). Nombra el estado real — finalizado, cancelado o lockout —
   * no todo "bloqueado". `null` si el GP sigue abierto.
   */
  const gpClosedLabel =
    gpClosedReason === "cancelled"
      ? "El GP está cancelado."
      : gpClosedReason === "finished"
        ? "El GP está finalizado."
        : gpClosedReason === "locked"
          ? "El GP está bloqueado (lockout)."
          : null;

  /**
   * Plazo de cierre (F3 P2): el deadline es el dato más importante de la
   * ventana — se lee ANTES de que el lockout lo oculte. `now` (tick de 30 s)
   * mantiene la cuenta al día sin recargar nada.
   */
  const lockoutAt = builder.data?.gp.lockoutAt ?? null;
  const minutesToLockout =
    lockoutAt !== null
      ? Math.ceil((lockoutAt.getTime() - now.getTime()) / 60_000)
      : null;

  const draftComplete =
    draft.gold[0] !== "" &&
    draft.gold[1] !== "" &&
    draft.silver[0] !== "" &&
    draft.silver[1] !== "" &&
    draft.constructorId !== "" &&
    draft.teamId !== "";

  const canSubmit = gpId !== "" && !gpClosed && !save.isPending && draftComplete;

  /**
   * Motivo de bloqueo del botón (compromiso de marca: nunca un control
   * bloqueado sin explicación). Sin motivo (guardando) el bloqueo es
   * transitorio y se queda `disabled` nativo.
   */
  // Se dice QUÉ falta exactamente, no la fórmula entera (F3). El motivo del
  // GP nombra el estado real (harden): finalizado, cancelado o lockout.
  const disabledReason = gpClosedLabel
    ? gpClosedLabel
    : !draftComplete
      ? `Composición incompleta: faltan ${missingSlots(draft).join(", ")}.`
      : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    save.mutate({
      gpId,
      slots: {
        gold: draft.gold,
        silver: draft.silver,
        constructorId: draft.constructorId,
        teamId: draft.teamId,
      },
    });
  }

  /**
   * Wildcard disponible según el estado de la temporada (US-12).
   * `!= null` (no `!== null`): en estado pendiente `data` es `undefined`.
   */
  const wildcardAvailable =
    builder.data != null &&
    builder.data.wildcardsUsed < builder.data.wildcardsPerSeason;

  /**
   * Borrador distinto del lineup guardado (orden insensible en oro/plata).
   * Acotado al GP ACTUAL: datos de otro GP (caché en transición) no marcan
   * el borrador como sucio (misma guarda que el prefill).
   */
  const draftDirty =
    lineup.data != null &&
    lineup.data.gpId === gpId &&
    !draftMatchesSaved(draft, lineup.data.slots);

  /**
   * Trabajo sin guardar (F3 P1-1): si hay lineup guardado para este GP, el
   * borrador difiere del guardado; si NO hay lineup guardado, cualquier slot
   * rellenado es trabajo. Con `draftDirty` solo, un borrador NUEVO se
   * perdería en silencio al cambiar de GP/temporada o al salir de la pestaña.
   */
  const hasUnsavedWork =
    lineup.data != null && lineup.data.gpId === gpId
      ? draftDirty
      : anySlotFilled(draft);

  /**
   * Descarta el borrador: vuelve a los slots del lineup guardado (o al
   * vacío, si no hay lineup guardado).
   */
  function discardDraft() {
    if (lineup.data == null) {
      setDraft(EMPTY_DRAFT);
    } else {
      setDraft({
        gold: [...lineup.data.slots.gold] as [string, string],
        silver: [...lineup.data.slots.silver] as [string, string],
        constructorId: lineup.data.slots.constructorId ?? "",
        teamId: lineup.data.slots.teamId ?? "",
      });
    }
    setSuccess(null);
    setError(null);
  }

  /**
   * Cambiar de GP o de temporada descarta el borrador (useEffect sobre
   * `gpId`). Con trabajo sin guardar (borrador dirty O borrador nuevo),
   * confirmación con impacto ANTES de tocar nada (F3 P1-1): el trabajo del
   * fan no se pierde en silencio.
   */
  function requestGpChange(nextGpId: string) {
    if (nextGpId === gpId) return;
    if (hasUnsavedWork) {
      setConfirmRequest({
        title: "Cambiar de GP",
        impact: "Los cambios del borrador que no hayas guardado se perderán.",
        confirmLabel: "Sí, cambiar de GP",
        onConfirm: () => setGpId(nextGpId),
      });
      return;
    }
    setGpId(nextGpId);
  }

  function requestSeasonChange(nextSeasonId: string) {
    if (nextSeasonId === seasonId) return;
    if (hasUnsavedWork) {
      setConfirmRequest({
        title: "Cambiar de temporada",
        impact: "Los cambios del borrador que no hayas guardado se perderán.",
        confirmLabel: "Sí, cambiar de temporada",
        onConfirm: () => {
          setSeasonId(nextSeasonId);
          setGpId("");
        },
      });
      return;
    }
    setSeasonId(nextSeasonId);
    setGpId("");
  }

  // Trabajo sin guardar: el navegador avisa al salir de la pestaña (F3
  // P1-1). Cubre también el borrador NUEVO (sin lineup guardado).
  // `returnValue` es lo que el estándar exige para mostrar el aviso.
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedWork]);

  /**
   * Wildcard: acción destructiva por diseño (reset completo) — confirmación
   * con impacto escrito (patrón del sistema: nunca `window.confirm`).
   */
  function handleWildcard() {
    // `!draftDirty` (F3 P1): el wildcard es un no-op si el borrador coincide
    // con el guardado (o si no hay guardado: "Guardar lineup" lo crea gratis).
    if (gpClosed || !draftComplete || !wildcardAvailable || !draftDirty) return;
    // El impacto nombra cuántos wildcards concede la temporada (F3 P2-2):
    // "único" solo es verdad con 1 por temporada.
    const perSeason = builder.data?.wildcardsPerSeason ?? 1;
    setConfirmRequest({
      title: "Usar tu wildcard de temporada",
      impact: `El lineup de este GP se reemplazará por tu borrador. ${
        perSeason === 1
          ? "Es tu único wildcard de la temporada"
          : `Son tus ${perSeason} wildcards de la temporada`
      } y no consume cambios de este GP.`,
      confirmLabel: "Sí, usar wildcard",
      // `irreversible` (barrido P3): el wildcard reescribe el lineup y consume
      // el recurso escaso de la temporada — mismo tratamiento que /admin.
      irreversible: true,
      onConfirm: () => {
        wildcard.mutate({
          gpId,
          slots: {
            gold: draft.gold,
            silver: draft.silver,
            constructorId: draft.constructorId,
            teamId: draft.teamId,
          },
        });
      },
    });
  }

  /** Motivo de bloqueo del botón de wildcard (nunca un control sin explicación). */
  const wildcardDisabledReason = gpClosedLabel
    ? gpClosedLabel
    : !draftComplete
      ? `Composición incompleta: faltan ${missingSlots(draft).join(", ")}.`
      : !wildcardAvailable
        ? "Ya usaste tu wildcard esta temporada."
        : !draftDirty
          // F3 P1: no gastar el wildcard en un no-op. Dos causas distintas,
          // dos motivos distintos (el recurso escaso no se pierde en silencio).
          ? lineup.data != null && lineup.data.gpId === gpId
            ? "El borrador es idéntico al lineup guardado: no hay que gastar el wildcard."
            : "Aún no has guardado un lineup para este GP: 'Guardar lineup' no consume el wildcard."
          : undefined;

  function riderSelect(
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) {
    const taken = [draft.gold[0], draft.gold[1], draft.silver[0], draft.silver[1]];
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Piloto —</option>
          {riders.map((r) => {
            const alreadyTaken = taken.includes(r.riderId) && value !== r.riderId;
            const disabled = alreadyTaken || r.price === null;
            return (
              <option key={r.riderId} value={r.riderId} disabled={disabled}>
                {r.name} ({r.teamName})
                {r.price === null ? " — sin precio" : ` — ${formatNumber(r.price)}`}
                {alreadyTaken ? " — ya en otro slot" : ""}
              </option>
            );
          })}
        </select>
        {value !== "" && (
          <span className="muted">{riderPriceLabel(value)}</span>
        )}
      </div>
    );
  }

  if (seasons.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (seasons.isError) {
    // Error de página (no de sección): mensaje sereno, patrón /mercado.
    return <p className="muted">No se pudo cargar la lista de temporadas.</p>;
  }

  return (
    <div>
      <h2>Temporada y GP</h2>
      {/* .stack: los dos campos del mismo bloque comparten el gap del
          sistema (F3) — antes quedaban apilados sin espacio entre sí. */}
      <div className="stack">
        <div className="field">
          <label htmlFor="season">Temporada</label>
          <select
            id="season"
            value={seasonId}
            onChange={(e) => requestSeasonChange(e.target.value)}
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
            <select id="gp" value={gpId} onChange={(e) => requestGpChange(e.target.value)}>
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
      {/* F3 P3 + P2: nombrar el estado real — sin temporada, la instrucción
          es elegir temporada (el select de GP está oculto); temporada sin
          GPs no es lo mismo que "falta elegir GP". */}
      {gpId === "" &&
        (seasonId === "" ? (
          <p className="muted">Selecciona una temporada.</p>
        ) : gps.data?.length === 0 ? (
          <p className="muted">
            Esta temporada no tiene GPs programados todavía.
          </p>
        ) : (
          <p className="muted">Selecciona un GP para componer tu lineup.</p>
        ))}

      {gpId !== "" && (builder.isPending || lineup.isPending) && (
        <p className="muted">Consultando…</p>
      )}
      {gpId !== "" && builder.isError && (
        // Error accionable (barrido P3): el fallo nombra el siguiente paso —
        // reintentar sin recargar la página.
        <div className="stack">
          <Alert variant="error">No se pudo cargar el mercado del GP.</Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => builder.refetch()}
          >
            Reintentar
          </Button>
        </div>
      )}
      {/* Hardening: cada estado terminal del GP nombra su motivo real —
          cancelado (0 puntos), finalizado (ya no se modifica) o lockout —
          con la variante de color que le corresponde (no todo "error").
          Se lee ANTES de los fallos de carga: es el dato más relevante para
          decidir (A P2-2: no enterrar el estado bajo dos avisos ámbar). */}
      {gpId !== "" && gpClosedReason !== null && (
        <>
          {gpClosedReason === "cancelled" && (
            <Alert variant="warning">
              GP cancelado: tu lineup no puntuará (0 puntos).
            </Alert>
          )}
          {gpClosedReason === "finished" && (
            <Alert variant="info">
              GP finalizado: ya no se puede guardar ni modificar.
            </Alert>
          )}
          {gpClosedReason === "locked" && (
            <Alert variant="error">
              El GP está bloqueado (lockout): no se pueden guardar lineups.
            </Alert>
          )}
        </>
      )}
      {/* F3 P2: un fallo de `lineups.get`/`history` no puede pasar en
          silencio — el fan TIENE lineup en juego y no puede componer sobre
          el vacío creyendo que no hay nada. Hardening: error accionable —
          reintentar sin recargar (mismo patrón que `builder.isError`). */}
      {gpId !== "" && lineup.isError && (
        <div className="stack">
          <Alert variant="warning">
            No se pudo cargar tu lineup guardado; el borrador parte de vacío.
          </Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => lineup.refetch()}
          >
            Reintentar
          </Button>
        </div>
      )}
      {gpId !== "" && history.isError && (
        <div className="stack">
          <Alert variant="warning">
            No se pudo cargar el historial de cambios de este GP.
          </Alert>
          <Button
            type="button"
            variant="secondary"
            onClick={() => history.refetch()}
          >
            Reintentar
          </Button>
        </div>
      )}

      {gpId !== "" && builder.data && (
        <div>
          {/* F3 P2: el deadline se lee ANTES de que el lockout lo oculte —
              en una cabina operativa el plazo de cierre es el dato central. */}
          {!gpClosed &&
            minutesToLockout !== null &&
            minutesToLockout > 0 &&
            minutesToLockout <= 30 && (
              <Alert variant="warning">
                Cierre de cambios en {minutesToLockout} min.
              </Alert>
            )}
          <h2>Lineup — {builder.data.gp.name}</h2>
          {/* Capa de ayuda de vocabulario (F3, patrón F1 de /admin): los
              términos de esta página se explican una sola vez, en su primera
              aparición — aquí, justo antes de la lista de estado. */}
          <p className="muted">
            J (jornada): la ronda del GP. Presupuesto: base + carry (carry:
            parte del presupuesto del GP anterior que se devuelve, con tope).
            Coste: suma de los precios de
            los activos del GP. Saldo: presupuesto − coste (se muestra el del
            lineup guardado y el del borrador en edición). Cambios restantes:
            movimientos (alta, baja o cambio de activo) que aún puedes hacer en
            este GP. Piloto oro / piloto plata: pesos de puntuación (el peso
            exacto lo fijan las reglas de la temporada). Wildcard: reset
            completo del lineup sin consumir cambios del GP;{" "}
            {builder.data.wildcardsPerSeason} por temporada. Bloqueado
            (lockout): el GP ya no admite guardados.
          </p>
          <ul className="status">
            {/* F3 P2: el plazo de cierre se lee siempre (no solo al bloquear)
                — el deadline es el dato más importante de la ventana.
                Hardening (A P3-7): un GP cancelado no tiene ventana de
                cambios que cerrar — la fila se oculta solo en ese estado. */}
            {lockoutAt !== null && gpClosedReason !== "cancelled" && (
              <li>
                Cierre de cambios:{" "}
                <strong>
                  {new Date(lockoutAt).toLocaleString("es-ES", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </strong>
              </li>
            )}
            <li>
              Presupuesto: <strong>{formatNumber(builder.data.budget.total)}</strong>{" "}
              <span className="muted">
                (base {formatNumber(builder.data.budget.base)} + carry {formatNumber(builder.data.budget.carry)})
              </span>
            </li>
            {/* Dos sub-bloques en lenguaje de fan (F3 P2): lo que YA está en
                juego (guardado) y lo que pasa si guardas el borrador ahora —
                las cifras financieras siempre mapeadas a una decisión. */}
            {lineup.data && (
              <li>
                Tu lineup (en juego):{" "}
                <strong>
                  coste {formatNumber(lineup.data.cost)} · saldo {formatNumber(lineup.data.balance)}
                </strong>{" "}
                <span className="muted">
                  · cambios restantes {lineup.data.remainingChanges}
                </span>
              </li>
            )}
            {/* Coste en vivo SIEMPRE (F3): también al editar un lineup
                guardado — la restricción central no pierde su lectura justo
                cuando más se necesita. Destacada (status-dirty) si el
                borrador tiene cambios sin guardar. Hardening (A P1): en un GP
                cerrado la fila nombra el coste del borrador (dato de
                referencia), no "Si guardas ahora" — guardar es imposible y la
                señal de "cambios sin guardar" pierde sentido (A P2). */}
            <li className={draftDirty && !gpClosed ? "status-dirty" : undefined}>
              {gpClosed ? "Coste del borrador:" : "Si guardas ahora:"}{" "}
              <strong>coste {draftCost === null ? "—" : formatNumber(draftCost)}</strong>
              {draftCost !== null &&
                (builder.data.budget.total - draftCost < 0 ? (
                  // Sobrecoste: señal semántica (F3 P1-2) — el fan no debe
                  // descubrir al pulsar "Guardar" que el borrador no cabe.
                  <span className="bad">
                    {`· saldo ${formatNumber(round2(builder.data.budget.total - draftCost))} — excede el presupuesto en ${formatNumber(round2(draftCost - builder.data.budget.total))}`}
                  </span>
                ) : (
                  <span className="muted">
                    · saldo {formatNumber(round2(builder.data.budget.total - draftCost))}
                  </span>
                ))}
              {draftDirty && !gpClosed && (
                <span className="muted">· cambios sin guardar</span>
              )}
            </li>
            <li>
              Wildcard:{" "}
              <strong>
                {wildcardAvailable ? "disponible" : "ya usado"}
              </strong>{" "}
              <span className="muted">
                {wildcardAvailable
                  ? `(${builder.data.wildcardsPerSeason} por temporada)`
                  : "esta temporada"}
              </span>
            </li>
          </ul>
          <form className="form" onSubmit={handleSubmit} noValidate>
            {riderSelect("gold-1", "Piloto oro 1", draft.gold[0], (v) =>
              setDraft((d) => ({ ...d, gold: [v, d.gold[1]] })),
            )}
            {riderSelect("gold-2", "Piloto oro 2", draft.gold[1], (v) =>
              setDraft((d) => ({ ...d, gold: [d.gold[0], v] })),
            )}
            {riderSelect("silver-1", "Piloto plata 1", draft.silver[0], (v) =>
              setDraft((d) => ({ ...d, silver: [v, d.silver[1]] })),
            )}
            {riderSelect("silver-2", "Piloto plata 2", draft.silver[1], (v) =>
              setDraft((d) => ({ ...d, silver: [d.silver[0], v] })),
            )}
            <div className="field">
              <label htmlFor="constructor">Constructor</label>
              <select
                id="constructor"
                value={draft.constructorId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, constructorId: e.target.value }))
                }
              >
                <option value="">— Constructor —</option>
                {builder.data.constructors.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.price === null}>
                    {c.name}
                    {c.price === null ? " — sin precio" : ` — ${formatNumber(c.price)}`}
                  </option>
                ))}
              </select>
              {draft.constructorId !== "" && (
                <span className="muted">
                  {assetPriceLabel(builder.data.constructors, draft.constructorId)}
                </span>
              )}
            </div>
            <div className="field">
              <label htmlFor="team">Equipo</label>
              <select
                id="team"
                value={draft.teamId}
                onChange={(e) => setDraft((d) => ({ ...d, teamId: e.target.value }))}
              >
                <option value="">— Equipo —</option>
                {builder.data.teams.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.price === null}>
                    {t.name} ({t.constructorName})
                    {t.price === null ? " — sin precio" : ` — ${formatNumber(t.price)}`}
                  </option>
                ))}
              </select>
              {draft.teamId !== "" && (
                <span className="muted">
                  {assetPriceLabel(builder.data.teams, draft.teamId)}
                </span>
              )}
            </div>
            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}
            {/* .form-actions (barrido P3): en móvil la barra de acciones se
                queda sticky — "Guardar lineup" no cae fuera de pliegue tras
                los 6 selects. */}
            <div className="form-actions">
              <Button
                type="submit"
                disabled={!canSubmit}
                disabledReason={disabledReason}
              >
                {save.isPending ? "Guardando…" : "Guardar lineup"}
              </Button>
              {lineup.data && draftDirty && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={discardDraft}
                >
                  Descartar cambios
                </Button>
              )}
              {/* Borrador NUEVO sin lineup guardado (barrido P3): "Limpiar
                  borrador" vacía el borrador sin cambiar de GP (que exige
                  confirmación). Solo cuando sabemos que no hay guardado. */}
              {lineup.data == null &&
                !lineup.isPending &&
                anySlotFilled(draft) && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={discardDraft}
                  >
                    Limpiar borrador
                  </Button>
                )}
              {/* Wildcard (US-12): la mutación ya existía en el router pero era
                  inalcanzable desde la UI — el servidor incluso la sugería en el
                  error de cambios agotados. Ahora el mensaje es accionable. */}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  gpClosed ||
                  !draftComplete ||
                  !wildcardAvailable ||
                  !draftDirty ||
                  save.isPending ||
                  wildcard.isPending
                }
                disabledReason={wildcardDisabledReason}
                onClick={handleWildcard}
              >
                {wildcard.isPending ? "Aplicando wildcard…" : "Usar wildcard"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {gpId !== "" && history.data != null && (
        <div>
          {/* h2 (F3 P3): sección de primer nivel de la página, al mismo
              nivel que "Lineup — …"; no huérfano bajo otro h2. */}
          <h2>Historial de cambios</h2>
          {/* Capa de ayuda de vocabulario (F3): las entradas del historial se
              explican una sola vez, justo debajo del título. */}
          <p className="muted">
            Alta: un activo entra al lineup. Baja: un activo sale. Cambio: un
            activo entra en lugar de otro. Alta, baja y cambio consumen 1
            cambio cada una. Reasignación oro↔plata: mover un piloto entre oro
            y plata (gratis, no consume cambio). Exención: pase gratuito de
            los cambios de la temporada (cada una concede 1 cambio gratis).
          </p>
          {history.data.length > 0 ? (
            // `.status` (barrido P3): la bitácora usa la lista de estado del
            // sistema, no viñetas por defecto (consistencia con la lista de
            // estado de arriba y con /resultados).
            <ul className="status">
              {history.data.map((change) => {
                const reason = reasonLabel(change.reason);
                return (
                  <li key={change.id}>
                    {changeLabel(change, builder.data ?? null)}
                    {change.costBefore !== null && change.costAfter !== null && (
                      <span className="muted">
                        {" "}
                        (coste {formatNumber(change.costBefore)} → {formatNumber(change.costAfter)})
                      </span>
                    )}
                    {reason !== null && (
                      <span className="muted"> — {reason}</span>
                    )}
                    {/* Fecha (F3 P2-1 + P3): el historial es una bitácora —
                        el cuándo va con el qué, en hora local del usuario
                        (mayoría del sistema: /perfil, /resultados, /admin),
                        con HORA (barrido P3): dos cambios el mismo día se
                        distinguen en la bitácora. */}
                    <span className="muted">
                      {" "}
                      · {change.createdAt.toLocaleString("es-ES", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            // Empty state (F3): la sección no desaparece al vaciarse — se
            // explica. La salida (descartar el borrador) vive en la fila de
            // acciones, junto a "Guardar lineup".
            <p className="muted">Sin cambios todavía en este GP.</p>
          )}
        </div>
      )}

      {/* Confirmaciones con impacto (patrón del sistema, /admin): wildcard y
          cambio de GP/temporada con borrador sin guardar. Nunca
          `window.confirm`: el impacto se lee y la acción se nombra. */}
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
    </div>
  );
}
