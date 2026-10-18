/**
 * Tests de los schemas de entrada del módulo `seasons` (US-04 y US-05).
 *
 * - Payloads válidos (reglas PROVISIONAL, fechas opcionales) parsean.
 * - Payloads inválidos se rechazan con el motivo en español.
 */
import { describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../config/season-rules.js";
import {
  addRulesVersionInputSchema,
  addWeekendEventInputSchema,
  calendarGpSchema,
  createCircuitInputSchema,
  createGpInputSchema,
  createSeasonInputSchema,
  fetchCalendarInputSchema,
  gpIdInputSchema,
  importCalendarInputSchema,
  normalizedSeasonCalendarSchema,
  seasonIdInputSchema,
  updateGpLockoutInputSchema,
  updateGpStatusInputSchema,
} from "../seasons.js";

const SEASON_ID = "123e4567-e89b-42d3-a456-426614174000";
const GP_ID = "223e4567-e89b-42d3-a456-426614174001";

describe("createSeasonInputSchema (US-04)", () => {
  it("acepta una temporada válida con reglas PROVISIONAL", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "Temporada 2026",
      year: 2026,
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(true);
  });

  it("coerce las fechas a Date", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "Temporada 2026",
      year: 2026,
      startDate: "2026-02-28",
      endDate: "2026-11-08",
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it("rechaza un nombre vacío", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "",
      year: 2026,
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un año no entero o fuera de rango", () => {
    const base = { name: "T", rules: PROVISIONAL_SEASON_RULES };
    expect(createSeasonInputSchema.safeParse({ ...base, year: 2026.5 }).success).toBe(
      false,
    );
    expect(createSeasonInputSchema.safeParse({ ...base, year: 1899 }).success).toBe(
      false,
    );
    expect(createSeasonInputSchema.safeParse({ ...base, year: 2201 }).success).toBe(
      false,
    );
  });

  it("rechaza una fecha de fin anterior a la de inicio (motivo en endDate)", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "T",
      year: 2026,
      startDate: "2026-11-08",
      endDate: "2026-02-28",
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "endDate"),
      ).toBe(true);
    }
  });

  it("rechaza reglas inválidas (el motivo está bajo rules.*)", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "T",
      year: 2026,
      rules: {
        ...PROVISIONAL_SEASON_RULES,
        economy: { ...PROVISIONAL_SEASON_RULES.economy, B: -1 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "rules")).toBe(true);
    }
  });
});

describe("addRulesVersionInputSchema (US-04)", () => {
  it("acepta un uuid válido + reglas válidas", () => {
    const result = addRulesVersionInputSchema.safeParse({
      seasonId: SEASON_ID,
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un seasonId que no es uuid", () => {
    const result = addRulesVersionInputSchema.safeParse({
      seasonId: "no-uuid",
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza reglas inválidas", () => {
    const result = addRulesVersionInputSchema.safeParse({
      seasonId: SEASON_ID,
      rules: {
        ...PROVISIONAL_SEASON_RULES,
        league: { minMembers: 10, maxMembers: 5 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("seasonIdInputSchema (US-04)", () => {
  it("acepta un uuid y rechaza el resto", () => {
    expect(seasonIdInputSchema.safeParse({ seasonId: SEASON_ID }).success).toBe(true);
    expect(seasonIdInputSchema.safeParse({ seasonId: "abc" }).success).toBe(false);
    expect(seasonIdInputSchema.safeParse({}).success).toBe(false);
  });
});

// ── US-05: circuitos, GPs, eventos y calendario ───────────────────────────

describe("createCircuitInputSchema (US-05)", () => {
  it("acepta un circuito válido (location opcional)", () => {
    expect(
      createCircuitInputSchema.safeParse({
        name: "Circuito de Jerez",
        country: "España",
        location: "Jerez de la Frontera",
      }).success,
    ).toBe(true);
    expect(
      createCircuitInputSchema.safeParse({ name: "C1", country: "España" }).success,
    ).toBe(true);
    expect(
      createCircuitInputSchema.safeParse({
        name: "C2",
        country: "España",
        location: null,
      }).success,
    ).toBe(true);
  });

  it("rechaza nombre o país vacíos y longitudes excesivas", () => {
    expect(
      createCircuitInputSchema.safeParse({ name: "", country: "España" }).success,
    ).toBe(false);
    expect(
      createCircuitInputSchema.safeParse({ name: "C", country: "" }).success,
    ).toBe(false);
    expect(
      createCircuitInputSchema.safeParse({
        name: "x".repeat(161),
        country: "España",
      }).success,
    ).toBe(false);
  });
});

describe("createGpInputSchema (US-05)", () => {
  const base = {
    seasonId: SEASON_ID,
    round: 1,
    name: "GP de España",
    circuitId: GP_ID,
    date: "2026-04-19T14:00:00.000Z",
  };

  it("acepta Q2 + carrera (mínimo obligatorio)", () => {
    const result = createGpInputSchema.safeParse({
      ...base,
      events: [
        { type: "q2", startTime: "2026-04-18T12:00:00.000Z" },
        { type: "race" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeInstanceOf(Date);
      // `startTime` omitido (no enviado) queda `undefined`; el service lo
      // normaliza a `null` con `?? null`.
      expect(result.data.events[1]?.startTime).toBeUndefined();
    }
  });

  it("acepta los 4 eventos + lockoutAt opcional", () => {
    const result = createGpInputSchema.safeParse({
      ...base,
      lockoutAt: "2026-04-19T13:30:00.000Z",
      events: [
        { type: "q1", startTime: "2026-04-18T11:00:00.000Z" },
        { type: "q2", startTime: "2026-04-18T12:00:00.000Z" },
        { type: "sprint", startTime: "2026-04-18T14:00:00.000Z" },
        { type: "race", startTime: "2026-04-19T14:00:00.000Z" },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lockoutAt).toBeInstanceOf(Date);
    }
  });

  it("rechaza sin carrera (motivo en events)", () => {
    const result = createGpInputSchema.safeParse({
      ...base,
      events: [{ type: "q2" }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "events")).toBe(
        true,
      );
    }
  });

  it("rechaza sin Q2", () => {
    const result = createGpInputSchema.safeParse({
      ...base,
      events: [{ type: "q1" }, { type: "race" }],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza tipos de evento duplicados", () => {
    const result = createGpInputSchema.safeParse({
      ...base,
      events: [
        { type: "q2" },
        { type: "race" },
        { type: "race" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rechaza más de 4 eventos y una ronda fuera de rango", () => {
    expect(
      createGpInputSchema.safeParse({
        ...base,
        events: [
          { type: "q1" },
          { type: "q2" },
          { type: "sprint" },
          { type: "race" },
          { type: "q1" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createGpInputSchema.safeParse({
        ...base,
        round: 0,
        events: [{ type: "q2" }, { type: "race" }],
      }).success,
    ).toBe(false);
  });

  it("rechaza un tipo de evento desconocido", () => {
    const result = createGpInputSchema.safeParse({
      ...base,
      events: [{ type: "fp" }, { type: "race" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("addWeekendEventInputSchema (US-05)", () => {
  it("acepta gpId + tipo (startTime opcional)", () => {
    expect(
      addWeekendEventInputSchema.safeParse({
        gpId: GP_ID,
        type: "sprint",
        startTime: "2026-04-18T14:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      addWeekendEventInputSchema.safeParse({ gpId: GP_ID, type: "q1" }).success,
    ).toBe(true);
  });

  it("rechaza un gpId no-uuid o un tipo inválido", () => {
    expect(
      addWeekendEventInputSchema.safeParse({ gpId: "abc", type: "q1" }).success,
    ).toBe(false);
    expect(
      addWeekendEventInputSchema.safeParse({ gpId: GP_ID, type: "wup" }).success,
    ).toBe(false);
  });
});

describe("updateGpStatusInputSchema (US-05)", () => {
  it("acepta los 4 estados y rechaza el resto", () => {
    for (const status of ["scheduled", "locked", "finished", "cancelled"]) {
      expect(
        updateGpStatusInputSchema.safeParse({ gpId: GP_ID, status }).success,
      ).toBe(true);
    }
    expect(
      updateGpStatusInputSchema.safeParse({ gpId: GP_ID, status: "pending" }).success,
    ).toBe(false);
    expect(
      updateGpStatusInputSchema.safeParse({ gpId: "abc", status: "locked" }).success,
    ).toBe(false);
  });
});

describe("updateGpLockoutInputSchema (US-05)", () => {
  it("acepta una fecha (coerce a Date) y null (borrar)", () => {
    const withDate = updateGpLockoutInputSchema.safeParse({
      gpId: GP_ID,
      lockoutAt: "2026-04-19T13:30:00.000Z",
    });
    expect(withDate.success).toBe(true);
    if (withDate.success) {
      expect(withDate.data.lockoutAt).toBeInstanceOf(Date);
    }
    const cleared = updateGpLockoutInputSchema.safeParse({
      gpId: GP_ID,
      lockoutAt: null,
    });
    expect(cleared.success).toBe(true);
    if (cleared.success) {
      expect(cleared.data.lockoutAt).toBeNull();
    }
  });

  it("rechaza un gpId no-uuid y una fecha inválida", () => {
    expect(
      updateGpLockoutInputSchema.safeParse({ gpId: "abc", lockoutAt: null }).success,
    ).toBe(false);
    expect(
      updateGpLockoutInputSchema.safeParse({
        gpId: GP_ID,
        lockoutAt: "no-fecha",
      }).success,
    ).toBe(false);
  });
});

describe("gpIdInputSchema (US-05)", () => {
  it("acepta un uuid y rechaza el resto", () => {
    expect(gpIdInputSchema.safeParse({ gpId: GP_ID }).success).toBe(true);
    expect(gpIdInputSchema.safeParse({ gpId: "abc" }).success).toBe(false);
  });
});

describe("calendarGpSchema / normalizedSeasonCalendarSchema (US-05)", () => {
  const gp = {
    round: 1,
    name: "GP de Tailandia",
    circuit: { name: "Chang", country: "Tailandia", location: "Buriram" },
    date: "2026-03-01T13:00:00.000Z",
    events: [
      { type: "q2", startTime: "2026-02-28T12:45:00.000Z" },
      { type: "race", startTime: "2026-03-01T13:00:00.000Z" },
    ],
  };

  it("acepta un GP de calendario válido (location null admitida)", () => {
    expect(calendarGpSchema.safeParse(gp).success).toBe(true);
    const noLocation = calendarGpSchema.safeParse({
      ...gp,
      circuit: { name: "Chang", country: "Tailandia", location: null },
    });
    expect(noLocation.success).toBe(true);
  });

  it("rechaza un GP sin carrera o con eventos duplicados", () => {
    expect(
      calendarGpSchema.safeParse({
        ...gp,
        events: [{ type: "q2", startTime: null }],
      }).success,
    ).toBe(false);
    expect(
      calendarGpSchema.safeParse({
        ...gp,
        events: [
          { type: "q2" },
          { type: "race" },
          { type: "race" },
        ],
      }).success,
    ).toBe(false);
  });

  it("acepta un calendario completo y rechaza uno sin GPs", () => {
    const calendar = {
      year: 2026,
      seasonRef: "season-2026",
      source: { name: "pulselive", version: "v1" },
      gps: [gp],
    };
    const ok = normalizedSeasonCalendarSchema.safeParse(calendar);
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.gps[0]?.date).toBeInstanceOf(Date);
    }
    expect(
      normalizedSeasonCalendarSchema.safeParse({ ...calendar, gps: [] }).success,
    ).toBe(false);
  });

  it("rechaza un calendario con un GP inválido dentro", () => {
    const result = normalizedSeasonCalendarSchema.safeParse({
      year: 2026,
      seasonRef: "season-2026",
      source: { name: "pulselive", version: "v1" },
      gps: [{ ...gp, events: [{ type: "q2" }] }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "gps")).toBe(true);
    }
  });
});

describe("fetchCalendarInputSchema / importCalendarInputSchema (US-05)", () => {
  it("fetch: acepta un año válido y rechaza el resto", () => {
    expect(fetchCalendarInputSchema.safeParse({ year: 2026 }).success).toBe(true);
    expect(fetchCalendarInputSchema.safeParse({ year: 1899 }).success).toBe(false);
    expect(fetchCalendarInputSchema.safeParse({ year: 2026.5 }).success).toBe(false);
    expect(fetchCalendarInputSchema.safeParse({}).success).toBe(false);
  });

  it("import: acepta seasonId + calendario válido", () => {
    const result = importCalendarInputSchema.safeParse({
      seasonId: SEASON_ID,
      calendar: {
        year: 2026,
        seasonRef: "season-2026",
        source: { name: "pulselive", version: "v1" },
        gps: [
          {
            round: 1,
            name: "GP de Tailandia",
            circuit: { name: "Chang", country: "Tailandia" },
            date: "2026-03-01T13:00:00.000Z",
            events: [
              { type: "q2", startTime: "2026-02-28T12:45:00.000Z" },
              { type: "race", startTime: "2026-03-01T13:00:00.000Z" },
            ],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("import: rechaza un seasonId no-uuid o un calendario inválido", () => {
    expect(
      importCalendarInputSchema.safeParse({
        seasonId: "abc",
        calendar: {
          year: 2026,
          seasonRef: "s",
          source: { name: "n", version: "v" },
          gps: [],
        },
      }).success,
    ).toBe(false);
  });
});
