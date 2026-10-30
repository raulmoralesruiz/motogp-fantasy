"use client";

import { useState } from "react";

import type { RiderView, TeamView } from "@/modules/market";
import type { SeasonWithRules } from "@/modules/seasons";
import { Button } from "@/shared/components";
import { trpc } from "@/trpc/client";

interface AffiliationsPanelProps {
  riders: RiderView[];
  teams: TeamView[];
  seasons: SeasonWithRules[];
}

/**
 * Panel de afiliaciones por GP (US-06, ADR-0013, flujo 18):
 * - "Asignar desde este GP": rellena ese GP y todos los GPs siguientes de
 *   la misma temporada que no tengan afiliación; salta y reporta los
 *   existentes y nunca toca los GPs anteriores.
 * - "Asignar para este GP": ajuste fino de un GP concreto (reemplaza la
 *   afiliación existente).
 * El constructor siempre se deriva del equipo en el servidor (invariante
 * 5): el cliente nunca lo envía.
 */
export default function AffiliationsPanel({
  riders,
  teams,
  seasons,
}: AffiliationsPanelProps) {
  const [seasonId, setSeasonId] = useState("");
  const [riderId, setRiderId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [gpId, setGpId] = useState("");

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, {
    enabled: seasonId !== "",
  });
  const riderDetail = trpc.market.riders.get.useQuery({ riderId }, {
    enabled: riderId !== "",
  });

  const setFrom = trpc.market.affiliations.setFrom.useMutation({
    onSuccess: () => void riderDetail.refetch(),
  });
  const set = trpc.market.affiliations.set.useMutation({
    onSuccess: () => void riderDetail.refetch(),
  });

  const busy = setFrom.isPending || set.isPending;
  const canAssign = riderId !== "" && teamId !== "" && gpId !== "";

  function onSeasonChange(value: string) {
    setSeasonId(value);
    setGpId("");
  }

  return (
    <section>
      <h3>Afiliaciones por GP</h3>
      <p className="muted">
        «Asignar desde este GP» rellena ese GP y los siguientes de la
        temporada sin afiliación (los existentes se saltan; los anteriores
        nunca se tocan). «Asignar para este GP» ajusta un GP concreto
        (reemplaza la afiliación existente).
      </p>

      <div className="field">
        <label htmlFor="affSeasonId">Temporada</label>
        <select
          id="affSeasonId"
          value={seasonId}
          onChange={(event) => onSeasonChange(event.target.value)}
        >
          <option value="">— Elige una temporada —</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name} ({season.year})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="affRiderId">Piloto</label>
        <select
          id="affRiderId"
          value={riderId}
          onChange={(event) => setRiderId(event.target.value)}
        >
          <option value="">— Elige un piloto —</option>
          {riders.map((rider) => (
            <option key={rider.id} value={rider.id}>
              {rider.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="affTeamId">Equipo</label>
        <select
          id="affTeamId"
          value={teamId}
          onChange={(event) => setTeamId(event.target.value)}
        >
          <option value="">— Elige un equipo —</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.constructorName})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="affGpId">GP</label>
        <select
          id="affGpId"
          value={gpId}
          onChange={(event) => setGpId(event.target.value)}
          disabled={seasonId === ""}
        >
          <option value="">
            {seasonId === ""
              ? "Elige primero una temporada"
              : "— Elige un GP —"}
          </option>
          {gps.data?.map((gp) => (
            <option key={gp.id} value={gp.id}>
              Ronda {gp.round} — {gp.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Button
          type="button"
          disabled={!canAssign || busy}
          onClick={() => setFrom.mutate({ riderId, teamId, fromGpId: gpId })}
        >
          {setFrom.isPending ? "Asignando…" : "Asignar desde este GP"}
        </Button>{" "}
        <Button
          type="button"
          disabled={!canAssign || busy}
          onClick={() => set.mutate({ riderId, teamId, gpId })}
        >
          {set.isPending ? "Asignando…" : "Asignar para este GP"}
        </Button>
      </div>

      {setFrom.isError && (
        <p className="bad">No se pudo asignar: {setFrom.error.message}</p>
      )}
      {set.isError && (
        <p className="bad">No se pudo asignar: {set.error.message}</p>
      )}
      {setFrom.isSuccess && (
        <>
          <p className="ok">
            Aplicado desde el GP elegido: {setFrom.data.created}{" "}
            {setFrom.data.created === 1 ? "afiliación creada" : "afiliaciones creadas"}
            {setFrom.data.skipped.length > 0
              ? `, ${setFrom.data.skipped.length} ${
                  setFrom.data.skipped.length === 1 ? "saltada" : "saltadas"
                }`
              : ""}
            .
          </p>
          {setFrom.data.skipped.length > 0 && (
            <ul className="status">
              {setFrom.data.skipped.map((item) => (
                <li key={item.gpId}>{item.reason}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {set.isSuccess && (
        <p className="ok">
          {set.data.changed
            ? "Afiliación asignada para el GP."
            : "El piloto ya tenía esa afiliación para el GP (sin cambios)."}
        </p>
      )}

      {riderId !== "" && (
        <>
          <h4>Afiliaciones actuales</h4>
          {riderDetail.isPending ? (
            <p className="muted">Consultando…</p>
          ) : riderDetail.isError ? (
            <p className="bad">
              No se pudieron cargar las afiliaciones: {riderDetail.error.message}
            </p>
          ) : riderDetail.data.affiliations.length === 0 ? (
            <p className="muted">Este piloto aún no tiene afiliaciones.</p>
          ) : (
            <ul className="status">
              {riderDetail.data.affiliations.map((affiliation) => (
                <li key={affiliation.id}>
                  Ronda {affiliation.gp.round} — {affiliation.gp.name}:{" "}
                  <strong>{affiliation.team.name}</strong> (
                  {affiliation.manufacturer.name})
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
