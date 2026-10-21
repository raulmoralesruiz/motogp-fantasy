/**
 * Tests de la derivación del estado de puntuación — núcleo puro, ADR-0018.
 */
import { describe, expect, it } from "vitest";

import { deriveStatus } from "../status.js";

describe("deriveStatus — estado derivado de started/finished", () => {
  it("finished → FINISHED", () => {
    expect(deriveStatus({ started: true, finished: true })).toBe("FINISHED");
  });

  it("started ∧ ¬finished → DNF", () => {
    expect(deriveStatus({ started: true, finished: false })).toBe("DNF");
  });

  it("¬started → ABSENT (no partícipe)", () => {
    expect(deriveStatus({ started: false, finished: false })).toBe("ABSENT");
  });
});
