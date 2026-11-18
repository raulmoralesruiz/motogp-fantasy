// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { type AssetPickerSlot, AssetPicker } from "../asset-picker";
import { assetColor, type PickerAsset } from "../../picker";
import { render, screen, userEvent, within } from "../../../../test/rtl";

const SLOTS: AssetPickerSlot[] = [
  { id: "gold-1", kind: "rider", label: "Piloto oro 1", value: "", assignedName: null },
  { id: "gold-2", kind: "rider", label: "Piloto oro 2", value: "", assignedName: null },
  { id: "silver-1", kind: "rider", label: "Piloto plata 1", value: "", assignedName: null },
  { id: "silver-2", kind: "rider", label: "Piloto plata 2", value: "", assignedName: null },
  { id: "constructor", kind: "constructor", label: "Constructor", value: "", assignedName: null },
  { id: "team", kind: "team", label: "Equipo", value: "", assignedName: null },
];

const RIDERS: PickerAsset[] = [
  {
    kind: "rider",
    id: "r1",
    name: "Piloto Uno",
    subline: "Equipo A",
    groupId: "team-a",
    number: 10,
    price: 12,
  },
  {
    kind: "rider",
    id: "r2",
    name: "Piloto Dos",
    subline: "Equipo B",
    groupId: "team-b",
    number: null,
    price: 8,
  },
  {
    kind: "rider",
    id: "r3",
    name: "Piloto Tres",
    subline: "Equipo A",
    groupId: "team-a",
    number: 23,
    price: null,
  },
];

const CONSTRUCTORS: PickerAsset[] = [
  {
    kind: "constructor",
    id: "ctor-a",
    name: "Constructor X",
    subline: null,
    groupId: null,
    number: null,
    price: 5,
  },
];

const TEAMS: PickerAsset[] = [
  {
    kind: "team",
    id: "team-a",
    name: "Equipo A",
    subline: "Constructor X",
    groupId: "ctor-a",
    number: null,
    price: 7,
  },
  {
    kind: "team",
    id: "team-b",
    name: "Equipo B",
    subline: "Constructor X",
    groupId: "ctor-a",
    number: null,
    price: 9,
  },
];

const ASSETS = [...RIDERS, ...CONSTRUCTORS, ...TEAMS];

function groupsForKind(kind: string) {
  if (kind === "rider") {
    return [
      { id: "team-a", name: "Equipo A" },
      { id: "team-b", name: "Equipo B" },
    ];
  }
  if (kind === "team") return [{ id: "ctor-a", name: "Constructor X" }];
  return [];
}

function renderPicker(
  overrides: { slots?: AssetPickerSlot[]; assets?: PickerAsset[] } = {},
) {
  const onAssign = vi.fn();
  const onClear = vi.fn();
  render(
    <AssetPicker
      slots={overrides.slots ?? SLOTS}
      assets={overrides.assets ?? ASSETS}
      groupsForKind={groupsForKind}
      onAssign={onAssign}
      onClear={onClear}
    />,
  );
  return { onAssign, onClear };
}

const slotsWith = (slotId: string, assetId: string, name: string): AssetPickerSlot[] =>
  SLOTS.map((s) =>
    s.id === slotId ? { ...s, value: assetId, assignedName: name } : s,
  );

describe("AssetPicker (US-41, ADR-0041)", () => {
  it("renderiza los 6 slots y marca el primero como activo", () => {
    renderPicker();
    expect(
      screen.getByRole("button", { name: "Piloto oro 1 Vacío" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Piloto plata 2 Vacío" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByRole("button", { name: /Vacío/ })).toHaveLength(6);
  });

  it("sin slots muestra el aviso defensivo (rama de seguridad, no un bug)", () => {
    renderPicker({ slots: [] });
    expect(
      screen.getByText("Ningún slot disponible para componer."),
    ).toBeInTheDocument();
    // Ni rejilla ni hint de quitar: sin slot activo no hay nada que tocar.
    expect(screen.queryByRole("button", { name: /Vacío/ })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Vuelve a tocar a /),
    ).not.toBeInTheDocument();
  });

  it("el slot de piloto muestra SOLO pilotos (invariante 5)", () => {
    renderPicker();
    expect(screen.getByRole("button", { name: /Piloto Uno/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Constructor X/ }),
    ).not.toBeInTheDocument();
    // `^Equipo A`: la tarjeta de equipo (no el slot «Equipo Vacío», ni las
    // tarjetas de piloto que llevan «Equipo A» de línea de equipo).
    expect(
      screen.queryByRole("button", { name: /^Equipo A/ }),
    ).not.toBeInTheDocument();
  });

  it("clic en una tarjeta asigna el activo al slot activo", async () => {
    const { onAssign, onClear } = renderPicker();
    await userEvent.click(screen.getByRole("button", { name: /Piloto Uno/ }));
    expect(onAssign).toHaveBeenCalledWith("gold-1", "r1");
    expect(onClear).not.toHaveBeenCalled();
  });

  it("la tarjeta del slot activo se puede tocar de nuevo para quitarla", async () => {
    const { onAssign, onClear } = renderPicker({
      slots: slotsWith("gold-1", "r1", "Piloto Uno"),
    });
    // `/Piloto Uno.*Equipo A/`: la tarjeta (con su línea de equipo), no el
    // slot "Piloto oro 1 Piloto Uno".
    const card = screen.getByRole("button", { name: /Piloto Uno.*Equipo A/ });
    expect(card).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(card);
    expect(onClear).toHaveBeenCalledWith("gold-1");
    expect(onAssign).not.toHaveBeenCalled();
    // El hint de quitar se muestra cuando el slot activo tiene activo.
    expect(screen.getByText(/Vuelve a tocar a Piloto Uno/)).toBeInTheDocument();
  });

  it("un piloto ya en OTRO slot se deshabilita con motivo escrito", async () => {
    const { onAssign, onClear } = renderPicker({
      slots: slotsWith("gold-1", "r1", "Piloto Uno"),
    });
    // Pasar al slot gold-2: "Piloto Uno" ya ocupa gold-1.
    await userEvent.click(screen.getByRole("button", { name: "Piloto oro 2 Vacío" }));
    // La tarjeta (con línea de equipo), no el slot relleno "Piloto oro 1 ...".
    const card = screen.getByRole("button", { name: /Piloto Uno.*Equipo A/ });
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Ya en otro slot")).toBeInTheDocument();
    await userEvent.click(card);
    expect(onAssign).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("un piloto sin precio se deshabilita con motivo escrito", () => {
    renderPicker();
    const card = screen.getByRole("button", { name: /Piloto Tres/ });
    expect(card).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Sin precio para este GP")).toBeInTheDocument();
    expect(screen.getByText("Sin precio")).toBeInTheDocument();
  });

  it("busca por nombre (insensible a mayúsculas)", async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText("Buscar"), "DOS");
    expect(screen.getByRole("button", { name: /Piloto Dos/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Piloto Uno/ }),
    ).not.toBeInTheDocument();
  });

  it("busca por dorsal cuando existe", async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText("Buscar"), "10");
    expect(screen.getByRole("button", { name: /Piloto Uno/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Piloto Dos/ }),
    ).not.toBeInTheDocument();
  });

  it("filtra por equipo (grupo del piloto)", async () => {
    renderPicker();
    await userEvent.selectOptions(screen.getByLabelText("Equipo"), "team-b");
    expect(screen.getByRole("button", { name: /Piloto Dos/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Piloto Uno/ }),
    ).not.toBeInTheDocument();
  });

  it("ordena por precio ascendente: los sin precio quedan al final", async () => {
    renderPicker();
    await userEvent.selectOptions(screen.getByLabelText("Orden"), "price-asc");
    const cards = screen
      .getAllByRole("button", { name: /Piloto/ })
      .filter((b) => /Piloto (Uno|Dos|Tres)/.test(b.textContent ?? ""));
    // Dos (8) < Uno (12) < Tres (sin precio: siempre al final).
    expect(cards[0]?.textContent).toContain("Piloto Dos");
    expect(cards[1]?.textContent).toContain("Piloto Uno");
    expect(cards[2]?.textContent).toContain("Piloto Tres");
  });

  it("el avatar muestra el dorsal si existe y las iniciales si no", () => {
    renderPicker();
    const uno = within(screen.getByRole("button", { name: /Piloto Uno/ }));
    expect(uno.getByText("10")).toBeInTheDocument();
    const dos = within(screen.getByRole("button", { name: /Piloto Dos/ }));
    expect(dos.getByText("PD")).toBeInTheDocument();
  });

  it("mostrar vacío explícito si nada coincide con los filtros", async () => {
    renderPicker();
    await userEvent.type(screen.getByLabelText("Buscar"), "zzz");
    expect(screen.getByText("Ningún activo coincide con los filtros.")).toBeInTheDocument();
  });

  it("cambiar de tipo de slot resetea el filtro de grupo", async () => {
    renderPicker();
    await userEvent.selectOptions(screen.getByLabelText("Equipo"), "team-b");
    // Pasar al slot de EQUIPO: el filtro pasa a constructores y se reinicia.
    await userEvent.click(screen.getByRole("button", { name: "Equipo Vacío" }));
    expect(screen.queryByRole("button", { name: /Piloto Uno/ })).not.toBeInTheDocument();
    const groupSelect = screen.getByLabelText("Constructor");
    expect(groupSelect).toHaveValue("");
    expect(screen.getByRole("button", { name: /Equipo A/ })).toBeInTheDocument();
  });

  it("sin activos del tipo, el mensaje vacío (defensivo)", () => {
    renderPicker({ assets: [] });
    expect(
      screen.getByText("Ningún activo coincide con los filtros."),
    ).toBeInTheDocument();
  });
});

// ── Paleta del avatar: color real de la fuente con fallback hash (US-42) ───

describe("AssetPicker avatar (US-42, ADR-0042)", () => {
  // jsdom normaliza los colores inline a `rgb()`; las comparaciones se hacen
  // contra el valor normalizado (mismo resultado que `getComputedStyle`).

  /** `#RRGGBB`/`#RGB` → `rgb(r, g, b)` (la normalización de jsdom). */
  function hexToRgb(hex: string): string {
    const h = hex.slice(1);
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const [r, g, b] = [0, 2, 4].map((i) =>
      Number.parseInt(full.slice(i, i + 2), 16),
    );
    return `rgb(${r}, ${g}, ${b})`;
  }

  /** `hsl(H S% L%)` → `rgb(r, g, b)` (conversión estándar, redondeo jsdom). */
  function hslToRgb(hsl: string): string {
    const m = hsl.match(/hsl\((\d+) (\d+)% (\d+)%\)/);
    if (!m) throw new Error(`HSL no esperado: ${hsl}`);
    const h = Number(m[1]) / 60;
    const s = Number(m[2]) / 100;
    const l = Number(m[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h % 6) % 2 - 1));
    const seg = h % 6;
    const rgb =
      seg < 1 ? [c, x, 0] : seg < 2 ? [x, c, 0] : seg < 3 ? [0, c, x] : seg < 4 ? [0, x, c] : seg < 5 ? [x, 0, c] : [c, 0, x];
    const mm = l - c / 2;
    return `rgb(${rgb.map((v) => Math.round((v + mm) * 255)).join(", ")})`;
  }

  /** Un solo piloto con los colores dados (null = la fuente no los envía). */
  function renderAvatar(color: string | null, textColor: string | null) {
    const assets: PickerAsset[] = [
      {
        kind: "rider",
        id: "r1",
        name: "Piloto Uno",
        subline: "Equipo A",
        groupId: "team-a",
        number: 93,
        price: 12,
        color,
        textColor,
      },
    ];
    renderPicker({ assets });
    const card = screen.getByRole("button", { name: /Piloto Uno/ });
    return card.querySelector(".asset-avatar") as HTMLElement;
  }

  it("color real: fondo = color de la fuente, texto = textColor de la fuente", () => {
    const avatar = renderAvatar("#ad0000", "#ffffff");
    expect(avatar.style.background).toBe(hexToRgb("#ad0000"));
    expect(avatar.style.color).toBe(hexToRgb("#ffffff"));
  });

  it("sin textColor: fondo claro → texto oscuro (var(--bg), luminancia)", () => {
    // #fafafa: luminancia alta (> 0.2) → texto oscuro.
    const avatar = renderAvatar("#fafafa", null);
    expect(avatar.style.background).toBe(hexToRgb("#fafafa"));
    expect(avatar.style.color).toBe("var(--bg)");
  });

  it("sin textColor: fondo oscuro → texto claro (var(--on-accent))", () => {
    // #383838: luminancia baja (≤ 0.2) → texto claro.
    const avatar = renderAvatar("#383838", null);
    expect(avatar.style.background).toBe(hexToRgb("#383838"));
    expect(avatar.style.color).toBe("var(--on-accent)");
  });

  it("sin color real → fallback al hash del nombre (ADR-0041) + texto oscuro", () => {
    const avatar = renderAvatar(null, null);
    // `assetColor` devuelve HSL; jsdom lo normaliza a rgb.
    expect(avatar.style.background).toBe(hslToRgb(assetColor("Piloto Uno")));
    expect(avatar.style.color).toBe("var(--bg)");
  });
});
