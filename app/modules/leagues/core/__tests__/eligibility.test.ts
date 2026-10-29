/** US-30 · Corte temporal de entrada a mitad de temporada (núcleo puro). */
import { describe, expect, it } from "vitest";

import { isMemberEligibleForGp, latestMembershipJoinedAt } from "../eligibility.js";

const joinedAt = new Date("2026-05-01T10:00:00Z");

describe("isMemberEligibleForGp (US-30, leagues.md §7)", () => {
  it("usa lockoutAt como inicio efectivo: solo es elegible si entra antes del cierre", () => {
    const gp = {
      date: new Date("2026-05-03T12:00:00Z"),
      lockoutAt: new Date("2026-05-01T11:00:00Z"),
    };
    expect(isMemberEligibleForGp(joinedAt, gp)).toBe(true);
    expect(isMemberEligibleForGp(new Date("2026-05-01T12:00:00Z"), gp)).toBe(false);
  });

  it("sin lockoutAt usa la fecha del GP", () => {
    const gp = { date: new Date("2026-05-03T12:00:00Z"), lockoutAt: null };
    expect(isMemberEligibleForGp(joinedAt, gp)).toBe(true);
    expect(isMemberEligibleForGp(new Date("2026-05-04T00:00:00Z"), gp)).toBe(false);
  });

  it("entrar exactamente en el cierre no habilita ese GP", () => {
    const lockoutAt = new Date("2026-05-01T10:00:00Z");
    expect(isMemberEligibleForGp(joinedAt, { date: new Date("2026-05-03T12:00:00Z"), lockoutAt })).toBe(false);
  });
});

describe("latestMembershipJoinedAt (ranking ajustado, US-30)", () => {
  it("devuelve la entrada más reciente, no la última del array", () => {
    const latest = new Date("2026-06-01T00:00:00Z");
    expect(
      latestMembershipJoinedAt([
        latest,
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-03-01T00:00:00Z"),
      ]),
    ).toEqual(latest);
  });

  it("sin miembros devuelve null", () => {
    expect(latestMembershipJoinedAt([])).toBeNull();
  });
});
