"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Button } from "@/shared/components";
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
      setDraft({
        gold: [lineup.data.slots.gold[0] ?? "", lineup.data.slots.gold[1] ?? ""],
        silver: [
          lineup.data.slots.silver[0] ?? "",
          lineup.data.slots.silver[1] ?? "",
        ],
        constructorId: lineup.data.slots.constructorId ?? "",
        teamId: lineup.data.slots.teamId ?? "",
      });
    }
  }, [lineup.data, gpId]);

  const save = trpc.lineups.save.useMutation({
    onSuccess: (result) => {
      const gpName = gps.data?.find((g) => g.id === gpId)?.name ?? "el GP";
      setSuccess(
        `Lineup guardado para ${gpName}. Cambios restantes: ${result.remainingChanges}.`,
      );
      setError(null);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.lineups.get, { gpId }),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo guardar el lineup.");
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
    const ctor = builder.data?.constructors.find(
      (c) => c.id === draft.constructorId,
    );
    if (!ctor || ctor.price === null) return null;
    const team = builder.data?.teams.find((t) => t.id === draft.teamId);
    if (!team || team.price === null) return null;
    return round2(values.reduce((a, b) => a + b, 0) + ctor.price + team.price);
  }, [draft, riders, builder.data]);

  const gpClosed = builder.data
    ? builder.data.gp.status === "locked" ||
      (builder.data.gp.lockoutAt !== null &&
        new Date() >= builder.data.gp.lockoutAt)
    : false;

  const canSubmit =
    gpId !== "" &&
    !gpClosed &&
    !save.isPending &&
    draft.gold[0] !== "" &&
    draft.gold[1] !== "" &&
    draft.silver[0] !== "" &&
    draft.silver[1] !== "" &&
    draft.constructorId !== "" &&
    draft.teamId !== "";

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

  function riderSelect(
    id: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) {
    const taken = [
      draft.gold[0],
      draft.gold[1],
      draft.silver[0],
      draft.silver[1],
    ];
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Piloto —</option>
          {riders.map((r) => {
            const disabled =
              (taken.includes(r.riderId) && value !== r.riderId) ||
              r.price === null;
            return (
              <option key={r.riderId} value={r.riderId} disabled={disabled}>
                {r.name} ({r.teamName})
                {r.price === null ? " — sin precio" : ` — ${r.price}`}
              </option>
            );
          })}
        </select>
      </div>
    );
  }

  if (seasons.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (seasons.isError) {
    return <p className="muted">No se pudo cargar la lista de temporadas.</p>;
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
      {gpId === "" && (
        <p className="muted">Selecciona un GP para componer tu lineup.</p>
      )}

      {gpId !== "" && (builder.isPending || lineup.isPending) && (
        <p className="muted">Consultando…</p>
      )}
      {gpId !== "" && builder.isError && (
        <Alert variant="error">No se pudo cargar el mercado del GP.</Alert>
      )}

      {gpId !== "" && builder.data && (
        <div>
          {gpClosed && (
            <Alert variant="error">
              El GP está cerrado (lockout): no se pueden guardar lineups.
            </Alert>
          )}
          <h2>Lineup — {builder.data.gp.name}</h2>
          <ul className="status">
            <li>
              Presupuesto: <strong>{builder.data.budget.total}</strong>{" "}
              <span className="muted">
                (base {builder.data.budget.base} + carry {builder.data.budget.carry})
              </span>
            </li>
            {lineup.data ? (
              <>
                <li>
                  Coste: <strong>{lineup.data.cost}</strong>
                </li>
                <li>
                  Saldo: <strong>{lineup.data.balance}</strong>
                </li>
                <li>
                  Cambios restantes: <strong>{lineup.data.remainingChanges}</strong>
                </li>
              </>
            ) : (
              <li>
                Coste del borrador:{" "}
                <strong>{draftCost === null ? "—" : draftCost}</strong>
              </li>
            )}
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
                onChange={(e) => setDraft((d) => ({ ...d, constructorId: e.target.value }))}
              >
                <option value="">— Constructor —</option>
                {builder.data.constructors.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.price === null}>
                    {c.name}
                    {c.price === null ? " — sin precio" : ` — ${c.price}`}
                  </option>
                ))}
              </select>
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
                    {t.price === null ? " — sin precio" : ` — ${t.price}`}
                  </option>
                ))}
              </select>
            </div>
            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}
            <Button type="submit" disabled={!canSubmit}>
              {save.isPending ? "Guardando…" : "Guardar lineup"}
            </Button>
          </form>
        </div>
      )}

      {gpId !== "" && history.data && history.data.length > 0 && (
        <div>
          <h3>Historial de cambios</h3>
          <ul>
            {history.data.map((change) => (
              <li key={change.id}>
                {change.type === "wildcard"
                  ? "Wildcard (reset completo)"
                  : change.type === "gold_silver"
                    ? `Reasignación oro↔plata (${change.assetId ?? ""})`
                    : `${change.type} ${change.assetType ?? ""} ${change.assetId ?? ""}`.trim()}
                {change.costBefore !== null && change.costAfter !== null && (
                  <span className="muted">
                    {" "}
                    (coste {change.costBefore} → {change.costAfter})
                  </span>
                )}
                {change.reason && <span className="muted"> — {change.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
