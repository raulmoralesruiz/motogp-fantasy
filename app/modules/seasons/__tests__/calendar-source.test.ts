/**
 * Tests de la fuente de calendario (US-05, ADR-0012).
 *
 * - `normalizePulseLiveCalendar`: función pura, testeada con fixtures que
 *   replican el formato verificado en vivo el 2026-10-18 (incluida la
 *   carrera reiniciada del GP de Cataluña 2026).
 * - `PulseLiveCalendarSource`: I/O fina con `fetchImpl` inyectado (sin
 *   red): pipeline completo, año inexistente, HTTP error, fallo de red y
 *   respuesta no JSON.
 */
import { describe, expect, it } from "vitest";

import {
  CalendarNormalizationError,
  normalizePulseLiveCalendar,
  PulseLiveCalendarSource,
  type PulseLiveEvent,
  type PulseLiveRawCalendar,
  type PulseLiveSession,
} from "../calendar-source";

const SOURCE = { name: "pulselive", version: "v1" };
const SEASON = { id: "season-2026", year: 2026 };

let sessionCounter = 0;
function makeSession(type: string, date: string | null): PulseLiveSession {
  sessionCounter += 1;
  return { id: `s-${sessionCounter}`, type, date };
}

function makeEvent(
  overrides: Partial<PulseLiveEvent> &
    Pick<PulseLiveEvent, "id" | "name" | "date_start" | "date_end">,
): PulseLiveEvent {
  return {
    circuit: { name: "Circuito Test", place: "Ciudad" },
    country: { name: "España" },
    ...overrides,
  };
}

/** GP completo: FP, PR, FP, Q, Q, SPR, WUP, RAC (formato 2026). */
function makeFullGp(): { event: PulseLiveEvent; sessions: PulseLiveSession[] } {
  const event = makeEvent({
    id: "ev-1",
    name: "GRAND PRIX OF THAILAND",
    date_start: "2026-02-27",
    date_end: "2026-03-01",
    circuit: { name: "Chang International Circuit", place: "Buriram" },
    country: { name: "Thailand" },
  });
  const sessions = [
    makeSession("FP", "2026-02-27T10:45:00+00:00"),
    makeSession("PR", "2026-02-27T12:00:00+00:00"),
    makeSession("FP", "2026-02-28T10:45:00+00:00"),
    makeSession("Q", "2026-02-28T12:00:00+00:00"),
    makeSession("Q", "2026-02-28T12:45:00+00:00"),
    makeSession("SPR", "2026-02-28T14:00:00+00:00"),
    makeSession("WUP", "2026-03-01T12:00:00+00:00"),
    makeSession("RAC", "2026-03-01T13:00:00+00:00"),
  ];
  return { event, sessions };
}

function makeRaw(
  events: PulseLiveEvent[],
  sessionsByEvent: Record<string, PulseLiveSession[]>,
): PulseLiveRawCalendar {
  return { season: SEASON, events, sessionsByEvent };
}

describe("normalizePulseLiveCalendar (US-05)", () => {
  it("mapea un GP completo a q1, q2, sprint y carrera (en orden canónico)", () => {
    const { event, sessions } = makeFullGp();
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], { [event.id]: sessions }),
      SOURCE,
    );

    expect(calendar).toMatchObject({
      year: 2026,
      seasonRef: "season-2026",
      source: SOURCE,
    });
    expect(calendar.gps).toHaveLength(1);
    const gp = calendar.gps[0];
    expect(gp).toBeDefined();
    expect(gp?.round).toBe(1);
    expect(gp?.name).toBe("GRAND PRIX OF THAILAND");
    expect(gp?.circuit).toEqual({
      name: "Chang International Circuit",
      country: "Thailand",
      location: "Buriram",
    });
    // La fecha del GP es la de la carrera (Date UTC, superjson-safe).
    expect(gp?.date).toEqual(new Date("2026-03-01T13:00:00.000Z"));
    expect(gp?.events).toEqual([
      { type: "q1", startTime: new Date("2026-02-28T12:00:00.000Z") },
      { type: "q2", startTime: new Date("2026-02-28T12:45:00.000Z") },
      { type: "sprint", startTime: new Date("2026-02-28T14:00:00.000Z") },
      { type: "race", startTime: new Date("2026-03-01T13:00:00.000Z") },
    ]);
  });

  it("una sola Q cuenta como Q2 (sin Q1)", () => {
    const event = makeEvent({
      id: "ev-q1",
      name: "GP UNICA Q",
      date_start: "2026-04-03",
      date_end: "2026-04-05",
    });
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], {
        [event.id]: [
          makeSession("Q", "2026-04-04T12:00:00+00:00"),
          makeSession("RAC", "2026-04-05T13:00:00+00:00"),
        ],
      }),
      SOURCE,
    );
    expect(calendar.gps[0]?.events).toEqual([
      { type: "q2", startTime: new Date("2026-04-04T12:00:00.000Z") },
      { type: "race", startTime: new Date("2026-04-05T13:00:00.000Z") },
    ]);
  });

  it("tres Q: las dos primeras por orden temporal son Q1 y Q2", () => {
    const event = makeEvent({
      id: "ev-q3",
      name: "GP TRES Q",
      date_start: "2026-04-10",
      date_end: "2026-04-12",
    });
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], {
        [event.id]: [
          makeSession("Q", "2026-04-11T10:00:00+00:00"),
          makeSession("Q", "2026-04-11T12:00:00+00:00"),
          makeSession("Q", "2026-04-11T14:00:00+00:00"),
          makeSession("RAC", "2026-04-12T13:00:00+00:00"),
        ],
      }),
      SOURCE,
    );
    expect(calendar.gps[0]?.events.map((e) => e.type)).toEqual(["q1", "q2", "race"]);
    expect(calendar.gps[0]?.events[0]?.startTime).toEqual(
      new Date("2026-04-11T10:00:00.000Z"),
    );
    expect(calendar.gps[0]?.events[1]?.startTime).toEqual(
      new Date("2026-04-11T12:00:00.000Z"),
    );
  });

  it("carrera reiniciada (dos RAC): la última por fecha es la válida (caso Cataluña 2026)", () => {
    const event = makeEvent({
      id: "ev-cat",
      name: "GRAND PRIX OF CATALONIA",
      date_start: "2026-05-15",
      date_end: "2026-05-17",
    });
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], {
        [event.id]: [
          makeSession("Q", "2026-05-16T12:00:00+00:00"),
          makeSession("Q", "2026-05-16T12:45:00+00:00"),
          makeSession("RAC", "2026-05-17T14:00:00+00:00"),
          makeSession("RAC", "2026-05-17T15:17:00+00:00"),
        ],
      }),
      SOURCE,
    );
    const gp = calendar.gps[0];
    expect(gp?.events.find((e) => e.type === "race")?.startTime).toEqual(
      new Date("2026-05-17T15:17:00.000Z"),
    );
    expect(gp?.date).toEqual(new Date("2026-05-17T15:17:00.000Z"));
  });

  it("varios sprints: la última por fecha", () => {
    const event = makeEvent({
      id: "ev-spr",
      name: "GP DOS SPRINTS",
      date_start: "2026-06-05",
      date_end: "2026-06-07",
    });
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], {
        [event.id]: [
          makeSession("Q", "2026-06-06T12:00:00+00:00"),
          makeSession("SPR", "2026-06-06T14:00:00+00:00"),
          makeSession("SPR", "2026-06-06T15:30:00+00:00"),
          makeSession("RAC", "2026-06-07T13:00:00+00:00"),
        ],
      }),
      SOURCE,
    );
    expect(calendar.gps[0]?.events.find((e) => e.type === "sprint")?.startTime).toEqual(
      new Date("2026-06-06T15:30:00.000Z"),
    );
  });

  it("excluye los eventos de test (test: true)", () => {
    const testEvent = makeEvent({
      id: "ev-test",
      name: "TEST DAY",
      date_start: "2026-02-20",
      date_end: "2026-02-21",
      test: true,
    });
    const { event, sessions } = makeFullGp();
    const calendar = normalizePulseLiveCalendar(
      makeRaw([testEvent, event], { [event.id]: sessions }),
      SOURCE,
    );
    expect(calendar.gps).toHaveLength(1);
    expect(calendar.gps[0]?.name).toBe("GRAND PRIX OF THAILAND");
    expect(calendar.gps[0]?.round).toBe(1);
  });

  it("deriva la ronda del orden por date_start", () => {
    const b = makeEvent({
      id: "ev-b",
      name: "GP B",
      date_start: "2026-03-20",
      date_end: "2026-03-22",
    });
    const a = makeEvent({
      id: "ev-a",
      name: "GP A",
      date_start: "2026-03-06",
      date_end: "2026-03-08",
    });
    // Se pasan desordenados: el normalizador debe ordenar por date_start.
    const calendar = normalizePulseLiveCalendar(
      makeRaw([b, a], {
        [a.id]: [
          makeSession("Q", "2026-03-07T12:00:00+00:00"),
          makeSession("RAC", "2026-03-08T13:00:00+00:00"),
        ],
        [b.id]: [
          makeSession("Q", "2026-03-21T12:00:00+00:00"),
          makeSession("RAC", "2026-03-22T13:00:00+00:00"),
        ],
      }),
      SOURCE,
    );
    expect(calendar.gps.map((gp) => [gp.round, gp.name])).toEqual([
      [1, "GP A"],
      [2, "GP B"],
    ]);
  });

  it("GP sin carrera → CalendarNormalizationError (con el nombre del GP)", () => {
    const event = makeEvent({
      id: "ev-norace",
      name: "GP SIN CARRERA",
      date_start: "2026-07-03",
      date_end: "2026-07-05",
    });
    expect(() =>
      normalizePulseLiveCalendar(
        makeRaw([event], {
          [event.id]: [makeSession("Q", "2026-07-04T12:00:00+00:00")],
        }),
        SOURCE,
      ),
    ).toThrowError(CalendarNormalizationError);
    expect(() =>
      normalizePulseLiveCalendar(
        makeRaw([event], {
          [event.id]: [makeSession("Q", "2026-07-04T12:00:00+00:00")],
        }),
        SOURCE,
      ),
    ).toThrowError(/GP SIN CARRERA/);
  });

  it("GP sin Q2 → CalendarNormalizationError", () => {
    const event = makeEvent({
      id: "ev-noq",
      name: "GP SIN Q",
      date_start: "2026-07-10",
      date_end: "2026-07-12",
    });
    expect(() =>
      normalizePulseLiveCalendar(
        makeRaw([event], {
          [event.id]: [makeSession("RAC", "2026-07-12T13:00:00+00:00")],
        }),
        SOURCE,
      ),
    ).toThrowError(/Q2/);
  });

  it("sin eventos → CalendarNormalizationError", () => {
    expect(() => normalizePulseLiveCalendar(makeRaw([], {}), SOURCE)).toThrowError(
      /no tiene eventos/,
    );
  });

  it("solo eventos de test → CalendarNormalizationError", () => {
    const testEvent = makeEvent({
      id: "ev-test2",
      name: "TEST DAY",
      date_start: "2026-02-20",
      date_end: "2026-02-21",
      test: true,
    });
    expect(() =>
      normalizePulseLiveCalendar(makeRaw([testEvent], {}), SOURCE),
    ).toThrowError(CalendarNormalizationError);
  });

  it("circuito sin place → location null", () => {
    const event = makeEvent({
      id: "ev-noloc",
      name: "GP SIN LUGAR",
      date_start: "2026-08-07",
      date_end: "2026-08-09",
      circuit: { name: "Circuito Sin Lugar" },
    });
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], {
        [event.id]: [
          makeSession("Q", "2026-08-08T12:00:00+00:00"),
          makeSession("RAC", "2026-08-09T13:00:00+00:00"),
        ],
      }),
      SOURCE,
    );
    expect(calendar.gps[0]?.circuit.location).toBeNull();
  });

  it("carrera sin fecha → fallback a date_end (UTC medianoche)", () => {
    const event = makeEvent({
      id: "ev-fallback",
      name: "GP FECA FALLA",
      date_start: "2026-08-14",
      date_end: "2026-08-16",
    });
    const calendar = normalizePulseLiveCalendar(
      makeRaw([event], {
        [event.id]: [
          makeSession("Q", "2026-08-15T12:00:00+00:00"),
          makeSession("RAC", null),
        ],
      }),
      SOURCE,
    );
    expect(calendar.gps[0]?.date).toEqual(new Date("2026-08-16T00:00:00.000Z"));
    expect(calendar.gps[0]?.events.find((e) => e.type === "race")?.startTime).toBeNull();
  });

  it("fecha de sesión inválida → CalendarNormalizationError", () => {
    const event = makeEvent({
      id: "ev-baddate",
      name: "GP FECHA MALA",
      date_start: "2026-09-11",
      date_end: "2026-09-13",
    });
    expect(() =>
      normalizePulseLiveCalendar(
        makeRaw([event], {
          [event.id]: [
            makeSession("Q", "no-es-una-fecha"),
            makeSession("RAC", "2026-09-13T13:00:00+00:00"),
          ],
        }),
        SOURCE,
      ),
    ).toThrowError(/fecha inválida/);
  });

  it("date_end inválido → CalendarNormalizationError (aunque la carrera tenga fecha)", () => {
    // El fallback a `date_end` se calcula para cada evento: si es inválido
    // lanza aunque la carrera tenga fecha válida.
    const event = makeEvent({
      id: "ev-badend",
      name: "GP FIN MALO",
      date_start: "2026-09-18",
      date_end: "no-es-una-fecha",
    });
    expect(() =>
      normalizePulseLiveCalendar(
        makeRaw([event], {
          [event.id]: [
            makeSession("Q", "2026-09-19T12:00:00+00:00"),
            makeSession("RAC", "2026-09-20T13:00:00+00:00"),
          ],
        }),
        SOURCE,
      ),
    ).toThrowError(/fecha inválida/);
  });
});

// ── PulseLiveCalendarSource (I/O con fetch inyectado, sin red) ────────────

interface FakeRoute {
  match: string;
  body?: unknown;
  status?: number;
  networkError?: boolean;
  notJson?: boolean;
}

function fakeFetch(routes: FakeRoute[]): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`URL no esperada en el test: ${url}`);
    if (route.networkError) throw new Error("network down");
    if (route.notJson) {
      return new Response("esto no es JSON", { status: 200 });
    }
    return new Response(JSON.stringify(route.body ?? []), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const SEASONS_BODY = [
  { id: "season-2025", year: 2025, current: false },
  { id: "season-2026", year: 2026, current: true },
];
const CATEGORIES_BODY = [
  { id: "cat-moto3", name: "Moto3™", legacy_id: 1 },
  { id: "cat-moto2", name: "Moto2™", legacy_id: 2 },
  { id: "cat-moto-gp", name: "MotoGP™", legacy_id: 3 },
];

function fullPipelineRoutes(): FakeRoute[] {
  const { event, sessions } = makeFullGp();
  return [
    { match: "/results/seasons", body: SEASONS_BODY },
    { match: "/results/categories", body: CATEGORIES_BODY },
    { match: "/results/events", body: [event] },
    { match: "/results/sessions", body: sessions },
  ];
}

describe("PulseLiveCalendarSource (US-05)", () => {
  it("recorre el pipeline completo: temporada → categoría → eventos → sesiones", async () => {
    const { fetchImpl, calls } = fakeFetch(fullPipelineRoutes());
    const source = new PulseLiveCalendarSource({
      baseUrl: "https://fake.test/v1",
      fetchImpl,
    });

    const calendar = await source.fetchSeasonCalendar(2026);

    expect(calendar.year).toBe(2026);
    expect(calendar.seasonRef).toBe("season-2026");
    expect(calendar.source).toEqual({ name: "pulselive", version: "v1" });
    expect(calendar.gps).toHaveLength(1);
    expect(calendar.gps[0]?.name).toBe("GRAND PRIX OF THAILAND");

    // La categoría MotoGP se descubre por legacy_id 3 (no se hardcodea el UUID).
    expect(calls.some((url) => url.includes("categoryUuid=cat-moto-gp"))).toBe(true);
    // Las sesiones se piden por evento.
    expect(calls.some((url) => url.includes(`eventUuid=${"ev-1"}`))).toBe(true);
  });

  it("año sin temporada → CalendarSourceError", async () => {
    const { fetchImpl } = fakeFetch(fullPipelineRoutes());
    const source = new PulseLiveCalendarSource({ fetchImpl });
    await expect(source.fetchSeasonCalendar(2024)).rejects.toThrowError(
      /no tiene temporada para el año 2024/,
    );
  });

  it("sin categoría MotoGP (legacy_id 3) → CalendarSourceError", async () => {
    const { fetchImpl } = fakeFetch([
      { match: "/results/seasons", body: SEASONS_BODY },
      {
        match: "/results/categories",
        body: CATEGORIES_BODY.filter((c) => c.legacy_id !== 3),
      },
    ]);
    const source = new PulseLiveCalendarSource({ fetchImpl });
    await expect(source.fetchSeasonCalendar(2026)).rejects.toThrowError(
      /categoría MotoGP/,
    );
  });

  it("respuesta HTTP error → CalendarSourceError con el código", async () => {
    const { fetchImpl } = fakeFetch([
      { match: "/results/seasons", status: 503, body: { details: "down" } },
    ]);
    const source = new PulseLiveCalendarSource({ fetchImpl });
    await expect(source.fetchSeasonCalendar(2026)).rejects.toThrowError(/HTTP 503/);
  });

  it("fallo de red → CalendarSourceError", async () => {
    const { fetchImpl } = fakeFetch([{ match: "/results/seasons", networkError: true }]);
    const source = new PulseLiveCalendarSource({ fetchImpl });
    await expect(source.fetchSeasonCalendar(2026)).rejects.toThrowError(
      /No se pudo contactar/,
    );
  });

  it("respuesta no JSON → CalendarSourceError", async () => {
    const { fetchImpl } = fakeFetch([{ match: "/results/seasons", notJson: true }]);
    const source = new PulseLiveCalendarSource({ fetchImpl });
    await expect(source.fetchSeasonCalendar(2026)).rejects.toThrowError(/no JSON/);
  });

  it("datos crudos inválidos (GP sin carrera) → CalendarNormalizationError", async () => {
    const event = makeEvent({
      id: "ev-bad",
      name: "GP MALO",
      date_start: "2026-09-04",
      date_end: "2026-09-06",
    });
    const { fetchImpl } = fakeFetch([
      { match: "/results/seasons", body: SEASONS_BODY },
      { match: "/results/categories", body: CATEGORIES_BODY },
      { match: "/results/events", body: [event] },
      {
        match: "/results/sessions",
        body: [makeSession("Q", "2026-09-05T12:00:00+00:00")],
      },
    ]);
    const source = new PulseLiveCalendarSource({ fetchImpl });
    await expect(source.fetchSeasonCalendar(2026)).rejects.toThrowError(
      CalendarNormalizationError,
    );
  });
});
