import { describe, expect, it } from "vitest";

import { defaultGpId } from "../gp-default";

const gp = (id: string, round: number, status: string) => ({ id, round, status });

describe("defaultGpId (S2 P3 #2: último GP con datos)", () => {
  it("prefiere el último GP finalizado (mayor ronda) sobre el programado", () => {
    expect(
      defaultGpId([
        gp("gp-1", 1, "scheduled"),
        gp("gp-2", 2, "finished"),
      ]),
    ).toBe("gp-2");
  });

  it("elige el finalizado de mayor ronda si hay varios finalizados", () => {
    expect(
      defaultGpId([
        gp("gp-1", 1, "finished"),
        gp("gp-2", 2, "finished"),
        gp("gp-3", 3, "scheduled"),
      ]),
    ).toBe("gp-2");
  });

  it("sin GPs finalizados, cae al primer programado por ronda", () => {
    expect(
      defaultGpId([
        gp("gp-3", 3, "scheduled"),
        gp("gp-1", 1, "scheduled"),
      ]),
    ).toBe("gp-1");
  });

  it("sin finalizados ni programados (p. ej. todos cancelados) → null", () => {
    expect(defaultGpId([gp("gp-1", 1, "cancelled")])).toBeNull();
  });

  it("un GP `locked` (carrera en curso) no es default; cae al programado", () => {
    expect(
      defaultGpId([
        gp("gp-1", 1, "locked"),
        gp("gp-2", 2, "scheduled"),
      ]),
    ).toBe("gp-2");
  });

  it("solo `locked` (sin finalizados ni programados) → null", () => {
    expect(defaultGpId([gp("gp-1", 1, "locked")])).toBeNull();
  });

  it("lista vacía → null", () => {
    expect(defaultGpId([])).toBeNull();
  });
});
