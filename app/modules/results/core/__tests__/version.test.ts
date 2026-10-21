/**
 * Tests del versionado de resultados (`rv-<seq>`) — núcleo puro, ADR-0018.
 */
import { describe, expect, it } from "vitest";

import { nextResultsVersion, parseResultsVersion } from "../version.js";

describe("parseResultsVersion", () => {
  it("parsea rv-<seq>", () => {
    expect(parseResultsVersion("rv-1")).toBe(1);
    expect(parseResultsVersion("rv-42")).toBe(42);
  });

  it("devuelve null para formatos no reconocibles", () => {
    expect(parseResultsVersion("")).toBeNull();
    expect(parseResultsVersion("rv-")).toBeNull();
    expect(parseResultsVersion("rv-a")).toBeNull();
    expect(parseResultsVersion("v-1")).toBeNull();
    expect(parseResultsVersion("rv-1-extra")).toBeNull();
  });
});

describe("nextResultsVersion — alcance por GP (ADR-0018)", () => {
  it("sin versión → rv-1", () => {
    expect(nextResultsVersion(null)).toBe("rv-1");
  });

  it("rv-1 → rv-2", () => {
    expect(nextResultsVersion("rv-1")).toBe("rv-2");
  });

  it("rv-42 → rv-43", () => {
    expect(nextResultsVersion("rv-42")).toBe("rv-43");
  });

  it("lanza si la versión actual no es reconocible (no se reinicia en silencio)", () => {
    expect(() => nextResultsVersion("v-1")).toThrow(/results_version no reconocible/);
  });
});
