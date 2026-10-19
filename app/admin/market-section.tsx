"use client";

import type { SeasonWithRules } from "@/modules/seasons";
import { trpc } from "@/trpc/client";

import AffiliationsPanel from "./affiliations-panel";
import CreateConstructorForm from "./create-constructor-form";
import CreateRiderForm from "./create-rider-form";
import CreateTeamForm from "./create-team-form";
import PricesPanel from "./prices-panel";

interface MarketSectionProps {
  seasons: SeasonWithRules[];
}

/**
 * Sección de mercado (US-06/US-07, flujo 18): pilotos, constructores y
 * equipos (creación idempotente por nombre), afiliaciones por GP («desde
 * este GP» y «para este GP», ADR-0013) y precios de apertura P0 con
 * histórico (ADR-0014). Constructor y equipo son activos distintos, nunca
 * intercambiables (invariante 5).
 */
export default function MarketSection({ seasons }: MarketSectionProps) {
  const riders = trpc.market.riders.list.useQuery();
  const constructors = trpc.market.constructors.list.useQuery();
  const teams = trpc.market.teams.list.useQuery();

  function refetchAll() {
    void riders.refetch();
    void constructors.refetch();
    void teams.refetch();
  }

  return (
    <section>
      <h3>Pilotos</h3>
      {riders.isPending ? (
        <p className="muted">Consultando…</p>
      ) : riders.isError ? (
        <p className="bad">No se pudieron cargar los pilotos: {riders.error.message}</p>
      ) : riders.data.length === 0 ? (
        <p className="muted">Aún no hay pilotos. Crea el primero abajo.</p>
      ) : (
        <ul className="status">
          {riders.data.map((rider) => (
            <li key={rider.id}>
              <strong>{rider.name}</strong>
              {rider.number !== null ? ` (#${rider.number})` : ""}
              {rider.isActive ? "" : " — inactivo"}
            </li>
          ))}
        </ul>
      )}
      <CreateRiderForm onCreated={refetchAll} />

      <h3>Constructores</h3>
      {constructors.isPending ? (
        <p className="muted">Consultando…</p>
      ) : constructors.isError ? (
        <p className="bad">
          No se pudieron cargar los constructores: {constructors.error.message}
        </p>
      ) : constructors.data.length === 0 ? (
        <p className="muted">Aún no hay constructores. Crea el primero abajo.</p>
      ) : (
        <ul className="status">
          {constructors.data.map((constructor) => (
            <li key={constructor.id}>
              <strong>{constructor.name}</strong>
            </li>
          ))}
        </ul>
      )}
      <CreateConstructorForm onCreated={refetchAll} />

      <h3>Equipos</h3>
      {teams.isPending ? (
        <p className="muted">Consultando…</p>
      ) : teams.isError ? (
        <p className="bad">No se pudieron cargar los equipos: {teams.error.message}</p>
      ) : teams.data.length === 0 ? (
        <p className="muted">Aún no hay equipos. Crea el primero abajo.</p>
      ) : (
        <ul className="status">
          {teams.data.map((team) => (
            <li key={team.id}>
              <strong>{team.name}</strong> — constructor: {team.constructorName}
            </li>
          ))}
        </ul>
      )}
      <CreateTeamForm constructors={constructors.data ?? []} onCreated={refetchAll} />

      <AffiliationsPanel
        riders={riders.data ?? []}
        teams={teams.data ?? []}
        seasons={seasons}
      />

      <PricesPanel />
    </section>
  );
}
