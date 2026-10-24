"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Button } from "@/shared/components";
import { trpc } from "@/trpc/client";

/** Fecha legible en español (domingo 1 de junio de 2026). */
function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Cuenta atrás legible: «3 d 4 h», «4 h 10 min» o «10 min». */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "ahora mismo";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/**
 * Cuenta atrás a una fecha objetivo (US-15): la fecha la aporta el servidor
 * (AGENTS.md §8); el cliente solo refresca la vista cada 30 s.
 */
function CountdownTo({ target }: { target: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <>{formatCountdown(target.getTime() - now)}</>;
}

/**
 * Dashboard (US-15): próximo GP con cuenta atrás a lockout, presupuesto
 * disponible, coste del lineup, posición en cada liga y avisos (recálculo,
 * lockout). Todo lo calcula el servidor (presupuesto/coste con la misma
 * fórmula que valida `lineups`; gate de lockout de US-13).
 */
function DashboardSection() {
  const dashboard = trpc.dashboard.get.useQuery();

  if (dashboard.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (dashboard.isError) {
    return (
      <Alert variant="error">
        No se pudo cargar el dashboard: {dashboard.error.message}
      </Alert>
    );
  }

  const d = dashboard.data;

  return (
    <div>
      {d.notices.length > 0 && (
        <div>
          <h2>Avisos</h2>
          <div className="alerts">
            {d.notices.map((notice) => (
              <Alert key={`${notice.kind}:${notice.gpId}`} variant={notice.severity}>
                {notice.message}
              </Alert>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        {/* Próximo GP (con cuenta atrás a lockout). */}
        <div className="card">
          <h3>Próximo GP</h3>
          {d.nextGp ? (
            <>
              <ul>
                <li>
                  <strong>
                    J{d.nextGp.round} · {d.nextGp.name}
                  </strong>
                </li>
                <li>
                  {d.nextGp.circuit.name} ({d.nextGp.circuit.country})
                </li>
                <li>{formatDate(d.nextGp.date)}</li>
                {d.nextGp.closed ? (
                  <li className="bad">Cerrado (lockout)</li>
                ) : d.nextGp.lockoutAt !== null ? (
                  <li>
                    Cierra en <CountdownTo target={d.nextGp.lockoutAt} />
                  </li>
                ) : (
                  <li className="muted">Sin lockout fijado</li>
                )}
              </ul>
              <Link className="cta" href="/lineups">
                Componer mi lineup
              </Link>
            </>
          ) : (
            <p className="muted">
              {d.season
                ? "No hay próximos GPs programados en la temporada."
                : "Aún no hay temporadas."}
            </p>
          )}
        </div>

        {/* Presupuesto disponible + coste del lineup (US-10). */}
        <div className="card">
          <h3>Presupuesto y lineup</h3>
          {d.nextGp ? (
            <>
              <ul>
                <li>
                  Presupuesto: <strong>{d.budget ? d.budget.total : "—"}</strong>{" "}
                  <span className="muted">
                    (base {d.budget ? d.budget.base : "—"} + carry{" "}
                    {d.budget ? d.budget.carry : "—"})
                  </span>
                </li>
                {d.lineup ? (
                  <>
                    <li>
                      Coste: <strong>{d.lineup.cost}</strong>
                    </li>
                    <li>
                      Saldo: <strong>{d.lineup.balance}</strong>
                    </li>
                    <li>
                      Cambios restantes:{" "}
                      <strong>{d.lineup.remainingChanges}</strong>
                    </li>
                  </>
                ) : (
                  <li className="muted">Aún no has guardado tu lineup.</li>
                )}
              </ul>
              {!d.lineup && (
                <Link className="cta" href="/lineups">
                  Guardar mi lineup
                </Link>
              )}
            </>
          ) : (
            <p className="muted">Sin próximo GP: presupuesto no disponible.</p>
          )}
        </div>

        {/* Posición en cada liga (US-21 pendiente → vacío elegante). */}
        <div className="card">
          <h3>Mis ligas</h3>
          {d.leagues.length === 0 ? (
            <p className="muted">Aún no formas parte de ninguna liga.</p>
          ) : (
            <ul>
              {d.leagues.map((league) => (
                <li key={league.leagueId}>
                  <strong>{league.leagueName}</strong>
                  {league.gpPosition !== null || league.overallPosition !== null ? (
                    <ul>
                      {league.gpPosition !== null && (
                        <li>
                          GP: posición {league.gpPosition} ({league.gpPoints} pts)
                        </li>
                      )}
                      {league.overallPosition !== null && (
                        <li>
                          General: posición {league.overallPosition} (
                          {league.overallPoints} pts)
                        </li>
                      )}
                    </ul>
                  ) : (
                    <span className="muted"> — sin posiciones aún</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const health = trpc.health.check.useQuery();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Al cerrar sesión se limpia el caché cliente de `me` (staleTime de
      // TanStack) para que la UI no siga mostrando la sesión anterior.
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
      router.refresh();
    },
  });

  // Dashboard (US-15): solo cuando hay sesión (el resto es público).
  const loggedIn = me.data !== undefined;

  return (
    <main>
      <h1>
        Fantasy MotoGP <span>Independiente</span>
      </h1>
      <p className="muted">
        Fantasy de MotoGP propio y multi-liga, con una economía diseñada para ser justa y
        transparente: base fija + carry limitado, sin ratchet.
      </p>

      {loggedIn && <DashboardSection />}

      <h2>Sesión</h2>
      {me.isPending ? (
        <p className="muted">Consultando…</p>
      ) : me.isError ? (
        <p className="muted">
          No has iniciado sesión. <Link href="/login">Inicia sesión</Link> o{" "}
          <Link href="/registro">crea una cuenta</Link>.
        </p>
      ) : (
        <div>
          <p>
            Sesión activa: <strong>{me.data.username}</strong> ({me.data.email})
            {me.data.roles.length > 0 && (
              <span className="muted"> — roles: {me.data.roles.join(", ")}</span>
            )}
          </p>
          {me.data.roles.includes("global_admin") && (
            <p>
              <Link href="/admin">Panel de administración</Link>
            </p>
          )}
          <p>
            <Link href="/lineups">Lineups</Link>
          </p>
          <p>
            <Link href="/mercado">Mercado</Link>
          </p>
          <p>
            <Link href="/perfil">Perfil</Link>
          </p>
          <Button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Cerrando sesión…" : "Cerrar sesión"}
          </Button>
        </div>
      )}

      <h2>Estado del sistema</h2>
      {health.isPending ? (
        <p className="muted">Consultando…</p>
      ) : health.isError ? (
        <p className="bad">No se pudo consultar el estado: {health.error.message}</p>
      ) : (
        <ul className="status">
          <li>
            Aplicación: <strong>{health.data.app.name}</strong> v{health.data.app.version}{" "}
            —{" "}
            <span className={health.data.status === "ok" ? "ok" : "bad"}>
              {health.data.status === "ok" ? "operativa" : "degradada"}
            </span>
          </li>
          <li>
            Base de datos:{" "}
            <span className={health.data.database.ok ? "ok" : "bad"}>
              {health.data.database.ok ? "conectada" : "sin conexión"}
            </span>
          </li>
          <li>
            Redis:{" "}
            <span className={health.data.redis.ok ? "ok" : "bad"}>
              {health.data.redis.ok ? "conectado" : "sin conexión"}
            </span>
          </li>
        </ul>
      )}
    </main>
  );
}
