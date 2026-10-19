"use client";

import { useState } from "react";

import { Button } from "@/shared/components";
import type { AssetType } from "@/shared/validation/market";
import { trpc } from "@/trpc/client";

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  rider: "Pilotos",
  constructor: "Constructores",
  team: "Equipos",
};

/**
 * Panel de precios de apertura (P0) (US-07, ADR-0014, flujo 18):
 * - Lista los activos del tipo elegido con su P0 actual (o «sin P0»).
 * - Fija o cambia el P0 de un activo (upsert auditado: crea, sustituye o
 *   no-op; puede cambiarse en cualquier momento).
 * - Muestra el histórico de precios del activo elegido (P0 + una fila por
 *   GP, orden P0 → ronda).
 */
export default function PricesPanel() {
  const [assetType, setAssetType] = useState<AssetType>("rider");
  const [assetId, setAssetId] = useState("");
  const [price, setPrice] = useState("");

  const assets = trpc.market.prices.list.useQuery({ assetType });
  const history = trpc.market.prices.history.useQuery(
    { assetType, assetId },
    { enabled: assetId !== "" },
  );

  const setOpening = trpc.market.prices.setOpening.useMutation({
    onSuccess: () => {
      void assets.refetch();
      void history.refetch();
    },
  });

  const canSet = assetId !== "" && price !== "" && Number(price) > 0;

  function onTypeChange(value: AssetType) {
    setAssetType(value);
    setAssetId("");
    setPrice("");
  }

  return (
    <section>
      <h3>Precios de apertura (P0)</h3>
      <p className="muted">
        Fija o cambia el precio de apertura de un activo (queda auditado y
        puede cambiarse en cualquier momento). Abajo ves el histórico de
        precios del activo elegido.
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
        <p className="bad">
          No se pudieron cargar los activos: {assets.error.message}
        </p>
      ) : assets.data.length === 0 ? (
        <p className="muted">Aún no hay activos de este tipo.</p>
      ) : (
        <ul className="status">
          {assets.data.map((asset) => (
            <li key={asset.assetId}>
              <strong>{asset.name}</strong>
              {asset.openingPrice !== null
                ? ` — P0: ${asset.openingPrice}`
                : " — sin P0"}
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
          disabled={!canSet || setOpening.isPending}
          onClick={() =>
            setOpening.mutate({ assetType, assetId, price: Number(price) })
          }
        >
          {setOpening.isPending ? "Guardando…" : "Fijar P0"}
        </Button>
      </div>

      {setOpening.isError && (
        <p className="bad">No se pudo fijar el P0: {setOpening.error.message}</p>
      )}
      {setOpening.isSuccess && (
        <p className="ok">
          {setOpening.data.status === "created"
            ? "P0 creado."
            : setOpening.data.status === "updated"
              ? "P0 actualizado."
              : "El P0 ya era ese valor (sin cambios)."}
        </p>
      )}

      {assetId !== "" && (
        <>
          <h4>Historial de precios</h4>
          {history.isPending ? (
            <p className="muted">Consultando…</p>
          ) : history.isError ? (
            <p className="bad">
              No se pudo cargar el histórico: {history.error.message}
            </p>
          ) : history.data.length === 0 ? (
            <p className="muted">Este activo aún no tiene precios.</p>
          ) : (
            <ul className="status">
              {history.data.map((row) => (
                <li key={row.id}>
                  {row.gpRound === null
                    ? "Apertura (P0)"
                    : `Ronda ${row.gpRound} — ${row.gpName}`}
                  : <strong>{row.price}</strong>{" "}
                  ({row.reason === "manual" ? "manual" : "fórmula"})
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
