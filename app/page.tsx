"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alert } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { friendlyMessage, isUnauthorized } from "@/trpc/errors";

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
  if (totalMinutes < 1) return "menos de 1 min";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

// `isUnauthorized`/`friendlyMessage` (F3 P3-1/P3) viven en `@/trpc/errors`
// (T-26: centralizados; el header global es su 4.º usuario).

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
  // F3 P1: `closed` lo evalúa el servidor (gate US-13) y la cuenta atrás corre
  // en el cliente; sin refetch, pasado el lockout la home seguiría mostrando la
  // CTA activa con el dato stale. Se reconsulta cada 30 s (mismo tick que
  // `CountdownTo`) para que `closed` y las CTAs se actualicen.
  const dashboard = trpc.dashboard.get.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  if (dashboard.isPending) {
    return <p className="muted pending">Consultando…</p>;
  }
  if (dashboard.isError) {
    return (
      <Alert variant="error">
        No se pudo cargar el dashboard: {friendlyMessage(dashboard.error)}
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

      {/* F3 P1: h2 intermedio — sin la rejilla, la jerarquía saltaba de h1 a h3. */}
      <h2>Tu temporada</h2>
      <div className="dashboard-grid">
        {/* Próximo GP (con cuenta atrás a lockout). */}
        <div className="card">
          <h3>Próximo GP</h3>
          {d.nextGp ? (
            <>
              <ul className="status">
                <li>
                  <strong>
                    GP {d.nextGp.round} · {d.nextGp.name}
                  </strong>
                </li>
                <li>
                  {d.nextGp.circuit.name} ({d.nextGp.circuit.country})
                </li>
                <li>{formatDate(d.nextGp.date)}</li>
                {d.nextGp.closed ? (
                  // F3 P1: el cierre es un estado esperado, no un fallo →
                  // atención neutra (ámbar), coherente con el aviso de lockout.
                  <li className="warn">Cambios cerrados</li>
                ) : d.nextGp.lockoutAt !== null ? (
                  <li>
                    Cierra en <CountdownTo target={d.nextGp.lockoutAt} />
                  </li>
                ) : (
                  <li className="muted">Sin fecha de cierre</li>
                )}
              </ul>
              {/* F3 P1: con lockout el servidor rechaza guardar (US-13) → la CTA
                  de composición se convierte en vista de solo lectura. */}
              {d.nextGp.closed ? (
                d.lineup ? (
                  <Link className="cta" href="/lineups">
                    Ver mi lineup
                  </Link>
                ) : (
                  // F3 P3: cierre sin lineup → orientar a lo accionable (ver
                  // resultados); /lineups no permite editar ese GP cerrado.
                  <p className="muted">
                    El cierre de cambios ya pasó y no hay lineup guardado para este GP.{" "}
                    <Link href="/resultados">Ver resultados</Link>
                  </p>
                )
              ) : (
                <Link className="cta" href="/lineups">
                  {d.lineup ? "Editar mi lineup" : "Componer mi lineup"}
                </Link>
              )}
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
              <ul className="status">
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
                    {/* F3 P3: el saldo solo se colorea cuando es negativo
                        (señal negativa); un saldo positivo es neutro, no un logro. */}
                    <li>
                      Saldo:{" "}
                      <strong className={d.lineup.balance < 0 ? "bad" : undefined}>
                        {d.lineup.balance}
                      </strong>
                    </li>
                    <li>
                      Cambios restantes: <strong>{d.lineup.remainingChanges}</strong>
                    </li>
                  </>
                ) : (
                  <li className="muted">Aún no has guardado tu lineup.</li>
                )}
              </ul>
              {/* F3 P3: sin lineup la CTA de acción vive en «Próximo GP»
                  («Componer mi lineup») — antes había doble CTA a /lineups. */}
            </>
          ) : (
            <p className="muted">Sin próximo GP: presupuesto no disponible.</p>
          )}
        </div>

        {/* Posición en cada liga (US-21 pendiente → vacío elegante). */}
        <div className="card">
          <h3>Mis ligas</h3>
          {d.leagues.length === 0 ? (
            // F3 P2: empty state con salida (antes: sin ningún enlace).
            // F3 P3: misma etiqueta que la CTA y la nav («Ligas públicas»).
            <p className="muted">
              Aún no formas parte de ninguna liga.{" "}
              <Link href="/ligas">Ligas públicas</Link>
            </p>
          ) : (
            <ul className="status">
              {d.leagues.map((league) => (
                <li key={league.leagueId}>
                  <strong>
                    <Link href={`/ligas/${league.leagueId}`}>{league.leagueName}</Link>
                  </strong>
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
                    <span className="muted">Sin posiciones aún</span>
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

/**
 * Landing para visitantes anónimos (F3 P1): la home pública vende el producto,
 * no muestra su estado interno. Bloque de valor (qué lo diferencia) + cómo
 * funciona (3 pasos). La CTA de conversión ya vive arriba, bajo el tagline.
 */
function AnonymousLanding() {
  return (
    <div>
      <h2>¿Por qué este fantasy?</h2>
      <div className="dashboard-grid">
        <div className="card">
          <h3>Economía justa</h3>
          <p className="muted">
            Presupuesto base fijo más un bonus limitado de lo que no gastaste. Sin
            penalizaciones: tu ventaja no depende del valor de mercado del equipo.
          </p>
        </div>
        <div className="card">
          <h3>Multi-liga</h3>
          <p className="muted">
            Compite en varias ligas a la vez. Tus puntos por GP son los mismos en todas;
            solo cambia el ranking de cada una.
          </p>
        </div>
        <div className="card">
          <h3>Transparente</h3>
          <p className="muted">
            Reglas versionadas, precios con fórmula auditada y resultados que se corrigen
            sin borrar el histórico.
          </p>
        </div>
      </div>

      <h2>Cómo funciona</h2>
      <ol className="steps">
        <li>
          <strong>Crea tu cuenta</strong> — gratis, en un minuto.
        </li>
        <li>
          <strong>Monta tu lineup</strong> — 2 oro + 2 plata + constructor + equipo,
          dentro de tu presupuesto.
        </li>
        <li>
          <strong>Gana GP a GP</strong> — puntúa carrera a carrera y escala en tus ligas.
        </li>
      </ol>
    </div>
  );
}

export default function HomePage() {
  // F3 P2: sin sesión `auth.me` lanza UNAUTHORIZED (estado normal de una home
  // pública); no tiene sentido reintentarlo (antes: 4×401 por visita anónima).
  const me = trpc.auth.me.useQuery(undefined, {
    retry: (count, error) => (isUnauthorized(error) ? false : count < 2),
  });

  // F3 P1: la home pública distingue anónimo (UNAUTHORIZED) de fallo real.
  const meData = me.data;
  const loggedIn = meData !== undefined;
  const anonymous = me.isError && isUnauthorized(me.error);
  // F3 P2: el estado operativo (BD/Redis/versión) es información de
  // administración — solo un global_admin lo consulta y lo ve.
  const isAdmin = meData?.roles.includes("global_admin") ?? false;

  // F3 P3: página abierta → el estado no debe quedarse stale (60 s).
  const health = trpc.health.check.useQuery(undefined, {
    refetchInterval: 60_000,
    enabled: isAdmin,
  });
  return (
    <main>
      {meData ? (
        // F3 P1: el jugador que vuelve ve su contexto (saludo), no el discurso
        // de venta de la landing. El hero de marca es solo para la landing pública.
        <>
          <h1 className="hero-title">Hola, {meData.username}</h1>
          <p className="muted">Fantasy MotoGP Independiente</p>
        </>
      ) : (
        // Hero de marca + CTA de conversión para la landing pública. Se pinta en
        // el primer paint (incluso con la sesión pendiente): la landing no debe
        // esperar a la consulta para ofrecer su acción principal.
        <>
          <h1 className="hero-title">
            Fantasy MotoGP <span>Independiente</span>
          </h1>
          <p className="muted hero-tagline">
            Fantasy de MotoGP propio y multi-liga, con una economía diseñada para ser
            justa y transparente: presupuesto base fijo + un bonus limitado de lo que no
            gastaste, sin penalizaciones.
          </p>
          {/* F3 P2: dos CTAs de conversión (crear cuenta / iniciar sesión);
              la navegación a secciones vive en la cabecera global (T-26) —
              no duplicarla en la primera impresión. */}
          <div className="cta-row">
            <Link className="button" href="/registro">
              Crear cuenta
            </Link>
            {/* Infinitivo (estándar de etiqueta UI): igual que la cabecera
                global (T-26) y la página de login — una acción, una forma. */}
            <Link className="button-secondary" href="/login">
              Iniciar sesión
            </Link>
          </div>
        </>
      )}

      {/* F3 P1: la home anónima vende el producto (valor + cómo funciona), no
          muestra su estado interno. */}
      {anonymous && <AnonymousLanding />}

      {loggedIn && <DashboardSection />}

      {/* T-26: la navegación cross-page («Secciones») y la sesión
          (username, logout, reintentar) viven en la cabecera global —
          una sola vez, en todas las páginas. */}

      {/* F3 P2: el estado operativo (BD/Redis/versión) es información de
          administración — solo lo ve un global_admin (antes: todo logueado). */}
      {isAdmin && (
        <>
          <h2>Estado del sistema</h2>
          {health.isPending ? (
            <p className="muted pending">Consultando…</p>
          ) : health.isError ? (
            <Alert variant="error">
              No se pudo consultar el estado: {friendlyMessage(health.error)}
            </Alert>
          ) : (
            <ul className="status">
              <li>
                Aplicación: <strong>{health.data.app.name}</strong> v
                {health.data.app.version} —{" "}
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
        </>
      )}
    </main>
  );
}
