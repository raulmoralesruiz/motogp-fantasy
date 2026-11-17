// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { type AssetPickerSlot, AssetPicker } from "../asset-picker";
import { type PickerAsset } from "../../picker";
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
