/**
 * Tests de los schemas de entrada del módulo `results` (US-16, ADR-0018).
 *
 * - Entradas coherentes `started`/`finished`/`position` parsean.
 * - Entradas incoherentes o con códigos duplicados se rechazan con el
 *   motivo en español.
 */
import { describe, expect, it } from "vitest";

import {
  eventResultsInputSchema,
  gpEventsInputSchema,
  importEventInputSchema,
  resultEntrySchema,
} from "../results.js";

const RIDER_ID = "123e4567-e89b-42d3-a456-426614174000";
const GP_ID = "223e4567-e89b-42d3-a456-426614174001";
const EVENT_ID = "323e4567-e89b-42d3-a456-426614174002";

const finishedEntry = {
  riderId: RIDER_ID,
  position: 1,
  started: true,
  finished: true,
  penalties: [],
  bonuses: [],
  rawPoints: null,
};

describe("resultEntrySchema (ADR-0018)", () => {
  it("acepta un piloto terminado con posición", () => {
    expect(resultEntrySchema.safeParse(finishedEntry).success).toBe(true);
  });

  it("acepta un DNF (salió, no terminó, sin posición)", () => {
    const entry = { ...finishedEntry, position: null, finished: false };
    expect(resultEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("acepta un no partícipe (no salió, sin posición)", () => {
    const entry = { ...finishedEntry, position: null, started: false, finished: false };
    expect(resultEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("acepta códigos de bono y penalización del vocabulario", () => {
    const entry = {
      ...finishedEntry,
      position: 3,
      penalties: ["dq", "time-penalty"],
      bonuses: ["fastest-lap"],
    };
    expect(resultEntrySchema.safeParse(entry).success).toBe(true);
  });

  it("acepta rawPoints nulo o dentro de 0–1000", () => {
    expect(resultEntrySchema.safeParse({ ...finishedEntry, rawPoints: null }).success).toBe(true);
    expect(resultEntrySchema.safeParse({ ...finishedEntry, rawPoints: 25.5 }).success).toBe(true);
  });

  it("rechaza posición 0 o no entera", () => {
    const zero = resultEntrySchema.safeParse({ ...finishedEntry, position: 0 });
    expect(zero.success).toBe(false);
    const frac = resultEntrySchema.safeParse({ ...finishedEntry, position: 1.5 });
    expect(frac.success).toBe(false);
  });

  it("rechaza un piloto que no salió pero terminó", () => {
    const entry = { ...finishedEntry, started: false };
    const result = resultEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Un piloto que no salió no puede haber terminado")).toBe(true);
    }
  });

  it("rechaza un DNF con posición", () => {
    const entry = { ...finishedEntry, finished: false };
    const result = resultEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Solo un piloto que terminó tiene posición")).toBe(true);
    }
  });

  it("rechaza un piloto terminado sin posición", () => {
    const entry = { ...finishedEntry, position: null };
    const result = resultEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Un piloto que terminó necesita posición")).toBe(true);
    }
  });

  it("rechaza códigos duplicados en la misma entrada", () => {
    const entry = { ...finishedEntry, penalties: ["dq", "dq"] };
    const result = resultEntrySchema.safeParse(entry);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Cada código de bono o penalización aparece una sola vez")).toBe(true);
    }
  });

  it("rechaza un código fuera del vocabulario", () => {
    const entry = { ...finishedEntry, bonuses: ["winner" as never] };
    expect(resultEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("rechaza rawPoints negativo o superior a 1000", () => {
    expect(resultEntrySchema.safeParse({ ...finishedEntry, rawPoints: -1 }).success).toBe(false);
    expect(resultEntrySchema.safeParse({ ...finishedEntry, rawPoints: 1001 }).success).toBe(false);
  });

  it("rechaza un riderId que no es uuid", () => {
    const entry = { ...finishedEntry, riderId: "no-es-uuid" };
    expect(resultEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe("importEventInputSchema (US-16)", () => {
  const base = { gpId: GP_ID, eventId: EVENT_ID, entries: [finishedEntry] };

  it("acepta una importación válida", () => {
    expect(importEventInputSchema.safeParse(base).success).toBe(true);
  });

  it("acepta `reason` opcional con 3+ caracteres", () => {
    expect(importEventInputSchema.safeParse({ ...base, reason: "corrección de la parrilla" }).success).toBe(true);
  });

  it("rechaza `reason` de menos de 3 caracteres", () => {
    const result = importEventInputSchema.safeParse({ ...base, reason: "ab" });
    expect(result.success).toBe(false);
  });

  it("rechaza una importación sin entradas", () => {
    const result = importEventInputSchema.safeParse({ ...base, entries: [] });
    expect(result.success).toBe(false);
  });

  it("rechaza más de 100 entradas", () => {
    const entries = Array.from({ length: 101 }, (_, i) => ({
      ...finishedEntry,
      riderId: `423e4567-e89b-42d3-a456-42661417${String(4000 + i).padStart(4, "0")}`,
    }));
    const result = importEventInputSchema.safeParse({ ...base, entries });
    expect(result.success).toBe(false);
  });

  it("rechaza pilotos repetidos en el payload", () => {
    const entries = [finishedEntry, { ...finishedEntry, position: 2 }];
    const result = importEventInputSchema.safeParse({ ...base, entries });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Hay pilotos repetidos en los resultados")).toBe(true);
    }
  });

  it("rechaza gpId/eventId inválidos", () => {
    expect(importEventInputSchema.safeParse({ ...base, gpId: "x" }).success).toBe(false);
    expect(importEventInputSchema.safeParse({ ...base, eventId: "x" }).success).toBe(false);
  });
});

describe("gpEventsInputSchema y eventResultsInputSchema (UI de admin)", () => {
  it("acepta un gpId válido", () => {
    expect(gpEventsInputSchema.safeParse({ gpId: GP_ID }).success).toBe(true);
  });

  it("rechaza un gpId inválido", () => {
    expect(gpEventsInputSchema.safeParse({ gpId: "x" }).success).toBe(false);
  });

  it("acepta gpId + eventId válidos", () => {
    expect(eventResultsInputSchema.safeParse({ gpId: GP_ID, eventId: EVENT_ID }).success).toBe(true);
  });

  it("rechaza un eventId inválido", () => {
    expect(eventResultsInputSchema.safeParse({ gpId: GP_ID, eventId: "x" }).success).toBe(false);
  });
});
