import { describe, expect, it } from "vitest";

import {
  type PickerAsset,
  type PickerSlot,
  assignToSlot,
  assetColor,
  assetHue,
  cardDisabledReason,
  clearSlot,
  filterAssets,
  initialsOf,
  normalizeText,
  searchMatches,
  slotStateFor,
  sortAssets,
} from "../picker";

const asset = (partial: Partial<PickerAsset> & { id: string }): PickerAsset => ({
  kind: "rider",
  name: "Piloto",
  subline: null,
  groupId: null,
  number: null,
  price: 10,
  ...partial,
});

const SLOTS: PickerSlot[] = [
  { id: "gold-1", kind: "rider", label: "Piloto oro 1", value: "" },
  { id: "gold-2", kind: "rider", label: "Piloto oro 2", value: "" },
  { id: "silver-1", kind: "rider", label: "Piloto plata 1", value: "" },
  { id: "silver-2", kind: "rider", label: "Piloto plata 2", value: "" },
  { id: "constructor", kind: "constructor", label: "Constructor", value: "" },
  { id: "team", kind: "team", label: "Equipo", value: "" },
];

describe("normalizeText", () => {
  it("minúsculas, sin diacríticos, sin espacios extremos", () => {
    expect(normalizeText("  PÍLOTO  Uno ")).toBe("piloto uno");
    expect(normalizeText("EQUIPO Á")).toBe("equipo a");
  });

  it("consulta vacía", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("searchMatches", () => {
  const p10 = asset({ id: "p10", name: "Piloto A", number: 10, groupId: "team-a" });
  const p11 = asset({ id: "p11", name: "Piloto B", number: 11, groupId: "team-b" });
  const sinDorsal = asset({ id: "s1", name: "Piloto C", number: null });

  it("busca por nombre (insensible a mayúsculas/diacríticos)", () => {
    expect(searchMatches(p10, "pilotO a")).toBe(true);
    expect(searchMatches(p10, "PIL")).toBe(true);
    expect(searchMatches(p10, "zzz")).toBe(false);
  });

  it("busca por dorsal cuando existe", () => {
    expect(searchMatches(p10, "10")).toBe(true);
    expect(searchMatches(p11, "10")).toBe(false);
    expect(searchMatches(sinDorsal, "10")).toBe(false);
  });

  it("consulta vacía coincide con todo", () => {
    expect(searchMatches(p10, "  ")).toBe(true);
  });
});

describe("filterAssets (búsqueda + grupo, conjuntivos)", () => {
  const lista = [
    asset({ id: "a", name: "Piloto A", groupId: "team-a" }),
    asset({ id: "b", name: "Piloto B", groupId: "team-b" }),
    asset({ id: "c", name: "Piloto C", groupId: "team-a" }),
    asset({ id: "d", kind: "team", name: "Equipo Z", groupId: "ctor-a" }),
  ];

  it("grupo vacío = todos", () => {
    expect(filterAssets(lista, { query: "", groupId: "" })).toHaveLength(4);
  });

  it("filtra por grupo", () => {
    expect(filterAssets(lista, { query: "", groupId: "team-a" }).map((x) => x.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("búsqueda + grupo en conjunto", () => {
    expect(
      filterAssets(lista, { query: "piloto b", groupId: "team-b" }).map((x) => x.id),
    ).toEqual(["b"]);
    expect(
      filterAssets(lista, { query: "piloto", groupId: "no-existe" }),
    ).toEqual([]);
  });
});

describe("sortAssets", () => {
  const lista = [
    asset({ id: "c", name: "Ciro" }),
    asset({ id: "a", name: "Álvaro" }),
    asset({ id: "b", name: "Bruno" }),
    asset({ id: "z", name: "Zorro", price: null }),
  ];

  it("por nombre (es-ES, insensible a mayúsculas)", () => {
    expect(sortAssets(lista, "name").map((x) => x.id)).toEqual(["a", "b", "c", "z"]);
  });

  it("precio ascendente: sin precio al final, empate por nombre", () => {
    const precios = [
      asset({ id: "x1", name: "Uno", price: 5 }),
      asset({ id: "x2", name: "Beto", price: 5 }),
      asset({ id: "x3", name: "Zeta", price: null }),
      asset({ id: "x4", name: "Tres", price: 3 }),
    ];
    expect(sortAssets(precios, "price-asc").map((x) => x.id)).toEqual([
      "x4",
      "x2",
      "x1",
      "x3",
    ]);
  });

  it("precio descendente: sin precio al final (no al inicio)", () => {
    const precios = [
      asset({ id: "y1", name: "Alfa", price: 9 }),
      asset({ id: "y2", name: "Beta", price: 9 }),
      asset({ id: "y3", name: "Gama", price: null }),
      asset({ id: "y4", name: "Delta", price: 4 }),
    ];
    expect(sortAssets(precios, "price-desc").map((x) => x.id)).toEqual([
      "y1",
      "y2",
      "y4",
      "y3",
    ]);
  });

  it("no muta la lista recibida", () => {
    const antes = lista.map((x) => x.id);
    sortAssets(lista, "name");
    expect(lista.map((x) => x.id)).toEqual(antes);
  });
});

describe("slotStateFor / cardDisabledReason", () => {
  const r1 = asset({ id: "r1", name: "Uno" });
  const ctor = asset({ id: "ctor", kind: "constructor", name: "Ctor X" });
  const sinPrecio = asset({ id: "r3", name: "Tres", price: null });

  it("libre sin asignaciones", () => {
    expect(slotStateFor("gold-1", r1, SLOTS)).toBe("free");
    expect(cardDisabledReason(r1, "gold-1", SLOTS)).toBeNull();
  });

  it("seleccionado en el slot activo", () => {
    const slots = SLOTS.map((s) =>
      s.id === "gold-1" ? { ...s, value: "r1" } : s,
    );
    expect(slotStateFor("gold-1", r1, slots)).toBe("selected");
    expect(cardDisabledReason(r1, "gold-1", slots)).toBeNull();
  });

  it("ya en otro slot: deshabilitado con motivo", () => {
    const slots = SLOTS.map((s) =>
      s.id === "silver-1" ? { ...s, value: "r1" } : s,
    );
    expect(slotStateFor("gold-1", r1, slots)).toBe("in-other-slot");
    expect(cardDisabledReason(r1, "gold-1", slots)).toBe("Ya en otro slot");
    // El slot donde SÍ está sigue siendo su slot (no "ya en otro slot").
    expect(slotStateFor("silver-1", r1, slots)).toBe("selected");
    expect(cardDisabledReason(r1, "silver-1", slots)).toBeNull();
  });

  it("sin precio: deshabilitado, aunque esté libre", () => {
    expect(cardDisabledReason(sinPrecio, "gold-1", SLOTS)).toBe(
      "Sin precio para este GP",
    );
  });

  it("el tipo de slot no cruza: un constructor no 'ocupa' un slot de piloto", () => {
    const slots = SLOTS.map((s) =>
      s.id === "constructor" ? { ...s, value: "ctor" } : s,
    );
    expect(slotStateFor("gold-1", ctor, slots)).toBe("free");
    expect(slotStateFor("constructor", ctor, slots)).toBe("selected");
  });

  it("slot inexistente: free (defensivo)", () => {
    expect(slotStateFor("no-existe", r1, SLOTS)).toBe("free");
  });
});

describe("assignToSlot / clearSlot", () => {
  const r1 = asset({ id: "r1" });

  it("asigna al slot objetivo", () => {
    const next = assignToSlot(SLOTS, "gold-1", "r1");
    expect(next.find((s) => s.id === "gold-1")?.value).toBe("r1");
    // Inmutable: la lista original no cambia.
    expect(SLOTS.find((s) => s.id === "gold-1")?.value).toBe("");
  });

  it("reemplaza el valor previo del slot", () => {
    const previo = SLOTS.map((s) =>
      s.id === "gold-1" ? { ...s, value: "r2" } : s,
    );
    const next = assignToSlot(previo, "gold-1", "r1");
    expect(next.find((s) => s.id === "gold-1")?.value).toBe("r1");
  });

  it("mueve un piloto de otro slot (reasignación gratis): el origen queda vacío", () => {
    const previo = SLOTS.map((s) =>
      s.id === "silver-1" ? { ...s, value: "r1" } : s,
    );
    const next = assignToSlot(previo, "gold-1", "r1");
    expect(next.find((s) => s.id === "gold-1")?.value).toBe("r1");
    expect(next.find((s) => s.id === "silver-1")?.value).toBe("");
  });

  it("no toca slots de otro tipo aunque el id coincidiera (defensivo)", () => {
    const previo = SLOTS.map((s) =>
      s.id === "team" ? { ...s, value: "x9" } : s,
    );
    const next = assignToSlot(previo, "gold-1", "x9");
    expect(next.find((s) => s.id === "gold-1")?.value).toBe("x9");
    expect(next.find((s) => s.id === "team")?.value).toBe("x9");
  });

  it("slot inexistente o activo vacío: no cambia nada", () => {
    expect(assignToSlot(SLOTS, "no-existe", "r1").map((s) => s.value)).toEqual(
      SLOTS.map((s) => s.value),
    );
    expect(assignToSlot(SLOTS, "gold-1", "").map((s) => s.value)).toEqual(
      SLOTS.map((s) => s.value),
    );
  });

  it("clearSlot vacía solo ese slot", () => {
    const previo = SLOTS.map((s) =>
      s.id === "gold-1" ? { ...s, value: "r1" } : s,
    );
    const next = clearSlot(previo, "gold-1");
    expect(next.find((s) => s.id === "gold-1")?.value).toBe("");
    expect(next.find((s) => s.id === "gold-2")?.value).toBe("");
    void r1;
  });
});

describe("initialsOf (avatar sin dorsal)", () => {
  it("dos palabras: primera letra de cada una", () => {
    expect(initialsOf("Piloto Uno")).toBe("PU");
    expect(initialsOf("Álvaro B.")).toBe("ÁB"); // la tilde es parte del nombre
  });

  it("una palabra: dos primeras letras", () => {
    expect(initialsOf("Verdelli")).toBe("VE");
    expect(initialsOf("Mi")).toBe("MI");
  });

  it("espacios duplicados y extremos", () => {
    expect(initialsOf("  Uno   Dos ")).toBe("UD");
  });

  it("nombre vacío: guion", () => {
    expect(initialsOf("   ")).toBe("—");
  });
});

describe("assetHue / assetColor (color derivado determinístico)", () => {
  it("mismo nombre ⇒ mismo tono, siempre", () => {
    expect(assetHue("Piloto Uno")).toBe(assetHue("Piloto Uno"));
    expect(assetColor("Piloto Uno")).toBe(assetColor("Piloto Uno"));
  });

  it("tono dentro de [0, 360)", () => {
    for (const seed of [
      "A",
      "Piloto Uno",
      "Equipo Z",
      "Constructor X",
      "x".repeat(50),
    ]) {
      const hue = assetHue(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("nombres distintos suelen dar tonos distintos (sin colisión forzada)", () => {
    expect(assetHue("Piloto Uno")).not.toBe(assetHue("Equipo Z"));
  });

  it("el color es una especificación hsl() con saturación/lum fijos", () => {
    expect(assetColor("Piloto Uno")).toMatch(/^hsl\(\d+ 65% 55%\)$/);
  });
});
