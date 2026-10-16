"use client";

import Link from "next/link";

import { trpc } from "@/trpc/client";

import AddRulesVersionForm from "./add-rules-version-form";
import CreateSeasonForm from "./create-season-form";

const STATUS_LABELS: Record<string, string> = {
  planned: "planificada",
  active: "activa",
  finished: "finalizada",
  archived: "archivada",
};

/**
 * Panel de administración global (US-04, flujo 18): temporadas y sus
 * versiones de reglas. Solo `global_admin` ve el contenido; el resto es
 * rechazado server-side (403) — la UI es una vista (AGENTS.md §8).
 */
export default function AdminPage() {
  const me = trpc.auth.me.useQuery();
  const isAdmin = me.data?.roles.includes("global_admin") ?? false;
  const seasons = trpc.seasons.list.useQuery(undefined, { enabled: isAdmin });

  return (
    <main>
      <h1>
        Admin <span>panel</span>
      </h1>
      <p className="muted">
        Temporadas y reglas (US-04). <Link href="/">Volver al inicio</Link>
      </p>

      {me.isPending ? (
        <p className="muted">Consultando…</p>
      ) : me.isError ? (
        <p className="bad">Necesitas iniciar sesión para acceder al panel.</p>
      ) : !isAdmin ? (
        <p className="bad">Solo el administrador global puede acceder a este panel.</p>
      ) : (
        <>
          <h2>Temporadas</h2>
          {seasons.isPending ? (
            <p className="muted">Consultando…</p>
          ) : seasons.isError ? (
            <p className="bad">
              No se pudieron cargar las temporadas: {seasons.error.message}
            </p>
          ) : seasons.data.length === 0 ? (
            <p className="muted">Aún no hay temporadas. Crea la primera abajo.</p>
          ) : (
            <ul className="status">
              {seasons.data.map((season) => (
                <li key={season.id}>
                  <strong>{season.name}</strong> ({season.year}) — estado:{" "}
                  {STATUS_LABELS[season.status] ?? season.status}
                  <ul>
                    {season.rules.map((rule) => (
                      <li key={rule.id}>
                        reglas: <code>{rule.version}</code>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <h2>Crear temporada</h2>
          <CreateSeasonForm onCreated={() => void seasons.refetch()} />

          <h2>Añadir versión de reglas</h2>
          <AddRulesVersionForm
            seasons={seasons.data ?? []}
            onCreated={() => void seasons.refetch()}
          />
        </>
      )}
    </main>
  );
}
