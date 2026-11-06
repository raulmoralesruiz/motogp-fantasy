"use client";

import Link from "next/link";
import { Fragment, Suspense } from "react";

import { selectConsoleSeason } from "@/modules/seasons/season-activity";
import { Alert } from "@/shared/components";
import { trpc } from "@/trpc/client";

import AddRulesVersionForm from "./add-rules-version-form";
import CalendarImportForm from "./calendar-import-form";
import CreateCircuitForm from "./create-circuit-form";
import CreateSeasonForm from "./create-season-form";
import GpsSection from "./gps-section";
import JobsSection from "./jobs-section";
import MarketImportForm from "./market-import-form";
import MarketSection from "./market-section";
import PricesPanel from "./prices-panel";
import ResultsSection from "./results-section";
import { useScrollSpy } from "./use-scroll-spy";

const STATUS_LABELS: Record<string, string> = {
  planned: "planificada",
  active: "activa",
  finished: "finalizada",
  archived: "archivada",
};

/**
 * Grupos de la navegación ancla (DESIGN.md: fases de trabajo, etiquetas
 * de fase que NO son enlaces). El orden de `id` es el orden de la página:
 * el scroll-spy marca la sección en vista con `aria-current="location"`.
 */
const NAV_GROUPS: ReadonlyArray<{
  phase: string;
  items: ReadonlyArray<{ id: string; label: string }>;
}> = [
  {
    phase: "Carrera",
    items: [
      { id: "fin-de-semana", label: "Fin de semana" },
      { id: "resultados", label: "Resultados" },
      { id: "precios", label: "Precios" },
    ],
  },
  { phase: "Mercado", items: [{ id: "mercado", label: "Mercado" }] },
  {
    phase: "Temporada",
    items: [
      { id: "temporadas", label: "Temporadas" },
      { id: "circuitos", label: "Circuitos" },
      { id: "gps", label: "GPs" },
      { id: "calendario", label: "Importar calendario" },
      { id: "importar-mercado", label: "Importar mercado" },
    ],
  },
  { phase: "Sistema", items: [{ id: "jobs-fuentes", label: "Jobs y fuentes" }] },
];

const ANCHOR_SECTION_IDS = NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => item.id),
);

/**
 * Panel de administración global (US-04, US-05, US-06, US-16, flujo 18):
 * temporadas y versiones de reglas; circuitos, GPs (estado, lockout,
 * eventos) e import de calendario en 2 pasos (ADR-0012); mercado (pilotos,
 * constructores, equipos y afiliaciones por GP); importación y cierre de
 * resultados por evento (ADR-0018). Solo `global_admin` ve el contenido; el
 * resto es rechazado server-side (403) — la UI es una vista (AGENTS.md §8).
 *
 * El panel se ordena por fases de trabajo, no por modelo de datos: la
 * consola del fin de semana de carrera y su ritual (resultados → precios)
 * primero, después el mercado, después la configuración de temporada y al
 * final el sistema (jobs y fuentes). Los formularios de alta van colapsados
 * en «Altas y configuración»: el panel prioriza la lectura sobre el CRUD.
 */
export default function AdminPage() {
  const me = trpc.auth.me.useQuery();
  const isAdmin = me.data?.roles.includes("global_admin") ?? false;
  const seasons = trpc.seasons.list.useQuery(undefined, { enabled: isAdmin });
  const circuits = trpc.seasons.circuits.list.useQuery(undefined, {
    enabled: isAdmin,
  });

  // Scroll-spy de la navegación ancla (impeccable P1-2): la sección en
  // vista marca su chip con `aria-current="location"`. `enabled` refleja
  // la rama condicional que monta las secciones: el hook debe re-anudar el
  // observer cuando aparecen, no solo al montar (ver `use-scroll-spy.ts`).
  const activeSection = useScrollSpy(
    ANCHOR_SECTION_IDS,
    !me.isPending && !me.isError && isAdmin,
  );

  // Consola del fin de semana de carrera (impeccable P1-1): opera sobre
  // «la temporada con GPs sin cerrar» (o la más reciente con actividad),
  // NO sobre la más reciente por año — en una BD viva con temporadas de
  // test, la selección ciega dejaba «Siguiente paso» vacío sin motivo.
  // Tres estados escritos: `open` (ritual), `closed` (sin pendientes, con
  // salidas) y `empty` (sin GPs, con salidas).
  const activity = trpc.seasons.activity.useQuery(undefined, {
    enabled: isAdmin,
  });
  const selection = activity.data ? selectConsoleSeason(activity.data) : undefined;
  const consoleSeason =
    selection && selection.kind !== "empty" ? selection.activity : undefined;
  const weekendGps = trpc.seasons.gps.list.useQuery(
    { seasonId: consoleSeason?.seasonId ?? "" },
    { enabled: isAdmin && selection?.kind === "open" },
  );
  const weekendGp = weekendGps.data
    ? [...weekendGps.data]
        .filter(
          (gp) => gp.status !== "cancelled" && new Date(gp.date).getTime() <= Date.now(),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : undefined;
  const weekendState = trpc.results.gpState.useQuery(
    { gpId: weekendGp?.id ?? "" },
    { enabled: Boolean(weekendGp) },
  );

  return (
    <main>
      <h1>
        Panel de <span>administración</span>
      </h1>
      <p className="muted">
        Temporadas, reglas, circuitos, GPs, calendario, mercado y resultados.{" "}
        <Link href="/">Volver al inicio</Link>
      </p>

      {me.isPending ? (
        <p className="muted">Consultando…</p>
      ) : me.isError ? (
        <Alert variant="error">Necesitas iniciar sesión para acceder al panel.</Alert>
      ) : !isAdmin ? (
        <Alert variant="error">
          Solo el administrador global puede acceder a este panel.
        </Alert>
      ) : (
        <>
          <section id="fin-de-semana">
            <div className="card">
              <h2>Fin de semana de carrera</h2>
              {activity.isPending ? (
                <p className="muted">Consultando…</p>
              ) : activity.isError ? (
                <Alert variant="error">
                  No se pudo cargar la actividad de temporadas: {activity.error.message}
                </Alert>
              ) : !selection || selection.kind === "empty" ? (
                <>
                  <p>
                    Todavía no hay GPs en ninguna temporada: no hay fin de
                    semana que gestionar.
                  </p>
                  <p className="muted">
                    Siguiente paso:{" "}
                    <a href="#temporadas">crea la primera temporada</a>,{" "}
                    <a href="#gps">añade sus GPs</a> o{" "}
                    <a href="#calendario">importa el calendario</a>.
                  </p>
                </>
              ) : selection.kind === "closed" ? (
                <>
                  <p>
                    <strong>{selection.activity.name}</strong> está cerrada:
                    sus {selection.activity.totalGps} GPs están finalizados o
                    cancelados — sin pendientes.
                  </p>
                  <p className="muted">
                    Siguiente paso:{" "}
                    <a href="#temporadas">crea la próxima temporada</a> o{" "}
                    <a href="#calendario">importa su calendario</a>.
                  </p>
                </>
              ) : (
                <>
                  <p className="muted">
                    <strong>{selection.activity.name}</strong> —{" "}
                    {selection.activity.openGps === 1
                      ? "1 GP sin cerrar"
                      : `${selection.activity.openGps} GPs sin cerrar`}{" "}
                    de {selection.activity.totalGps}.
                  </p>
                  {weekendGps.isPending ? (
                    <p className="muted">Consultando…</p>
                  ) : weekendGps.isError ? (
                    <Alert variant="error">
                      No se pudieron cargar los GPs: {weekendGps.error.message}
                    </Alert>
                  ) : !weekendGp ? (
                    <p className="muted">
                      {selection.activity.name} aún no tiene GPs disputados.
                      Cuando empiece el fin de semana de carrera, aquí verás
                      su estado y el siguiente paso.
                    </p>
                  ) : weekendState.isPending ? (
                    <p className="muted">Consultando…</p>
                  ) : weekendState.isError ? (
                    <Alert variant="error">
                      No se pudo cargar el estado del GP: {weekendState.error.message}
                    </Alert>
                  ) : (
                    <p>
                      Último GP disputado:{" "}
                      <strong>
                        R{weekendGp.round} · {weekendGp.name}
                      </strong>{" "}
                      —{" "}
                      {weekendState.data.definitive
                        ? `cerrado${
                            weekendState.data.resultsVersion
                              ? ` (${weekendState.data.resultsVersion})`
                              : ""
                          }, los lineups ya puntúan`
                        : weekendState.data.totalResults === 0
                          ? "sin resultados importados"
                          : `resultados provisionales (${weekendState.data.counts.provisional} provisional(es), ${weekendState.data.counts.corrected} corregida(s))`}
                      . <strong>Siguiente paso:</strong>{" "}
                      {weekendState.data.definitive
                        ? "revisa los precios del próximo GP en el paso 3 del panel de Precios."
                        : weekendState.data.totalResults === 0
                          ? "importa los resultados en el paso 1 del ritual de Resultados."
                          : "revísalos y márcalos definitivos en el paso 3 del ritual de Resultados."}{" "}
                      {weekendState.data.definitive ? (
                        <a href="#precios">Ir a Precios</a>
                      ) : (
                        // Handoff consola → ritual (adapt): el enlace lleva el
                        // contexto (?season=&gp=) y el ritual lo prellena al
                        // navegar, en vez de solo hacer scroll a la sección.
                        <Link
                          href={`/admin?season=${selection.activity.seasonId}&gp=${weekendGp.id}#resultados`}
                        >
                          Ir a Resultados
                        </Link>
                      )}
                    </p>
                  )}
                  {/* Ayuda de vocabulario (impeccable P1): rv-N aparece aquí
                      por primera vez en el panel; se define en su primera
                      aparición, no solo dentro de los diálogos. */}
                  <p className="muted">
                    rv-N = versión de resultados del GP: cada recálculo auditable
                    genera una nueva y conserva el histórico.
                  </p>
                </>
              )}
            </div>
          </section>

          <nav className="anchor-nav" aria-label="Secciones del panel de administración">
            <ul>
              {NAV_GROUPS.map((group) => (
                <Fragment key={group.phase}>
                  <li className="anchor-phase">{group.phase}</li>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        aria-current={
                          activeSection === item.id ? "location" : undefined
                        }
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </Fragment>
              ))}
            </ul>
          </nav>

          <section id="resultados">
            <div className="card">
              <h2>Resultados</h2>
              {/* useSearchParams (handoff consola → ritual) exige un límite
                  de Suspense en el prerender (Next 15). */}
              <Suspense fallback={<p className="muted">Consultando…</p>}>
                <ResultsSection seasons={seasons.data ?? []} />
              </Suspense>
            </div>
          </section>

          <section id="precios">
            <div className="card">
              <h2>Precios</h2>
              <PricesPanel />
            </div>
          </section>

          <section id="mercado">
            <div className="card">
              <h2>Mercado</h2>
              <MarketSection seasons={seasons.data ?? []} />
            </div>
          </section>

          <section id="temporadas">
            <div className="card">
              <h2>Temporadas</h2>
              {seasons.isPending ? (
                <p className="muted">Consultando…</p>
              ) : seasons.isError ? (
                <Alert variant="error">
                  No se pudieron cargar las temporadas: {seasons.error.message}
                </Alert>
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
            </div>

            <details className="form-collapse">
              <summary>Altas y configuración de temporadas</summary>
              {/* Ayuda de vocabulario (impeccable P1): B/t/cmax y
                  pmaxRider/pmaxGroup solo existen en el JSON de estas dos
                  formas; se explican una sola vez, en su primera aparición. */}
              <p className="muted">
                Reglas (JSON): presupuesto por GP = <code>B</code> (base) +
                carry limitado (<code>t</code> × sin usar, tope <code>cmax</code>);
                Pmax (<code>pmaxRider</code>/<code>pmaxGroup</code>) = puntuación
                máxima de referencia de la fórmula de precios. Fuente de verdad:{" "}
                <code>docs/product/economy.md</code> y{" "}
                <code>docs/product/scoring.md</code>.
              </p>
              <div className="card">
                <h2>Crear temporada</h2>
                <CreateSeasonForm onCreated={() => void seasons.refetch()} />
              </div>

              <div className="card">
                <h2>Añadir versión de reglas</h2>
                <AddRulesVersionForm
                  seasons={seasons.data ?? []}
                  onCreated={() => void seasons.refetch()}
                />
              </div>
            </details>
          </section>

          <section id="circuitos">
            <div className="card">
              <h2>Circuitos</h2>
              {circuits.isPending ? (
                <p className="muted">Consultando…</p>
              ) : circuits.isError ? (
                <Alert variant="error">
                  No se pudieron cargar los circuitos: {circuits.error.message}
                </Alert>
              ) : circuits.data.length === 0 ? (
                <p className="muted">Aún no hay circuitos. Crea el primero abajo.</p>
              ) : (
                <ul className="status">
                  {circuits.data.map((circuit) => (
                    <li key={circuit.id}>
                      <strong>{circuit.name}</strong> ({circuit.country})
                      {circuit.location ? ` — ${circuit.location}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <details className="form-collapse">
              <summary>Altas y configuración de circuitos</summary>
              <div className="card">
                <h2>Crear circuito</h2>
                <CreateCircuitForm onCreated={() => void circuits.refetch()} />
              </div>
            </details>
          </section>

          <section id="gps">
            <div className="card">
              <h2>GPs</h2>
              <GpsSection seasons={seasons.data ?? []} circuits={circuits.data ?? []} />
            </div>
          </section>

          <section id="calendario">
            <div className="card">
              <h2>Importar calendario</h2>
              <CalendarImportForm
                seasons={seasons.data ?? []}
                onImported={() => {
                  void seasons.refetch();
                  void circuits.refetch();
                }}
              />
            </div>
          </section>

          <section id="importar-mercado">
            <div className="card">
              <h2>Importar mercado</h2>
              <MarketImportForm
                seasons={seasons.data ?? []}
                onImported={() => {
                  void seasons.refetch();
                }}
              />
            </div>
          </section>

          <section id="jobs-fuentes">
            <div className="card">
              <h2>Jobs y fuentes</h2>
              <p className="muted">
                Estado de los jobs de fondo y de la fuente de datos: colas,
                alertas activas, health-check de PulseLive y Sentry.
              </p>
              <JobsSection />
            </div>
          </section>
        </>
      )}
    </main>
  );
}
