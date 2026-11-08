"use client";

import { useEffect, useState } from "react";

import { Alert, RowAction } from "@/shared/components";
import { formatNumber } from "@/shared/format";
import { trpc } from "@/trpc/client";

/** Tipo de activo (misma enumeración que `AssetType` en `shared/validation/market`). */
type AssetType = "rider" | "constructor" | "team";

/** Tendencia de precio (misma enumeración que `PriceTrend` en `modules/market`). */
type PriceTrend = "up" | "down" | "flat";

/** Punto del gráfico de histórico (P0 o ronda de GP). */
interface ChartPoint {
  label: string;
  price: number;
}

/**
 * Validación local del filtro de precio (el servidor revalida con Zod —
 * AGENTS.md §8). Vacío → sin filtro; valor no vacío inválido → error local
 * y el filtro NO se envía.
 *
 * Acepta el separador decimal español: "17,4" → 17.4 (la UI es en español,
 * AGENTS.md §2; el display usa `formatNumber` con coma).
 */
function parsePriceFilter(
  value: string,
  label: string,
): {
  number?: number;
  error?: string;
} {
  if (value.trim() === "") return {};
  const n = Number(value.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) {
    return { error: `${label}: introduce un número válido (usa coma para decimales, p. ej. 17,4).` };
  }
  if (n > 9999.99) {
    return { error: `${label}: el precio no puede superar ${formatNumber(9999.99)}.` };
  }
  if (Number(n.toFixed(2)) !== n) {
    return { error: `${label}: máximo 2 decimales (p. ej. 17,45).` };
  }
  return { number: n };
}

const TREND_LABEL: Record<PriceTrend, string> = {
  up: "Sube",
  down: "Baja",
  flat: "Estable",
};

/** Variación con signo (+2,6 / −1,5), sin ceros finales innecesarios. */
function formatDelta(delta: number): string {
  const value = formatNumber(Math.abs(delta));
  return delta > 0 ? `+${value}` : `−${value}`;
}

/**
 * Tendencia sube/baja/estable con color (verde/rojo/gris) y — si hay punto
 * anterior — la variación (Δ) junto a la etiqueta: dirección + magnitud es
 * el dato de decisión (F3, crítica /mercado). Sin Δ no se añade nada.
 */
function TrendBadge({
  trend,
  delta,
}: {
  trend: PriceTrend;
  delta?: number | null;
}) {
  const className = trend === "up" ? "ok" : trend === "down" ? "bad" : "muted";
  return (
    <span className={className}>
      {TREND_LABEL[trend]}
      {delta !== null && delta !== undefined && delta !== 0 && (
        <> {formatDelta(delta)}</>
      )}
    </span>
  );
}

/**
 * Mini-histórico (sparkline) del activo en la lista: 0 puntos → "—",
 * 1 punto → punto, ≥2 → línea. SVG a mano alzada (cero dependencias).
 */
function Sparkline({
  points,
}: {
  points: Array<{ label: string; price: number }>;
}) {
  if (points.length === 0) return <span className="muted">—</span>;
  const width = 96;
  const height = 24;
  const values = points.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const x = (i: number) =>
    points.length === 1 ? width / 2 : 2 + (i / (points.length - 1)) * (width - 4);
  const y = (price: number) =>
    span === 0 ? height / 2 : height - 2 - ((price - min) / span) * (height - 4);
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Mini-histórico: ${points
        .map((p) => `${p.label} ${formatNumber(p.price)}`)
        .join("; ")}`}
    >
      {points.length >= 2 && (
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.price)}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.price)} r="2" fill="currentColor" />
      ))}
    </svg>
  );
}

/**
 * Gráfico completo del histórico de precios (detalle): línea + puntos con
 * etiqueta de precio y de ronda (P0 / J{n}). SVG a mano alzada.
 */
function PriceChart({ points }: { points: ChartPoint[] }) {
  if (points.length === 0) {
    return <p className="muted">Sin histórico de precios.</p>;
  }
  const width = 560;
  const height = 200;
  const pad = { top: 28, right: 16, bottom: 30, left: 16 };
  const prices = points.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min;
  const x = (i: number) =>
    points.length === 1
      ? width / 2
      : pad.left + (i / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (price: number) =>
    span === 0
      ? pad.top + (height - pad.top - pad.bottom) / 2
      : height - pad.bottom - ((price - min) / span) * (height - pad.top - pad.bottom);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={`Histórico de precios: ${points
        .map((p) => `${p.label} ${formatNumber(p.price)}`)
        .join("; ")}`}
    >
      {points.length >= 2 && (
        <polyline
          points={points.map((p, i) => `${x(i)},${y(p.price)}`).join(" ")}
          fill="none"
          stroke="var(--fg)"
          strokeWidth="2"
        />
      )}
      {points.map((p, i) => (
        <g key={p.label}>
          <circle cx={x(i)} cy={y(p.price)} r="3.5" fill="var(--fg)" />
          <text
            x={x(i)}
            y={y(p.price) - 10}
            textAnchor="middle"
            fontSize="12"
            fill="var(--fg)"
          >
            {formatNumber(p.price)}
          </text>
          <text
            x={x(i)}
            y={height - 10}
            textAnchor="middle"
            fontSize="12"
            fill="var(--muted)"
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * Exploración del mercado (US-14): lista de activos de un GP con precio
 * actual (precio del GP, con fallback a P0), tendencia, mini-histórico y
 * concentración (nº de lineups del GP que contienen el activo, sin PII);
 * filtros por constructor/equipo (solo riders) y rango de precio; detalle
 * con gráfico completo e histórico (motivo fórmula/manual).
 *
 * El cliente solo envía IDs y filtros: precios, tendencia y conteos se
 * calculan siempre en el servidor (AGENTS.md §8).
 */
export default function MercadoPage() {
  const seasons = trpc.seasons.list.useQuery();
  const [seasonId, setSeasonId] = useState("");
  const [gpId, setGpId] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("rider");
  const [constructorId, setConstructorId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [priceMinText, setPriceMinText] = useState("");
  const [priceMaxText, setPriceMaxText] = useState("");
  const [selected, setSelected] = useState<{ assetId: string } | null>(null);

  const gps = trpc.seasons.gps.list.useQuery({ seasonId }, { enabled: seasonId !== "" });

  // Temporada por defecto: la más reciente (la lista va en orden ascendente).
  useEffect(() => {
    if (seasonId !== "" || seasons.data === undefined) return;
    const last = seasons.data[seasons.data.length - 1];
    if (last) setSeasonId(last.id);
  }, [seasons.data, seasonId]);

  // GP por defecto: el primero programado (`scheduled`) por ronda.
  useEffect(() => {
    if (gpId !== "" || gps.data === undefined) return;
    const next = [...gps.data]
      .sort((a, b) => a.round - b.round)
      .find((g) => g.status === "scheduled");
    if (next) setGpId(next.id);
  }, [gps.data, gpId]);

  const priceMin = parsePriceFilter(priceMinText, "Precio mínimo");
  const priceMax = parsePriceFilter(priceMaxText, "Precio máximo");
  // Cruce min/máx (F3): un rango imposible es un error de usuario que hay que
  // nombrar, no un "Ningún activo coincide" disfrazado de resultado.
  const rangeError =
    priceMin.number !== undefined &&
    priceMax.number !== undefined &&
    priceMin.number > priceMax.number
      ? "El mínimo no puede superar el máximo."
      : undefined;

  const list = trpc.market.market.list.useQuery(
    {
      gpId,
      assetType,
      ...(assetType === "rider" && constructorId !== "" ? { constructorId } : {}),
      ...(assetType === "rider" && teamId !== "" ? { teamId } : {}),
      ...(rangeError === undefined && priceMin.number !== undefined
        ? { priceMin: priceMin.number }
        : {}),
      ...(rangeError === undefined && priceMax.number !== undefined
        ? { priceMax: priceMax.number }
        : {}),
    },
    { enabled: gpId !== "" },
  );
  const constructors = trpc.market.constructors.list.useQuery(undefined, {
    enabled: assetType === "rider",
  });
  const teams = trpc.market.teams.list.useQuery(undefined, {
    enabled: assetType === "rider",
  });
  const detail = trpc.market.market.detail.useQuery(
    { gpId, assetType, assetId: selected?.assetId ?? "" },
    { enabled: selected !== null },
  );

  function selectSeason(value: string) {
    setSeasonId(value);
    setGpId("");
    setSelected(null);
  }

  function selectGp(value: string) {
    setGpId(value);
    setSelected(null);
  }

  function selectTab(next: AssetType) {
    setAssetType(next);
    setConstructorId("");
    setTeamId("");
    setSelected(null);
  }

  /** Salida del estado vacío (F3): limpiar todo el cluster de filtros de golpe. */
  function clearFilters() {
    setConstructorId("");
    setTeamId("");
    setPriceMinText("");
    setPriceMaxText("");
  }

  if (seasons.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (seasons.isError) {
    return <p className="muted">No se pudo cargar la lista de temporadas.</p>;
  }

  const selectedName =
    selected === null
      ? ""
      : (detail.data?.asset.name ??
        list.data?.find((a) => a.assetId === selected.assetId)?.name ??
        selected.assetId);

  /** GP seleccionado (h2 del bloque — patrón "X — {GP}" de /puntuacion y /resultados). */
  const selectedGp = gps.data?.find((g) => g.id === gpId);

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
            onChange={(e) => selectSeason(e.target.value)}
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
            <select
              id="gp"
              value={gpId}
              onChange={(e) => selectGp(e.target.value)}
            >
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
      {gpId === "" && <p className="muted">Selecciona un GP para explorar el mercado.</p>}

      {gpId !== "" && (
        <div>
          {/* h2 del bloque (F3): mismo patrón que "Mi puntuación — GP" en
              /puntuacion y "Mis resultados — GP" en /resultados. */}
          <h2>Mercado — {selectedGp?.name ?? "GP"}</h2>
          <div className="tabs" role="group" aria-label="Tipo de activo">
            <button
              type="button"
              className="tab"
              aria-pressed={assetType === "rider"}
              onClick={() => selectTab("rider")}
            >
              Pilotos
            </button>
            <button
              type="button"
              className="tab"
              aria-pressed={assetType === "constructor"}
              onClick={() => selectTab("constructor")}
            >
              Constructores
            </button>
            <button
              type="button"
              className="tab"
              aria-pressed={assetType === "team"}
              onClick={() => selectTab("team")}
            >
              Equipos
            </button>
          </div>

          <div className="filters">
            {assetType === "rider" && (
              <>
                <div className="field">
                  <label htmlFor="filter-constructor">Constructor</label>
                  <select
                    id="filter-constructor"
                    value={constructorId}
                    onChange={(e) => setConstructorId(e.target.value)}
                  >
                    <option value="">— Todos —</option>
                    {constructors.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="filter-team">Equipo</label>
                  <select
                    id="filter-team"
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                  >
                    <option value="">— Todos —</option>
                    {teams.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="price-min">Precio mínimo</label>
              <input
                id="price-min"
                type="text"
                inputMode="decimal"
                placeholder="p. ej. 10"
                value={priceMinText}
                onChange={(e) => setPriceMinText(e.target.value)}
                aria-invalid={priceMin.error ?? rangeError ? "true" : undefined}
                aria-describedby={
                  priceMin.error ?? rangeError ? "price-min-error" : undefined
                }
              />
              {(priceMin.error ?? rangeError) && (
                <p className="field-error" id="price-min-error">
                  {priceMin.error ?? rangeError}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="price-max">Precio máximo</label>
              <input
                id="price-max"
                type="text"
                inputMode="decimal"
                placeholder="p. ej. 30"
                value={priceMaxText}
                onChange={(e) => setPriceMaxText(e.target.value)}
                aria-invalid={priceMax.error ? "true" : undefined}
                aria-describedby={priceMax.error ? "price-max-error" : undefined}
              />
              {priceMax.error && (
                <p className="field-error" id="price-max-error">
                  {priceMax.error}
                </p>
              )}
            </div>
          </div>

          {/* Capa de ayuda de vocabulario (F3, patrón F1 de /admin): los
              términos de la tabla se explican una sola vez, en su primera
              aparición — aquí, justo antes de la lista. */}
          <p className="muted">
            Tendencia: variación del precio respecto al punto anterior del
            histórico (ronda anterior o P0). (P0): el GP aún no tiene precio
            propio; se muestra el precio de apertura. Lineups: cuántos lineups
            de este GP contienen el activo.
          </p>

          {list.isPending && <p className="muted">Consultando…</p>}
          {list.isError && (
            <Alert variant="error">No se pudo cargar el mercado del GP.</Alert>
          )}
          {list.data && list.data.length > 0 && (
            <div className="table-scroll">
              <table className="results-table">
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Precio</th>
                    <th scope="col">Tendencia</th>
                    <th scope="col">Mini-histórico</th>
                    <th scope="col">Lineups</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((a) => (
                    <tr key={a.assetId}>
                      <td>
                        <RowAction onClick={() => setSelected({ assetId: a.assetId })}>
                          {a.name}
                        </RowAction>
                        {assetType === "rider" &&
                          (a.constructorName !== null || a.teamName !== null) && (
                            <div className="muted">
                              {[a.constructorName, a.teamName]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          )}
                      </td>
                      <td>
                        {a.currentPrice === null ? (
                          <span className="muted">—</span>
                        ) : (
                          formatNumber(a.currentPrice)
                        )}
                        {a.isP0Fallback && <span className="muted"> (P0)</span>}
                      </td>
                      <td>
                        <TrendBadge trend={a.trend} delta={a.delta} />
                      </td>
                      <td>
                        <Sparkline
                          points={a.miniHistory.map((p) => ({
                            label: p.gpRound === null ? "P0" : `J${p.gpRound}`,
                            price: p.price,
                          }))}
                        />
                      </td>
                      <td>{a.popularity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.data && list.data.length === 0 && (
            <div>
              <p className="muted">Ningún activo coincide con los filtros.</p>
              {/* Salida del estado vacío (F3): no dejar al usuario limpiando
                  hasta 4 campos a mano. */}
              <div className="action-row">
                <RowAction onClick={clearFilters}>Borrar filtros</RowAction>
              </div>
            </div>
          )}

          {selected && (
            <div>
              {/* h2 (F3): bloque de contenido, igual que "Mi puntuación — GP"
                  en /puntuacion y "Mis resultados — GP" en /resultados. */}
              <h2>Detalle — {selectedName}</h2>
              {detail.isPending && <p className="muted">Consultando…</p>}
              {detail.isError && (
                <Alert variant="error">No se pudo cargar el detalle del activo.</Alert>
              )}
              {detail.data && (
                <div>
                  <ul className="status">
                    <li>
                      Precio actual:{" "}
                      <strong>
                        {detail.data.asset.currentPrice === null
                          ? "—"
                          : formatNumber(detail.data.asset.currentPrice)}
                      </strong>
                      {detail.data.asset.isP0Fallback && (
                        <span className="muted"> (precio de apertura P0)</span>
                      )}
                    </li>
                    <li>
                      Tendencia:{" "}
                      <TrendBadge
                        trend={detail.data.asset.trend}
                        delta={detail.data.asset.delta}
                      />
                    </li>
                    <li>
                      Lineups de este GP que contienen el activo:{" "}
                      <strong>{detail.data.asset.popularity}</strong>
                    </li>
                    {detail.data.asset.constructorName !== null && (
                      <li>
                        Constructor: <strong>{detail.data.asset.constructorName}</strong>
                      </li>
                    )}
                    {detail.data.asset.teamName !== null && (
                      <li>
                        Equipo: <strong>{detail.data.asset.teamName}</strong>
                      </li>
                    )}
                  </ul>
                  <PriceChart
                    points={detail.data.history.map((h) => ({
                      label: h.gpRound === null ? "P0" : `J${h.gpRound}`,
                      price: h.price,
                    }))}
                  />
                  <h3>Historial completo</h3>
                  {/* Motivo: primera aparición de Fórmula/Manual — explicarlo
                      en el sitio, una sola vez (patrón F1 de /admin). */}
                  <p className="muted">
                    Motivo: Fórmula = calculado por la fórmula del sistema;
                    Manual = ajuste manual del admin.
                  </p>
                  <div className="table-scroll">
                    <table className="results-table">
                      <thead>
                        <tr>
                          <th scope="col">Ronda</th>
                          <th scope="col">GP</th>
                          <th scope="col">Precio</th>
                          <th scope="col">Motivo</th>
                          <th scope="col">Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.history.map((h) => (
                          <tr key={h.id}>
                            <td>{h.gpRound === null ? "P0" : `J${h.gpRound}`}</td>
                            <td>{h.gpName ?? "—"}</td>
                            <td>{formatNumber(h.price)}</td>
                            <td>{h.reason === "formula" ? "Fórmula" : "Manual"}</td>
                            <td>{h.createdAt.toISOString().slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="action-row">
                    <RowAction onClick={() => setSelected(null)}>Cerrar</RowAction>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
