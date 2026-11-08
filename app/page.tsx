"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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
  if (totalMinutes < 1) return "menos de 1 min";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/**
 * Email enmascarado (F3 P3-2): primera letra + dominio, sin el resto de la
 * parte local. Es el email del propio usuario, pero se minimiza la PII visible
 * (AGENTS.md §8, GDPR).
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

/** Etiquetas legibles de rol (F3 P3-2): `global_admin` → "Administrador global". */
const ROLE_LABELS: Record<string, string> = {
  global_admin: "Administrador global",
  user: "Usuario",
};

/**
 * F3 P3-1: `auth.me` falla con UNAUTHORIZED cuando no hay sesión (estado
 * normal de una home pública, NO un fallo), pero también puede fallar por un
 * error real (500, red). Solo el UNAUTHORIZED significa "sin sesión"; el resto
 * es un fallo que hay que mostrar, no enmascarar como "no has iniciado sesión".
 */
function isUnauthorized(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === "UNAUTHORIZED";
}

/** Códigos de error de tRPC (no son mensajes legibles para el usuario). */
const TRPC_CODES = new Set([
  "PARSE_ERROR",
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "UNPROCESSABLE_CONTENT",
  "NOT_FOUND",
  "PRECONDITION_FAILED",
  "METHOD_NOT_SUPPORTED",
  "PAYLOAD_TOO_LARGE",
  "UNEXPECTED_ERROR",
  "INTERNAL_SERVER_ERROR",
]);

/**
 * Mensaje amigable para errores de red/servicio (F3 P3): los códigos de tRPC
 * ("INTERNAL_SERVER_ERROR", "fetch failed"…) no son legibles para el usuario →
 * frase neutra. Los mensajes de la app (en español) se muestran tal cual.
 */
function friendlyMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (!raw || TRPC_CODES.has(raw) || (code !== undefined && TRPC_CODES.has(code))) {
    return "el servidor no pudo responder";
  }
  if (raw === "fetch failed") return "no hay conexión con el servidor";
  return raw;
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
  const queryClient = useQueryClient();
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
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Al cerrar sesión se limpia el caché cliente de `me` (staleTime de
      // TanStack) para que la UI no siga mostrando la sesión anterior.
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
      setLogoutError(null);
    },
    // F3 P2: si el logout falla (red/500) la sesión sigue viva; se avisa y el
    // botón queda reintentable (antes: silencio, la sesión persistía sin feedback).
    // F3 P2: mensaje amigable (no el crudo de tRPC/red), coherente con el resto.
    onError: (error) => setLogoutError(friendlyMessage(error)),
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
              el directorio de ligas ya vive en la nav de «Secciones» — no
              duplicarlo en la primera impresión. */}
          <div className="cta-row">
            <Link className="button" href="/registro">
              Crear cuenta
            </Link>
            <Link className="button-secondary" href="/login">
              Inicia sesión
            </Link>
          </div>
        </>
      )}

      {/* F3 P1: la home anónima vende el producto (valor + cómo funciona), no
          muestra su estado interno. */}
      {anonymous && <AnonymousLanding />}

      {loggedIn && <DashboardSection />}

      {/* F3 P1: navegación cross-page siempre visible (antes solo en la rama
          logueada, bajo el dashboard). Anónimos ven la única sección pública
          (directorio de ligas); logueados, todas. */}
      <h2>Secciones</h2>
      {me.isPending ? (
        <p className="muted pending">Consultando…</p>
      ) : loggedIn ? (
        // F3 P3: landmark de navegación (a11y).
        <nav aria-label="Secciones" className="sections-nav">
          <ul className="status">
            <li>
              <Link href="/lineups">Lineups</Link>
            </li>
            <li>
              <Link href="/mercado">Mercado</Link>
            </li>
            <li>
              <Link href="/puntuacion">Mi puntuación</Link>
            </li>
            <li>
              <Link href="/resultados">Resultados</Link>
            </li>
            <li>
              <Link href="/ligas">Ligas</Link>
            </li>
            <li>
              <Link href="/perfil">Perfil</Link>
            </li>
          </ul>
        </nav>
      ) : (
        <div>
          <nav aria-label="Secciones" className="sections-nav">
            <ul className="status">
              <li>
                <Link href="/ligas">Ligas públicas</Link> — directorio abierto
              </li>
            </ul>
          </nav>
          <p className="muted">
            El resto de secciones (lineups, mercado, puntuación…) requieren una cuenta.
          </p>
        </div>
      )}

      {/* F3 P2: la sección «Sesión» solo se muestra si hay algo que decir:
          sesión activa o fallo real. El anónimo no la necesita — la
          conversión vive en la CTA row (no duplicar). */}
      {!anonymous && (
        <>
          <h2>Sesión</h2>
          {me.isPending ? (
            <p className="muted pending">Consultando…</p>
          ) : me.isError ? (
            // F3 P3-1: fallo real (500, red) → no se enmascara como "sin sesión".
            // (Aquí no puede ser UNAUTHORIZED: ese caso es `anonymous`, oculto.)
            // F3 P2: «reintentar» re-ejecuta la consulta, no navega a /login.
            <Alert variant="error">
              No se pudo verificar la sesión: {friendlyMessage(me.error)}.{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  queryClient.invalidateQueries({
                    queryKey: getQueryKey(trpc.auth.me),
                  })
                }
              >
                Reintentar
              </Button>
            </Alert>
          ) : (
            <div>
              <p>
                Sesión activa: <strong>{me.data.username}</strong> (
                {maskEmail(me.data.email)})
                {me.data.roles.filter((r) => r !== "user").length > 0 && (
                  <span className="muted">
                    {" "}
                    — roles:{" "}
                    {me.data.roles
                      .filter((r) => r !== "user")
                      .map((r) => ROLE_LABELS[r] ?? r)
                      .join(", ")}
                  </span>
                )}
              </p>
              {me.data.roles.includes("global_admin") && (
                <p>
                  <Link href="/admin">Panel de administración</Link>
                </p>
              )}
              {logoutError && (
                <Alert variant="error">No se pudo cerrar sesión: {logoutError}</Alert>
              )}
              {/* F3 P3: acción neutra — un solo relleno primario por región. */}
              <Button
                type="button"
                variant="secondary"
                onClick={() => logout.mutate()}
                disabled={logout.isPending}
              >
                {logout.isPending ? "Cerrando sesión…" : "Cerrar sesión"}
              </Button>
            </div>
          )}
        </>
      )}

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
