"use client";

import { useState } from "react";

import { Alert, Button, ConfirmDialog, type ConfirmRequest } from "@/shared/components";
import { GP_STATUS_LABELS } from "@/modules/seasons/gp-status";
import type { AssetType } from "@/shared/validation/market";
import { trpc } from "@/trpc/client";

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  rider: "Pilotos",
  constructor: "Constructores",
  team: "Equipos",
};

/**
 * Panel de precios (US-07 + US-08, ADR-0014, flujo 18):
 * - Lista los activos del tipo elegido con su P0 actual (o «sin P0»).
 * - Fija o cambia el P0 de un activo (upsert auditado: crea, sustituye o
 *   no-op; puede cambiarse en cualquier momento).
 * - Muestra el histórico de precios del activo elegido (P0 + una fila por
 *   GP, orden P0 → ronda).
 * - Precios por GP (US-08): aplica la fórmula v1 tras un GP definitivo
 *   (crea los precios del siguiente GP, motivo «fórmula») y fija precios
 *   manuales para un GP concreto del activo elegido (motivo «manual»,
 *   auditado). Un GP en lockout no admite cambios.
 */
export default function PricesPanel() {
  const [assetType, setAssetType] = useState<AssetType>("rider");
  const [assetId, setAssetId] = useState("");
  const [price, setPrice] = useState("");
  // US-08: precios por GP (temporada + GPs para el ajuste manual y la fórmula).
  const [seasonId, setSeasonId] = useState("");
  const [manualGpId, setManualGpId] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [formulaGpId, setFormulaGpId] = useState("");
  // Confirmación con impacto (patrón del sistema) para las acciones que
  // reescriben precios.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  const assets = trpc.market.prices.list.useQuery({ assetType });
  const history = trpc.market.prices.history.useQuery(
    { assetType, assetId },
    { enabled: assetId !== "" },
  );
  const seasons = trpc.seasons.list.useQuery(undefined);
  const gps = trpc.seasons.gps.list.useQuery(
    { seasonId },
    {
      enabled: seasonId !== "",
    },
  );

  const setOpening = trpc.market.prices.setOpening.useMutation({
    onSuccess: () => {
      void assets.refetch();
      void history.refetch();
    },
  });
  const setManual = trpc.market.prices.setManual.useMutation({
    onSuccess: () => {
      void history.refetch();
    },
  });
  const applyFormula = trpc.market.prices.applyFormula.useMutation({
    onSuccess: () => {
      void history.refetch();
    },
  });
  // Recalcular temporada (calibración P0, ADR-0032): re-ejecuta la fórmula
  // GP a GP para alinear la serie de precios con el P0 vigente.
  const recalculateSeason = trpc.market.prices.recalculateSeason.useMutation({
    onSuccess: () => {
      void assets.refetch();
      void history.refetch();
    },
  });
  // P0 heurística desde la clasificación (ADR-0014): recalcula los P0 de
  // todos los activos y refresca la lista de activos (para ver los nuevos P0).
  const p0Heuristic = trpc.market.market.p0Heuristic.useMutation({
    onSuccess: () => {
      void assets.refetch();
      void history.refetch();
    },
  });

  const canSet = assetId !== "" && price !== "" && Number(price) > 0;
  const canSetManual =
    assetId !== "" && manualGpId !== "" && manualPrice !== "" && Number(manualPrice) > 0;

  // Etiquetas para nombrar el objeto de cada confirmación (la confirmación
  // debe identificar siempre qué se toca).
  const selectedSeason = seasons.data?.find((candidate) => candidate.id === seasonId);
  const selectedAsset = assets.data?.find((candidate) => candidate.assetId === assetId);
  const manualGp = gps.data?.find((candidate) => candidate.id === manualGpId);
  const selectedSeasonLabel = selectedSeason
    ? `«${selectedSeason.name}»`
    : "la temporada elegida";
  const seasonEcho = selectedSeason ? `«${selectedSeason.name}»` : "sin elegir";
  const selectedAssetLabel = selectedAsset
    ? `«${selectedAsset.name}»`
    : "el activo elegido";
  const manualGpLabel = manualGp
    ? `«R${manualGp.round} · ${manualGp.name}»`
    : "el GP elegido";

  function onTypeChange(value: AssetType) {
    setAssetType(value);
    setAssetId("");
    setPrice("");
  }

  function onSeasonChange(value: string) {
    setSeasonId(value);
    setManualGpId("");
    setFormulaGpId("");
  }

  /** Opciones de GP comunes a ambos selectores (ronda, nombre, estado). */
  function gpOptions() {
    return gps.data?.map((gp) => (
      <option key={gp.id} value={gp.id}>
        Ronda {gp.round} — {gp.name} ({GP_STATUS_LABELS[gp.status] ?? gp.status})
      </option>
    ));
  }

  return (
    <section>
      <h3>Precios de apertura (P0)</h3>
      <p className="muted">
        Fija o cambia el precio de apertura de un activo (queda auditado y puede cambiarse
        en cualquier momento). Abajo ves el histórico de precios del activo elegido.
      </p>

      <div className="field">
        <label htmlFor="pricesSeason">Temporada</label>
        <select
          id="pricesSeason"
          value={seasonId}
          onChange={(event) => onSeasonChange(event.target.value)}
        >
          <option value="">— Elige una temporada —</option>
          {seasons.data?.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name} ({season.year})
            </option>
          ))}
        </select>
      </div>

      <h4>1. P0 automático (heurística de siembra)</h4>
      <p className="muted">
        Temporada: {seasonEcho}. Calcula los P0 de todos los activos a partir de la
        clasificación del campeonato (posición → precio lineal sobre el rango P0
        calibrado 17.4→5.8; cada posición tiene un precio único; equipos y
        constructores = media de sus riders). Requiere que el mercado
        esté importado antes (pilotos, equipos, constructores y afiliaciones).
        Idempotente: re-ejecutarlo actualiza los P0 (auditado).
      </p>
      <div>
        <Button
          type="button"
          disabled={seasonId === "" || p0Heuristic.isPending}
          disabledReason={seasonId === "" ? "Elige una temporada arriba." : undefined}
          onClick={() =>
            setConfirmRequest({
              title: `Calcular P0 automático de ${selectedSeasonLabel}`,
              impact:
                `Se reescribirán los precios de apertura (P0) de todos los activos de ` +
                `${selectedSeasonLabel} según la clasificación del campeonato. ` +
                "Cada cambio queda auditado y puede corregirse después.",
              confirmLabel: "Sí, calcular los P0",
              onConfirm: () => p0Heuristic.mutate({ seasonId }),
            })
          }
        >
          {p0Heuristic.isPending ? "Calculando…" : "Calcular P0 automático"}
        </Button>
      </div>
      {p0Heuristic.isError && (
        <Alert variant="error">No se pudo calcular el P0: {p0Heuristic.error.message}</Alert>
      )}
      {p0Heuristic.isSuccess && (
        <Alert variant="success">
          P0 calculado: {p0Heuristic.data.ridersPriced} pilotos,{" "}
          {p0Heuristic.data.teamsPriced} equipos, {p0Heuristic.data.constructorsPriced}{" "}
          constructores (rango {p0Heuristic.data.minPrice}–{p0Heuristic.data.maxPrice}).
        </Alert>
      )}

      <h4>2. P0 manual</h4>
      <p className="muted">
        Activo: {selectedAsset ? `«${selectedAsset.name}»` : "sin elegir"}. El histórico
        de precios de abajo sigue al activo elegido.
      </p>
      <div className="field">
        <label htmlFor="priceAssetType">Tipo de activo</label>
        <select
          id="priceAssetType"
          value={assetType}
          onChange={(event) => onTypeChange(event.target.value as AssetType)}
        >
          {(Object.keys(ASSET_TYPE_LABELS) as AssetType[]).map((type) => (
            <option key={type} value={type}>
              {ASSET_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {assets.isPending ? (
        <p className="muted">Consultando…</p>
      ) : assets.isError ? (
        <Alert variant="error">
          No se pudieron cargar los activos: {assets.error.message}
        </Alert>
      ) : assets.data.length === 0 ? (
        <p className="muted">Aún no hay activos de este tipo.</p>
      ) : (
        <ul className="status">
          {assets.data.map((asset) => (
            <li key={asset.assetId}>
              <strong>{asset.name}</strong>
              {asset.openingPrice !== null ? ` — P0: ${asset.openingPrice}` : " — sin P0"}
            </li>
          ))}
        </ul>
      )}

      <div className="field">
        <label htmlFor="priceAssetId">Activo</label>
        <select
          id="priceAssetId"
          value={assetId}
          onChange={(event) => setAssetId(event.target.value)}
        >
          <option value="">— Elige un activo —</option>
          {assets.data?.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {asset.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="priceValue">Precio de apertura (P0)</label>
        <input
          id="priceValue"
          type="number"
          min="0.01"
          step="0.01"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>

      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!canSet || setOpening.isPending}
          disabledReason={
            !canSet
              ? assetId === ""
                ? "Elige un activo antes de fijar su precio de apertura."
                : "Escribe un precio de apertura mayor que 0."
              : undefined
          }
          onClick={() =>
            setConfirmRequest({
              title: `Fijar el P0 de ${selectedAssetLabel}`,
              impact:
                `Se fijará el precio de apertura de ${selectedAssetLabel} en ` +
                `${Number(price)}. Sustituye el P0 anterior si existe (auditado) y ` +
                "queda como referencia de la serie de precios por GP.",
              confirmLabel: "Sí, fijar el P0",
              onConfirm: () =>
                setOpening.mutate({ assetType, assetId, price: Number(price) }),
            })
          }
        >
          {setOpening.isPending ? "Guardando…" : "Fijar P0"}
        </Button>
      </div>

      {setOpening.isError && (
        <Alert variant="error">No se pudo fijar el P0: {setOpening.error.message}</Alert>
      )}
      {setOpening.isSuccess && (
        <Alert variant="success">
          {setOpening.data.status === "created"
            ? "P0 creado."
            : setOpening.data.status === "updated"
              ? "P0 actualizado."
              : "El P0 ya era ese valor (sin cambios)."}
        </Alert>
      )}

      {assetId !== "" && (
        <>
          <h4>Historial de precios</h4>
          {history.isPending ? (
            <p className="muted">Consultando…</p>
          ) : history.isError ? (
            <Alert variant="error">
              No se pudo cargar el histórico: {history.error.message}
            </Alert>
          ) : history.data.length === 0 ? (
            <p className="muted">Este activo aún no tiene precios.</p>
          ) : (
            <ul className="status">
              {history.data.map((row) => (
                <li key={row.id}>
                  {row.gpRound === null
                    ? "Apertura (P0)"
                    : `Ronda ${row.gpRound} — ${row.gpName}`}
                  : <strong>{row.price}</strong> (
                  {row.reason === "manual" ? "manual" : "fórmula"})
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h4>3. Precios por GP (fórmula v1 y ajuste manual)</h4>
      <p className="muted">
        Temporada: {seasonEcho}. Tras cada GP definitivo, la fórmula v1 calcula el precio
        del siguiente GP (motivo «fórmula»). También puedes fijar un precio manual para un
        GP concreto del activo elegido (motivo «manual», auditado). Los precios de un GP
        en lockout no se pueden cambiar.
      </p>

      {seasonId !== "" &&
        (gps.isPending ? (
          <p className="muted">Consultando…</p>
        ) : gps.isError ? (
          <Alert variant="error">
            No se pudieron cargar los GPs: {gps.error.message}
          </Alert>
        ) : gps.data.length === 0 ? (
          <p className="muted">Esta temporada aún no tiene GPs.</p>
        ) : null)}

      <h5>Ajuste manual</h5>
      <div className="field">
        <label htmlFor="manualGp">GP (objetivo del precio manual)</label>
        <select
          id="manualGp"
          value={manualGpId}
          onChange={(event) => setManualGpId(event.target.value)}
        >
          <option value="">— Elige un GP —</option>
          {gpOptions()}
        </select>
      </div>
      <div className="field">
        <label htmlFor="manualPrice">Precio manual</label>
        <input
          id="manualPrice"
          type="number"
          min="0.01"
          step="0.01"
          value={manualPrice}
          onChange={(event) => setManualPrice(event.target.value)}
        />
      </div>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!canSetManual || setManual.isPending}
          disabledReason={
            !canSetManual
              ? assetId === ""
                ? "Elige un activo."
                : manualGpId === ""
                  ? "Elige el GP del precio manual."
                  : "Escribe un precio mayor que 0."
              : undefined
          }
          onClick={() =>
            setConfirmRequest({
              title: `Fijar precio manual de ${selectedAssetLabel}`,
              impact:
                `Se fijará el precio de ${selectedAssetLabel} para ${manualGpLabel} ` +
                "(motivo «manual», con histórico y auditado) y puede corregirse después.",
              confirmLabel: "Sí, fijar el precio manual",
              onConfirm: () =>
                setManual.mutate({
                  assetType,
                  assetId,
                  gpId: manualGpId,
                  price: Number(manualPrice),
                }),
            })
          }
        >
          {setManual.isPending ? "Guardando…" : "Fijar precio manual"}
        </Button>
      </div>
      {setManual.isError && (
        <Alert variant="error">
          No se pudo fijar el precio manual: {setManual.error.message}
        </Alert>
      )}
      {setManual.isSuccess && (
        <Alert variant="success">
          {setManual.data.status === "created"
            ? "Precio manual creado."
            : setManual.data.status === "updated"
              ? "Precio manual actualizado."
              : "El precio ya era ese valor (sin cambios)."}
        </Alert>
      )}

      <h5>Aplicar fórmula (pricing-v1)</h5>
      <div className="field">
        <label htmlFor="formulaGp">GP definitivo (fuente de la fórmula)</label>
        <select
          id="formulaGp"
          value={formulaGpId}
          onChange={(event) => setFormulaGpId(event.target.value)}
        >
          <option value="">— Elige un GP —</option>
          {gpOptions()}
        </select>
      </div>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={formulaGpId === "" || applyFormula.isPending}
          disabledReason={
            formulaGpId === "" ? "Elige el GP definitivo del que partir." : undefined
          }
          onClick={() => {
            const sourceGp = gps.data?.find((candidate) => candidate.id === formulaGpId);
            const targetGp = gps.data
              ?.filter((candidate) => candidate.round > (sourceGp?.round ?? 0))
              .sort((a, b) => a.round - b.round)[0];
            setConfirmRequest({
              title: "Aplicar la fórmula de precios",
              impact:
                `Se recalcularán los precios de ${assets.data?.length ?? 0} activos` +
                (targetGp
                  ? ` para «R${targetGp.round} · ${targetGp.name}» (motivo «fórmula», con histórico y auditado).`
                  : " según el GP elegido (motivo «fórmula», con histórico y auditado)."),
              confirmLabel: "Sí, aplicar la fórmula",
              onConfirm: () => applyFormula.mutate({ gpId: formulaGpId }),
            });
          }}
        >
          {applyFormula.isPending ? "Aplicando…" : "Aplicar fórmula al siguiente GP"}
        </Button>
      </div>
      {applyFormula.isError && (
        <Alert variant="error">
          No se pudo aplicar la fórmula: {applyFormula.error.message}
        </Alert>
      )}
      {applyFormula.isSuccess && (
        <Alert variant="success">
          {applyFormula.data.targetGpId === null
            ? "El GP elegido es el último de la temporada: no hay siguiente GP."
            : applyFormula.data.skippedLocked
              ? `El GP objetivo (ronda ${applyFormula.data.targetGpRound}) está en lockout: precios sin cambios.`
              : `Precios de la ronda ${applyFormula.data.targetGpRound} aplicados: ${applyFormula.data.created} creados, ${applyFormula.data.updated} actualizados, ${applyFormula.data.unchanged} sin cambios, ${applyFormula.data.skippedNoOpening} sin P0.`}
        </Alert>
      )}

      <h4>4. Recalcular temporada</h4>
      <p className="muted">
        Temporada: {seasonEcho}. Tras cambiar el P0 (p. ej. con el P0 automático de
        arriba), recalcula los precios de la temporada GP a GP (solo los GPs con
        resultados definitivos) para que la serie de precios quede consistente con el P0
        vigente. Cada fila recalculada queda auditada (antes → después). Requiere una
        temporada elegida arriba.
      </p>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={seasonId === "" || recalculateSeason.isPending}
          disabledReason={seasonId === "" ? "Elige una temporada arriba." : undefined}
          onClick={() =>
            setConfirmRequest({
              title: `Recalcular precios de ${selectedSeasonLabel}`,
              impact:
                `Se recalcularán los precios de ${selectedSeasonLabel} GP a GP ` +
                "(solo los GPs con resultados definitivos) y cada fila quedará auditada " +
                "(antes → después).",
              confirmLabel: "Sí, recalcular la temporada",
              onConfirm: () => recalculateSeason.mutate({ seasonId }),
            })
          }
        >
          {recalculateSeason.isPending
            ? "Recalculando…"
            : "Recalcular precios de la temporada"}
        </Button>
      </div>
      {recalculateSeason.isError && (
        <Alert variant="error">
          No se pudo recalcular la temporada: {recalculateSeason.error.message}
        </Alert>
      )}
      {recalculateSeason.isSuccess && (
        <Alert variant="success">
          Temporada recalculada: {recalculateSeason.data.recalculated} GP recalculados,{" "}
          {recalculateSeason.data.skippedNoDefinitive} sin resultados definitivos (se
          saltaron).
        </Alert>
      )}

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
    </section>
  );
}
