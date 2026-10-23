/**
 * Tests de la I/O de la fuente de resultados PulseLive (US-17, ADR-0019).
 *
 * `PulseLiveResultsSource` con `fetchImpl` inyectado (sin red): cadena de
 * URLs, gate de sesión, resolución del vínculo (DI), descubrimiento de
 * temporada/categoría con caché, catálogo de eventos, `fetchGpStatus` y
 * errores de red/HTTP/formato. Las funciones puras del mismo módulo
 * (`normalizePulseLiveClassification`, `selectPulseLiveSession`) están en
 * `pulselive-source.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  PulseLiveResultsSource,
  PulseLiveSourceError,
  ResultsNormalizationError,
  SourceNotLinkedError,
  SourceSessionNotFinishedError,
  type EventRefResolution,
  type EventRefResolver,
} from "../pulselive-source";

// ── Fake de fetch (sin red; mismo patrón que calendar-source.test.ts) ─────

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

const BASE_URL = "https://fuente.test/v1";
const GP_NAME = "GP de Indonesia";

const SEASONS_BODY = [
  { id: "season-2025", year: 2025 },
  { id: "season-2026", year: 2026 },
];
const CATEGORIES_BODY = [
  { id: "cat-moto2", legacy_id: 2 },
  { id: "cat-moto-gp", legacy_id: 3 },
];

const RESOLVED: EventRefResolution = {
  seasonYear: 2026,
  eventRef: "ev-1",
  gpName: GP_NAME,
};

const RAC_SESSIONS = [
  { id: "s-rac", type: "RAC", date: "2026-09-06T08:00:00Z", status: "FINISHED" },
];

const RACE_CLASSIFICATION = {
  classification: [
    {
      position: 1,
      status: "INSTND",
      points: 25,
      rider: { riders_id: "rid-1", full_name: "Piloto Uno" },
    },
    {
      position: null,
      status: "OUTSTND",
      rider: { riders_id: "rid-2", full_name: "Piloto Dos" },
    },
  ],
  records: [
    { type: "fastestLap", rider: { riders_id: "rid-1", full_name: "Piloto Uno" } },
  ],
};

function baseRoutes(): FakeRoute[] {
  return [
    { match: "/results/seasons", body: SEASONS_BODY },
    { match: "/results/categories", body: CATEGORIES_BODY },
  ];
}

function makeSourceWithCalls(
  routes: FakeRoute[],
  resolver: EventRefResolver = async () => RESOLVED,
): { source: PulseLiveResultsSource; calls: string[] } {
  const { fetchImpl, calls } = fakeFetch(routes);
  return {
    source: new PulseLiveResultsSource({
      baseUrl: BASE_URL,
      fetchImpl,
      eventRefResolver: resolver,
    }),
    calls,
  };
}

describe("PulseLiveResultsSource — I/O con fetchImpl inyectado (US-17, ADR-0019)", () => {
  it("ctor por defecto: fail-closed (resolver por defecto → GP no encontrado)", async () => {
    const source = new PulseLiveResultsSource();
    await expect(source.fetchEventResults("gp-x", "race")).rejects.toBeInstanceOf(
      PulseLiveSourceError,
    );
    await expect(source.fetchEventResults("gp-x", "race")).rejects.toThrow(
      "El GP «gp-x» no se encontró en la base de datos.",
    );
  });

  it("meta: pulselive v1, sin autorización explícita", () => {
    const source = new PulseLiveResultsSource();
    expect(source.meta).toEqual({
      name: "pulselive",
      version: "v1",
      authorized: false,
    });
  });

  describe("fetchEventResults", () => {
    it("race: cadena de URLs seasons → categories → sessions → classification", async () => {
      const { source, calls } = makeSourceWithCalls([
        ...baseRoutes(),
        { match: "/results/sessions", body: RAC_SESSIONS },
        { match: "/results/classification", body: RACE_CLASSIFICATION },
      ]);

      const result = await source.fetchEventResults("gp-1", "race");

      expect(calls).toEqual([
        `${BASE_URL}/results/seasons`,
        `${BASE_URL}/results/categories?seasonUuid=season-2026`,
        `${BASE_URL}/results/sessions?eventUuid=ev-1&categoryUuid=cat-moto-gp`,
        `${BASE_URL}/results/classification?sessionUuid=s-rac&categoryUuid=cat-moto-gp`,
      ]);
      expect(result).toMatchObject({
        event: "race",
        status: "provisional",
        sourceVersion: "v1",
      });
      expect(result.fetchedAt).toBeInstanceOf(Date);
    });

    it("race: normaliza entradas y otorga fastest-lap al piloto de records", async () => {
      const { source } = makeSourceWithCalls([
        ...baseRoutes(),
        { match: "/results/sessions", body: RAC_SESSIONS },
        { match: "/results/classification", body: RACE_CLASSIFICATION },
      ]);

      const result = await source.fetchEventResults("gp-1", "race");

      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]).toMatchObject({
        riderRef: "rid-1",
        position: 1,
        started: true,
        finished: true,
        penalties: [],
        bonuses: ["fastest-lap"],
        rawPoints: 25,
      });
      // raw: payload original de la entrada (auditoría).
      expect(result.entries[0]?.raw).toMatchObject({
        position: 1,
        status: "INSTND",
        rider: { riders_id: "rid-1", full_name: "Piloto Uno" },
      });
      expect(result.entries[1]).toMatchObject({
        riderRef: "rid-2",
        position: null,
        started: true,
        finished: false,
        bonuses: [],
        rawPoints: null,
      });
    });

    it("q2: pole (posición 1) con bono «pole»", async () => {
      const { source } = makeSourceWithCalls([
        ...baseRoutes(),
        {
          match: "/results/sessions",
          body: [
            { id: "s-q", type: "Q", date: "2026-09-05T08:00:00Z", status: "FINISHED" },
          ],
        },
        {
          match: "/results/classification",
          body: {
            classification: [
              {
                position: 1,
                status: "INSTND",
                rider: { riders_id: "rid-1", full_name: "Piloto Uno" },
              },
              {
                position: 2,
                status: "INSTND",
                rider: { riders_id: "rid-2", full_name: "Piloto Dos" },
              },
            ],
            records: [],
          },
        },
      ]);

      const result = await source.fetchEventResults("gp-1", "q2");

      expect(result.entries[0]).toMatchObject({ riderRef: "rid-1", bonuses: ["pole"] });
      expect(result.entries[1]).toMatchObject({ riderRef: "rid-2", bonuses: [] });
    });

    it("sesión no terminada: SourceSessionNotFinishedError y no fetchea clasificación", async () => {
      const { source, calls } = makeSourceWithCalls([
        ...baseRoutes(),
        {
          match: "/results/sessions",
          body: [
            { id: "s-rac", type: "RAC", date: "2026-09-06T08:00:00Z", status: "NOT-STARTED" },
          ],
        },
        { match: "/results/classification", body: RACE_CLASSIFICATION },
      ]);

      await expect(source.fetchEventResults("gp-1", "race")).rejects.toBeInstanceOf(
        SourceSessionNotFinishedError,
      );
      await expect(source.fetchEventResults("gp-1", "race")).rejects.toThrow(
        "La sesión RAC del GP «GP de Indonesia» no ha terminado (estado de la fuente: NOT-STARTED); se reintentará.",
      );
      expect(calls.some((url) => url.includes("/results/classification"))).toBe(false);
      // 2 llamadas: seasons+categories cacheadas (1ª) y sessions re-fetcheada
      // en cada intento (no cacheada, el estado puede cambiar).
      expect(calls).toHaveLength(4);
    });

    it("resolver null: «El GP … no se encontró en la base de datos.» (sin fetch)", async () => {
      const { source, calls } = makeSourceWithCalls([], async () => null);

      await expect(source.fetchEventResults("gp-x", "race")).rejects.toBeInstanceOf(
        PulseLiveSourceError,
      );
      await expect(source.fetchEventResults("gp-x", "race")).rejects.toThrow(
        "El GP «gp-x» no se encontró en la base de datos.",
      );
      expect(calls).toHaveLength(0);
    });

    it("eventRef null: SourceNotLinkedError con el nombre del GP (sin fetch)", async () => {
      const { source, calls } = makeSourceWithCalls(
        [],
        async () => ({ seasonYear: 2026, eventRef: null, gpName: "GP Sin Vínculo" }),
      );

      await expect(source.fetchEventResults("gp-x", "race")).rejects.toBeInstanceOf(
        SourceNotLinkedError,
      );
      await expect(source.fetchEventResults("gp-x", "race")).rejects.toThrow(
        "El GP «GP Sin Vínculo» no está vinculado a un evento de la fuente; vincúlalo con results.linkSource (ADR-0019).",
      );
      expect(calls).toHaveLength(0);
    });

    it("sin temporada para el año: error con el año", async () => {
      const { source } = makeSourceWithCalls([
        { match: "/results/seasons", body: [{ id: "season-2025", year: 2025 }] },
      ]);

      await expect(source.fetchEventResults("gp-1", "race")).rejects.toThrow(
        "La fuente no tiene temporada para el año 2026.",
      );
    });

    it("sin categoría MotoGP (legacy_id ≠ 3): error con la temporada", async () => {
      const { source } = makeSourceWithCalls([
        { match: "/results/seasons", body: SEASONS_BODY },
        { match: "/results/categories", body: [{ id: "cat-moto2", legacy_id: 2 }] },
      ]);

      await expect(source.fetchEventResults("gp-1", "race")).rejects.toThrow(
        "La fuente no tiene la categoría MotoGP para la temporada 2026.",
      );
    });

    it("descubrimiento con caché: 2 fetchEventResults → 1 fetch de seasons/categories", async () => {
      const { source, calls } = makeSourceWithCalls([
        ...baseRoutes(),
        { match: "/results/sessions", body: RAC_SESSIONS },
        { match: "/results/classification", body: RACE_CLASSIFICATION },
      ]);

      await source.fetchEventResults("gp-1", "race");
      await source.fetchEventResults("gp-1", "race");

      const count = (part: string) => calls.filter((url) => url.includes(part)).length;
      expect(count("/results/seasons")).toBe(1);
      expect(count("/results/categories")).toBe(1);
      expect(count("/results/sessions")).toBe(2);
      expect(count("/results/classification")).toBe(2);
    });
  });

  describe("fetchGpStatus", () => {
    function statusRoutes(status: string): FakeRoute[] {
      return [
        ...baseRoutes(),
        {
          match: "/results/sessions",
          body: [{ id: "s-rac", type: "RAC", date: "2026-09-06T08:00:00Z", status }],
        },
      ];
    }

    it("RAC FINISHED → «provisional»", async () => {
      const { source } = makeSourceWithCalls(statusRoutes("FINISHED"));
      expect(await source.fetchGpStatus("gp-1")).toBe("provisional");
    });

    it("RAC NOT-STARTED → «not-started»", async () => {
      const { source } = makeSourceWithCalls(statusRoutes("NOT-STARTED"));
      expect(await source.fetchGpStatus("gp-1")).toBe("not-started");
    });

    it("estado desconocido → PulseLiveSourceError (fail-closed)", async () => {
      const { source } = makeSourceWithCalls(statusRoutes("IN-PROGRESS"));
      await expect(source.fetchGpStatus("gp-1")).rejects.toBeInstanceOf(
        PulseLiveSourceError,
      );
      await expect(source.fetchGpStatus("gp-1")).rejects.toThrow(
        "La fuente devolvió un estado de sesión desconocido «IN-PROGRESS» para el GP «GP de Indonesia» (fail-closed, ADR-0019).",
      );
    });

    it("sin sesión RAC → ResultsNormalizationError (fail-closed)", async () => {
      const { source } = makeSourceWithCalls([
        ...baseRoutes(),
        {
          match: "/results/sessions",
          body: [
            { id: "s-q", type: "Q", date: "2026-09-05T08:00:00Z", status: "FINISHED" },
          ],
        },
      ]);
      await expect(source.fetchGpStatus("gp-1")).rejects.toBeInstanceOf(
        ResultsNormalizationError,
      );
      await expect(source.fetchGpStatus("gp-1")).rejects.toThrow(
        "El GP «GP de Indonesia» no tiene sesión RAC en la fuente; revisa el vínculo (results.linkSource) (fail-closed, ADR-0019).",
      );
    });

    it("varias sesiones RAC: la última por fecha decide", async () => {
      const { source } = makeSourceWithCalls([
        ...baseRoutes(),
        {
          match: "/results/sessions",
          body: [
            { id: "s-rac-1", type: "RAC", date: "2026-09-06T08:00:00Z", status: "FINISHED" },
            { id: "s-rac-2", type: "RAC", date: "2026-09-06T10:00:00Z", status: "NOT-STARTED" },
          ],
        },
      ]);
      expect(await source.fetchGpStatus("gp-1")).toBe("not-started");
    });
  });

  describe("listSeasonEvents (catálogo para linkSource)", () => {
    it("excluye eventos de test y mapea a { eventRef, name }", async () => {
      const { source, calls } = makeSourceWithCalls([
        ...baseRoutes(),
        {
          match: "/results/events",
          body: [
            { id: "ev-1", name: "GP de Indonesia" },
            { id: "ev-test", name: "Test privado", test: true },
            { id: "ev-2", name: "GP de Japón" },
          ],
        },
      ]);

      const events = await source.listSeasonEvents(2026);

      expect(events).toEqual([
        { eventRef: "ev-1", name: "GP de Indonesia" },
        { eventRef: "ev-2", name: "GP de Japón" },
      ]);
      expect(
        calls.some((url) => url.includes("/results/events?seasonUuid=season-2026")),
      ).toBe(true);
    });

    it("caché por temporada: la segunda llamada no re-fetchea (misma referencia)", async () => {
      const { source, calls } = makeSourceWithCalls([
        ...baseRoutes(),
        { match: "/results/events", body: [{ id: "ev-1", name: "GP de Indonesia" }] },
      ]);

      const first = await source.listSeasonEvents(2026);
      const callsAfterFirst = calls.length;
      const second = await source.listSeasonEvents(2026);

      expect(second).toBe(first);
      expect(calls).toHaveLength(callsAfterFirst);
    });
  });

  describe("errores de red / HTTP / formato (getJson)", () => {
    it("fallo de red: «No se pudo contactar con la fuente de resultados: …»", async () => {
      const { source } = makeSourceWithCalls([
        { match: "/results/seasons", networkError: true },
      ]);
      await expect(source.fetchGpStatus("gp-1")).rejects.toBeInstanceOf(
        PulseLiveSourceError,
      );
      await expect(source.fetchGpStatus("gp-1")).rejects.toThrow(
        "No se pudo contactar con la fuente de resultados: network down",
      );
    });

    it("HTTP no 2xx: «La fuente de resultados respondió HTTP 500.»", async () => {
      const { source } = makeSourceWithCalls([{ match: "/results/seasons", status: 500 }]);
      await expect(source.fetchGpStatus("gp-1")).rejects.toThrow(
        "La fuente de resultados respondió HTTP 500.",
      );
    });

    it("cuerpo no JSON: «La fuente de resultados respondió contenido no JSON.»", async () => {
      const { source } = makeSourceWithCalls([
        { match: "/results/seasons", notJson: true },
      ]);
      await expect(source.fetchGpStatus("gp-1")).rejects.toThrow(
        "La fuente de resultados respondió contenido no JSON.",
      );
    });
  });
});
