"use client";

import { useId, useMemo, useState } from "react";

import { formatNumber } from "@/shared/format";
import {
  type AssetKind,
  type PickerAsset,
  type PickerSlot,
  type SortMode,
  assetColor,
  cardDisabledReason,
  filterAssets,
  initialsOf,
  slotStateFor,
  sortAssets,
} from "@/shared/picker";
import { DisabledReason } from "./button";

/**
 * Seleccionador gráfico de activos (US-41, ADR-0041): filas de SLOTS del
 * lineup + rejilla de tarjetas de activos con avatar generativo (dorsal o
 * iniciales, color derivado determinísticamente del nombre — sin imágenes
 * ni branding licenciado).
 *
 * Modelo "slot activo + rejilla": se toca el slot (queda marcado) y el
 * activo (quedado asignado); tocar de nuevo el activo del slot lo quita.
 * El componente solo RENDERIZA: la lógica (búsqueda, filtro, orden, estado
 * de asignación, motivos de bloqueo, color del avatar) vive en el módulo
 * puro `@/shared/picker` (testable como fórmula, sin I/O).
 *
 * Accesibilidad (T-16 + patrón del sistema): todos los controles son
 * botones/campos estándar ≥ 44 px; un control con motivo de bloqueo usa
 * `aria-disabled` + `aria-describedby` con el motivo ESCRITO (nunca un
 * control bloqueado sin explicación — `Button.disabledReason`).
 */
export interface AssetPickerSlot extends PickerSlot {
  /** Nombre del activo asignado (null = slot vacío). */
  assignedName: string | null;
}

interface AssetPickerProps {
  /** Los 6 slots del lineup (orden de presentación). */
  slots: AssetPickerSlot[];
  /** Activos del mercado del GP (pilotos, constructores, equipos). */
  assets: PickerAsset[];
  /**
   * Grupos para el filtro según el tipo del slot activo (rider → equipos;
   * team → constructores; constructor → vacío = sin filtro de grupo).
   */
  groupsForKind: (kind: AssetKind) => { id: string; name: string }[];
  /** Asigna el activo al slot (la página aplica la semántica de movimiento). */
  onAssign: (slotId: string, assetId: string) => void;
  /** Vacía el slot (tocar de nuevo el activo asignado). */
  onClear: (slotId: string) => void;
}

export function AssetPicker({
  slots,
  assets,
  groupsForKind,
  onAssign,
  onClear,
}: AssetPickerProps) {
  // El slot activo es el primero (piloto oro 1): la página abre lista de
  // pilotos, el caso principal.
  const [activeSlotId, setActiveSlotId] = useState(slots[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");

  const searchId = useId();
  const groupSelectId = useId();
  const sortId = useId();

  const activeSlot = slots.find((s) => s.id === activeSlotId) ?? slots[0];

  /** Activos del TIPO del slot activo (invariante 5), filtrados y ordenados. */
  const visible = useMemo(() => {
    if (!activeSlot) return [];
    const ofKind = assets.filter((a) => a.kind === activeSlot.kind);
    return sortAssets(filterAssets(ofKind, { query, groupId }), sortMode);
  }, [assets, activeSlot, query, groupId, sortMode]);

  const groups = activeSlot ? groupsForKind(activeSlot.kind) : [];
  // La etiqueta del filtro depende del tipo: el grupo de un piloto es su
  // EQUIPO; el grupo de un equipo es su CONSTRUCTOR (invariante 5).
  const groupLabel = activeSlot?.kind === "rider" ? "Equipo" : "Constructor";

  function selectSlot(slotId: string) {
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    // Al cambiar de TIPO de slot el filtro de grupo ya no aplica (los grupos
    // son distintos): se reinicia para no mostrar una rejilla vacía "misteriosa".
    if (slot.kind !== activeSlot?.kind) setGroupId("");
    setActiveSlotId(slotId);
  }

  function clickCard(asset: PickerAsset) {
    if (!activeSlot) return;
    const reason = cardDisabledReason(asset, activeSlot.id, slots);
    if (reason !== null) return; // el motivo escrito ya explica por qué no
    if (activeSlot.value === asset.id) onClear(activeSlot.id);
    else onAssign(activeSlot.id, asset.id);
  }

  return (
    <section className="picker" aria-label="Componer el lineup">
      <div className="picker-slots" role="group" aria-label="Slots del lineup">
        {slots.map((slot) => {
          const active = slot.id === activeSlot?.id;
          return (
            <button
              key={slot.id}
              type="button"
              className="picker-slot"
              aria-pressed={active}
              onClick={() => selectSlot(slot.id)}
            >
              <span className="picker-slot-label">{slot.label}</span>{" "}
              <span
                className={
                  slot.value === ""
                    ? "picker-slot-value"
                    : "picker-slot-value is-filled"
                }
              >
                {slot.assignedName ?? "Vacío"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="picker-controls">
        <div className="field">
          <label htmlFor={searchId}>Buscar</label>
          <input
            id={searchId}
            type="search"
            value={query}
            placeholder="Nombre o dorsal"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {groups.length > 0 && (
          <div className="field">
            <label htmlFor={groupSelectId}>{groupLabel}</label>
            <select
              id={groupSelectId}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Todos</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={sortId}>Orden</label>
          <select
            id={sortId}
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            <option value="name">Nombre</option>
            <option value="price-asc">Precio (menor primero)</option>
            <option value="price-desc">Precio (mayor primero)</option>
          </select>
        </div>
      </div>
      {activeSlot ? (
        visible.length === 0 ? (
          <p className="picker-empty">Ningún activo coincide con los filtros.</p>
        ) : (
          <div className="picker-grid">
            {visible.map((asset) => (
              <PickerCard
                key={asset.id}
                asset={asset}
                slot={activeSlot}
                slots={slots}
                onSelect={() => clickCard(asset)}
              />
            ))}
          </div>
        )
      ) : (
        // Defensivo: sin slots no hay rejilla que mostrar (la página siempre
        // pasa los 6 slots del lineup).
        <p className="picker-empty">Ningún slot disponible para componer.</p>
      )}
      {activeSlot !== undefined && activeSlot.value !== "" && (
        <p className="muted picker-hint">
          Vuelve a tocar a {activeSlot.assignedName ?? "el activo"} para quitarlo
          de {activeSlot.label.toLowerCase()}.
        </p>
      )}
    </section>
  );
}

/**
 * Tarjeta de activo: avatar generativo (dorsal o iniciales sobre el color
 * derivado del nombre) + nombre + línea secundaria + precio. Estados:
 * - asignada al slot activo → `aria-pressed` + clic la quita;
 * - en otro slot / sin precio → `aria-disabled` + motivo escrito
 *   (patrón `Button.disabledReason`).
 */
function PickerCard({
  asset,
  slot,
  slots,
  onSelect,
}: {
  asset: PickerAsset;
  slot: AssetPickerSlot;
  slots: readonly AssetPickerSlot[];
  onSelect: () => void;
}) {
  const reasonId = useId();
  const reason = cardDisabledReason(asset, slot.id, slots);
  const disabled = reason !== null;
  const selected = slotStateFor(slot.id, asset, slots) === "selected";
  // Nombre accesible con separadores: la concatenación del JSX daría
  // "Piloto UnoTeam A10" (el lector de pantalla lo leería como una sola
  // palabra), así que se declara explícito: "Piloto Uno, Team A, 10".
  const cardLabel = [
    asset.name,
    asset.subline,
    asset.price === null ? "Sin precio" : formatNumber(asset.price),
  ]
    .filter((part): part is string => part != null && part !== "")
    .join(", ");
  return (
    <>
      <button
        type="button"
        className="picker-card"
        aria-label={cardLabel}
        aria-pressed={selected}
        aria-disabled={disabled ? "true" : undefined}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={() => {
          if (!disabled) onSelect();
        }}
      >
        <span
          className="asset-avatar"
          style={{ background: assetColor(asset.name) }}
          aria-hidden="true"
        >
          {asset.number !== null ? asset.number : initialsOf(asset.name)}
        </span>
        <span className="picker-card-body">
          <span className="picker-card-name">{asset.name}</span>
          {asset.subline !== null && (
            <span className="picker-card-sub">{asset.subline}</span>
          )}
        </span>
        <span
          className={
            asset.price === null
              ? "picker-card-price picker-card-price--none"
              : "picker-card-price"
          }
        >
          {asset.price === null ? "Sin precio" : formatNumber(asset.price)}
        </span>
      </button>
      {disabled && <DisabledReason id={reasonId}>{reason}</DisabledReason>}
    </>
  );
}
