/**
 * Núcleo PURO del seleccionador gráfico de activos (US-41, ADR-0041):
 * búsqueda, filtro por grupo, orden, estado de asignación por slot,
 * razones de bloqueo y derivación de color/identidad del avatar generativo.
 *
 * Sin I/O (ni BD, ni http, ni reloj) y sin imports fuera de este archivo —
 * la misma regla de pureza que `economy`/`scoring`: recibe datos, devuelve
 * resultados, y se prueba como fórmula (`app/shared/__tests__/picker.test.ts`).
 *
 * El componente de presentación (`shared/components/asset-picker.tsx`) solo
 * renderiza lo que este módulo decide: qué tarjeta se ve, en qué estado y
 * con qué motivo de bloqueo.
 *
 * Avatares generativos (ADR-0041): dorsal (`riders.number`) o iniciales,
 * sobre un fondo de color DERIVADO determinísticamente del nombre (hash
 * FNV-1a → tono). Estable entre renders y GPs, sin esquema nuevo, sin
 * imágenes ni branding licenciado (AGENTS.md §11). El color es ESTEMÁTICO,
 * nunca semántico: los estados usan los tokens `--ok`/`--bad`/`--warning`.
 *
 * **US-42 (ADR-0042):** si el activo lleva COLOR REAL de la fuente
 * (`color`/`textColor`, p. ej. `teams.color`/`teams.text_color`), el avatar
 * lo usa; solo si no existe cae al hash derivado (fallback estético).
 * `avatarPalette` decide fondo/foreground de forma pura (incluida la
 * elección de foreground por luminosidad cuando la fuente no envía
 * `textColor`), sin I/O.
 */

export type AssetKind = "rider" | "constructor" | "team";

/** Activo genérico del selector (piloto, constructor o equipo). */
export interface PickerAsset {
  kind: AssetKind;
  id: string;
  name: string;
  /** Línea secundaria: rider → equipo; team → constructor; constructor → null. */
  subline: string | null;
  /**
   * Grupo al que pertenece (rider → `teamId`; team → `constructorId`;
   * constructor → null). Alimenta el filtro de grupo del selector.
   */
  groupId: string | null;
  /** Dorsal del piloto; null para constructor/equipo o dorsal desconocido. */
  number: number | null;
  /** Precio congelado del GP; null = sin precio (bloqueado). */
  price: number | null;
  /**
   * Color real del activo (hex, p. ej. `#ad0000`) — US-42 (ADR-0042).
   * Opcional: `null`/ausente ⇒ el avatar cae al hash derivado del nombre.
   * - rider → color de su equipo (afiliación del GP);
   * - team → color propio (`teams.color`);
   * - constructor → heurística determinística sobre sus equipos (BFF).
   */
  color?: string | null;
  /** Color de texto real (hex). `null`/ausente ⇒ foreground por luminosidad. */
  textColor?: string | null;
}

/** Slot del lineup (los 6): identificador, tipo de activo, etiqueta y valor. */
export interface PickerSlot {
  id: string;
  kind: AssetKind;
  label: string;
  /** Id del activo asignado ("" = vacío). */
  value: string;
}

export type SortMode = "name" | "price-asc" | "price-desc";

/**
 * Normaliza texto para comparar/buscar: minúsculas, sin diacríticos,
 * sin espacios extremos. "PÍLOTO  Uno" → "piloto uno".
 */
export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Búsqueda: la consulta (normalizada) aparece en el nombre o en el dorsal
 * (solo si existe). Consulta vacía ⇒ todo coincide.
 */
export function searchMatches(asset: PickerAsset, query: string): boolean {
  const q = normalizeText(query);
  if (q === "") return true;
  if (normalizeText(asset.name).includes(q)) return true;
  return asset.number !== null && normalizeText(String(asset.number)).includes(q);
}

/** Filtros del selector (vacío = sin filtro). */
export interface PickerFilters {
  query: string;
  /** Id de grupo (`groupId` del activo); "" = todos. */
  groupId: string;
}

/** Filtra por búsqueda y por grupo (los dos, conjuntivos). */
export function filterAssets(
  assets: readonly PickerAsset[],
  filters: PickerFilters,
): PickerAsset[] {
  return assets.filter(
    (a) =>
      searchMatches(a, filters.query) &&
      (filters.groupId === "" || a.groupId === filters.groupId),
  );
}

/**
 * Orden estable: por nombre (es-ES) o por precio (los sin precio SIEMPRE al
 * final, en el orden de nombre entre ellos). No muta la lista recibida.
 */
export function sortAssets(
  assets: readonly PickerAsset[],
  mode: SortMode,
): PickerAsset[] {
  const byName = (a: PickerAsset, b: PickerAsset): number =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  const copy = [...assets];
  if (mode === "name") {
    copy.sort(byName);
  } else if (mode === "price-asc") {
    copy.sort(
      (a, b) =>
        (a.price === null ? Infinity : a.price) -
          (b.price === null ? Infinity : b.price) || byName(a, b),
    );
  } else {
    copy.sort(
      (a, b) =>
        (b.price === null ? -Infinity : b.price) -
          (a.price === null ? -Infinity : a.price) || byName(a, b),
    );
  }
  return copy;
}

/** Estado de un activo respecto a UN slot. */
export type SlotState = "selected" | "in-other-slot" | "free";

/**
 * Estado de `asset` respecto al slot `slotId`, mirando los 6 slots:
 * "selected" si está en ese slot; "in-other-slot" si está en otro slot del
 * mismo tipo; "free" si no está en ninguno. (Un constructor nunca puede
 * "ocupar" un slot de piloto: solo se comparan slots del mismo `kind`.)
 */
export function slotStateFor(
  slotId: string,
  asset: PickerAsset,
  slots: readonly PickerSlot[],
): SlotState {
  const active = slots.find((s) => s.id === slotId);
  // El activo solo compite con slots de SU tipo: un constructor en su slot
  // no es "ya en otro slot" para un slot de piloto (no comparten plaza).
  if (!active || active.kind !== asset.kind) return "free";
  for (const s of slots) {
    if (s.kind !== asset.kind || s.value === "" || s.value !== asset.id) continue;
    if (s.id === slotId) return "selected";
    return "in-other-slot";
  }
  return "free";
}

/**
 * Motivo escrito de bloqueo de una tarjeta (nunca un control deshabilitado
 * sin explicación — patrón `Button.disabledReason`):
 * - sin precio para el GP → "Sin precio para este GP";
 * - ya asignado a otro slot → "Ya en otro slot";
 * - asignado al slot activo (o libre) → `null` (seleccionable).
 */
export function cardDisabledReason(
  asset: PickerAsset,
  slotId: string,
  slots: readonly PickerSlot[],
): string | null {
  if (asset.price === null) return "Sin precio para este GP";
  if (slotStateFor(slotId, asset, slots) === "in-other-slot") {
    return "Ya en otro slot";
  }
  return null;
}

/**
 * Asigna `assetId` al slot `slotId` (inmutable). Semántica de MUVMIENTO: si
 * el activo ya estaba en otro slot del mismo tipo, ese slot queda vacío —
 * reasignación gratis (ADR-0017), sin duplicar el activo entre slots.
 * Defensivo: slot inexistente o activo vacío ⇒ la lista no cambia.
 */
export function assignToSlot(
  slots: readonly PickerSlot[],
  slotId: string,
  assetId: string,
): PickerSlot[] {
  const target = slots.find((s) => s.id === slotId);
  if (!target || assetId === "") return [...slots];
  return slots.map((s) => {
    if (s.id === slotId) return { ...s, value: assetId };
    if (s.kind === target.kind && s.value === assetId) return { ...s, value: "" };
    return s;
  });
}

/** Vacía un slot (inmutable). */
export function clearSlot(
  slots: readonly PickerSlot[],
  slotId: string,
): PickerSlot[] {
  return slots.map((s) => (s.id === slotId ? { ...s, value: "" } : s));
}

/**
 * Iniciales para el avatar generativo cuando el dorsal no existe:
 * "Piloto Uno" → "PU"; "Verdelli" → "VE". (La tarjeta siempre muestra
 * primero el dorsal si existe: es el identificador del piloto.)
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return "—";
  const first = words[0]!;
  if (words.length === 1) {
    return (first.length <= 2 ? first : first.slice(0, 2)).toUpperCase();
  }
  return (first[0]! + words[1]![0]!).toUpperCase();
}

/** Hash FNV-1a (32 bits): determinista entre procesos y plataformas. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Tono (0–359) derivado del nombre: mismo nombre ⇒ mismo tono, siempre. */
export function assetHue(seed: string): number {
  return fnv1a(seed) % 360;
}

/**
 * Color de fondo del avatar (estético, no semántico). Sat/lum fijos para
 * que el texto oscuro (`var(--bg)`) conserve contraste AA en cualquier tono.
 */
export function assetColor(seed: string): string {
  return `hsl(${assetHue(seed)} 65% 55%)`;
}

// ── Paleta del avatar: color real de la fuente con fallback hash (US-42) ──

export interface AvatarPalette {
  /** Color de fondo del avatar (hex de la fuente o HSL del hash). */
  background: string;
  /** Color del texto (hex de la fuente o token CSS de contraste). */
  foreground: string;
}

/** Hex válido de color de la fuente: `#RGB` o `#RRGGBB`. */
function isHexColor(value: string | null | undefined): value is string {
  return (
    typeof value === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
  );
}

/** Expande `#RGB` → `#RRGGBB` (minúsculas). */
function expandHex(hex: string): string {
  const h = hex.slice(1);
  if (h.length === 3) {
    return h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return h.toLowerCase();
}

/**
 * Luminancia relativa (WCAG, sRGB linealizado) de un hex `#RGB`/`#RRGGBB`
 * (pura: sin I/O). 0 = negro, 1 = blanco.
 */
export function hexLuminance(hex: string): number {
  const h = expandHex(hex);
  const channel = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Paleta del avatar generativo (US-42, ADR-0042) — pura, sin I/O:
 *
 * - **Con color real** (`asset.color` hex válido): fondo = ese color;
 *   foreground = `asset.textColor` si es hex válido, si no se elige por
 *   LUMINOSIDAD del fondo (claro ⇒ texto oscuro `var(--bg)`, oscuro ⇒
 *   texto claro `var(--on-accent)`) para que siga siendo legible aunque
 *   la fuente no envíe `textColor`.
 * - **Sin color real** (o hex inválido): fallback estético de ADR-0041 —
 *   fondo = hash FNV-1a del nombre (`assetColor`), texto oscuro `var(--bg)`.
 */
export function avatarPalette(asset: PickerAsset): AvatarPalette {
  if (isHexColor(asset.color)) {
    const background = asset.color;
    if (isHexColor(asset.textColor)) {
      return { background, foreground: asset.textColor };
    }
    return {
      background,
      foreground: hexLuminance(asset.color) > 0.2 ? "var(--bg)" : "var(--on-accent)",
    };
  }
  return { background: assetColor(asset.name), foreground: "var(--bg)" };
}
