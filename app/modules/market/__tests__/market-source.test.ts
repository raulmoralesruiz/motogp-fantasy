/**
 * Tests de la fuente de mercado (ADR-0013/ADR-0014):
 *
 * - `normalizePulseLiveMarket` (función pura): mapeo constructores/equipos/
 *   pilotos/afiliaciones, deduplicación, filtros MotoGP y errores.
 * - `PulseLiveMarketSource.fetchSeasonMarket` y `fetchStandings` (I/O fina):
 *   se prueban con un `fetchImpl` inyectado (sin red), cubriendo los fallos
 *   de red/HTTP/formato (`getJson`).
 */
import { describe, expect, it, vi } from "vitest";

import {
  dorsalFromRider,
  MarketNormalizationError,
  MarketSourceError,
  normalizePulseLiveMarket,
  PulseLiveMarketSource,
  type PulseLiveRider,
} from "../market-source";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** `fetchImpl` falso: responde según la URL pedida (sufijo ruta + query). */
function makeFetch(routes: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([path]) => url.includes(path));
    if (!match) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(match[1]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/**
 * Rider crudo de PulseLive (solo los campos que usa el normalizador).
 * Semántica del payload en vivo (US-42, ADR-0042): la dorsal vive en
 * `current_career_step.number` (el top-level `rider.number` está ausente)
 * y los colores del equipo son hex.
 */
function rawRider(overrides: Partial<PulseLiveRider> = {}): PulseLiveRider {
  return {
    id: "r1",
    name: "Marc",
    surname: "Marquez",
    nickname: null,
    country: { iso: "ES", name: "España" },
    current_career_step: {
      season: 2026,
      number: 93,
      sponsored_team: "Ducati",
      team: {
        id: "t1",
        name: "Ducati Lenovo Team",
        legacy_id: 1,
        type: "factory",
        color: "#ad0000",
        text_color: "#ffffff",
        picture: null,
        constructor: { id: "c1", name: "Ducati", legacy_id: 1 },
        category: { id: "cat-motogp", name: "MotoGP", legacy_id: 3 },
      },
      category: { id: "cat-motogp", name: "MotoGP", legacy_id: 3 },
      in_grid: true,
      current: true,
    },
    retired: false,
    published: true,
    ...overrides,
  };
}

/** Cambia la dorsal del career step (semántica del payload en vivo). */
function withStepNumber(
  rider: PulseLiveRider,
  number: number | null | undefined,
): PulseLiveRider {
  return {
    ...rider,
    current_career_step: {
      ...rider.current_career_step,
      number: number as unknown as number,
    },
  };
}

const seasons = [{ id: "season-uuid", year: 2026 }];
const categories = [
  { id: "cat-moto2", name: "Moto2", legacy_id: 2 },
  { id: "cat-moto3", name: "Moto3", legacy_id: 1 },
  { id: "cat-motogp", name: "MotoGP", legacy_id: 3 },
];
const events = [
  {
    id: "event-1",
    name: "GP de Qatar",
    date_start: "2026-03-01",
    date_end: "2026-03-01",
    circuit: { name: "Lusail" },
    country: { name: "Qatar" },
  },
];

// ── normalizePulseLiveMarket (pura) ─────────────────────────────────────────

describe("normalizePulseLiveMarket (pura)", () => {
  it("sin riders → MarketNormalizationError", () => {
    expect(() =>
      normalizePulseLiveMarket([], 2026, "season-uuid", {
        name: "pulselive",
        version: "v1",
      }),
    ).toThrow(MarketNormalizationError);
  });

  it("riders sin equipo MotoGP → MarketNormalizationError", () => {
    const moto2 = rawRider({
      id: "r-moto2",
      current_career_step: {
        season: 2026,
        number: 1,
        sponsored_team: "x",
        team: {
          id: "t-moto2",
          name: "Equipo Moto2",
          legacy_id: 1,
          type: "factory",
          color: "blue",
          text_color: "white",
          picture: null,
          constructor: { id: "c-moto2", name: "KTM", legacy_id: 1 },
          category: { id: "cat-moto2", name: "Moto2", legacy_id: 2 },
        },
        category: { id: "cat-moto2", name: "Moto2", legacy_id: 2 },
        in_grid: true,
        current: true,
      },
    });
    expect(() =>
      normalizePulseLiveMarket([moto2], 2026, "season-uuid", {
        name: "pulselive",
        version: "v1",
      }),
    ).toThrow(MarketNormalizationError);
  });

  it("mapea constructores, equipos, pilotos y afiliaciones (solo MotoGP)", () => {
    const riders = [
      rawRider(),
      // Mismo equipo/constructor, otro piloto (dedup de equipo/constructor).
      withStepNumber(
        rawRider({ id: "r2", name: "Jorge", surname: "Martin" }),
        89,
      ),
      // Otro equipo y constructor (colores hex de KTM, como en vivo).
      withStepNumber(
        rawRider({
          id: "r3",
          name: "Pedro",
          surname: "Acosta",
          current_career_step: {
            season: 2026,
            number: 33,
            sponsored_team: "KTM",
            team: {
              id: "t2",
              name: "Red Bull KTM Tech3",
              legacy_id: 2,
              type: "factory",
              color: "#ff7e27",
              text_color: "#383838",
              picture: null,
              constructor: { id: "c2", name: "KTM", legacy_id: 2 },
              category: { id: "cat-motogp", name: "MotoGP", legacy_id: 3 },
            },
            category: { id: "cat-motogp", name: "MotoGP", legacy_id: 3 },
            in_grid: true,
            current: true,
          },
        }),
        33,
      ),
    ];
    const result = normalizePulseLiveMarket(riders, 2026, "season-uuid", {
      name: "pulselive",
      version: "v1",
    });

    expect(result.year).toBe(2026);
    expect(result.seasonRef).toBe("season-uuid");
    expect(result.constructors).toEqual([
      { sourceId: "c1", name: "Ducati" },
      { sourceId: "c2", name: "KTM" },
    ]);
    // US-42 (ADR-0042): los colores hex de la fuente se conservan.
    expect(result.teams).toEqual([
      {
        sourceId: "t1",
        name: "Ducati Lenovo Team",
        manufacturer: { sourceId: "c1", name: "Ducati" },
        color: "#ad0000",
        textColor: "#ffffff",
      },
      {
        sourceId: "t2",
        name: "Red Bull KTM Tech3",
        manufacturer: { sourceId: "c2", name: "KTM" },
        color: "#ff7e27",
        textColor: "#383838",
      },
    ]);
    expect(result.riders).toHaveLength(3);
    expect(result.riders[0]).toMatchObject({
      sourceId: "r1",
      name: "Marc",
      surname: "Marquez",
      number: 93,
      countryIso: "ES",
    });
    // Dorsales del career step (payload en vivo, US-42).
    expect(result.riders[1]).toMatchObject({ number: 89 });
    expect(result.riders[2]).toMatchObject({ number: 33 });
    expect(result.affiliations).toEqual([
      { riderSourceId: "r1", teamSourceId: "t1", seasonYear: 2026 },
      { riderSourceId: "r2", teamSourceId: "t1", seasonYear: 2026 },
      { riderSourceId: "r3", teamSourceId: "t2", seasonYear: 2026 },
    ]);
  });

  it("dorsal y país ausentes → null", () => {
    const rider = withStepNumber(
      rawRider({
        country: undefined as unknown as PulseLiveRider["country"],
      }),
      undefined,
    );
    const result = normalizePulseLiveMarket([rider], 2026, "ref", {
      name: "pulselive",
      version: "v1",
    });
    expect(result.riders[0]).toMatchObject({ number: null, countryIso: null });
  });

  it("equipo sin colores en la fuente → null (el picker hará fallback)", () => {
    const rider = rawRider({
      current_career_step: {
        ...rawRider().current_career_step,
        team: {
          ...rawRider().current_career_step.team!,
          color: null,
          text_color: null,
        },
      },
    });
    const result = normalizePulseLiveMarket([rider], 2026, "ref", {
      name: "pulselive",
      version: "v1",
    });
    expect(result.teams[0]).toMatchObject({
      color: null,
      textColor: null,
    });
  });

  it("deduplica el mismo piloto (sourceId) aunque aparezca dos veces", () => {
    const result = normalizePulseLiveMarket(
      [rawRider(), rawRider()],
      2026,
      "ref",
      { name: "pulselive", version: "v1" },
    );
    expect(result.riders).toHaveLength(1);
    expect(result.affiliations).toHaveLength(1);
  });
});

// ── dorsalFromRider (US-42, ADR-0042) ──────────────────────────────────────

describe("dorsalFromRider (US-42, ADR-0042)", () => {
  it("la dorsal del career step tiene prioridad sobre la top-level", () => {
    // En vivo el top-level no existe; si ambos existieran, manda el step.
    expect(dorsalFromRider(rawRider({ number: 7 }))).toBe(93);
  });

  it("sin dorsal en el career step → cae al top-level", () => {
    const rider = withStepNumber(rawRider({ number: 7 }), undefined);
    expect(dorsalFromRider(rider)).toBe(7);
  });

  it("dorsal ausente en ambas → null", () => {
    expect(dorsalFromRider(withStepNumber(rawRider(), undefined))).toBeNull();
  });

  it("dorsal inválida (negativa) → no cuenta; si no hay otra → null", () => {
    expect(
      dorsalFromRider(withStepNumber(rawRider({ number: 7 }), -5)),
    ).toBe(7);
    expect(
      dorsalFromRider(withStepNumber(rawRider(), -5)),
    ).toBeNull();
  });

  it("dorsal no entera → no cuenta", () => {
    expect(
      dorsalFromRider(withStepNumber(rawRider({ number: 7 }), 2.5)),
    ).toBe(7);
  });
});

// ── PulseLiveMarketSource.fetchSeasonMarket (I/O) ───────────────────────────

describe("PulseLiveMarketSource.fetchSeasonMarket", () => {
  it("happy path: temporada → eventos → categoría → riders → normalizado", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/events": events,
        "/results/categories": categories,
        "/riders": [rawRider()],
      }),
    });

    const result = await source.fetchSeasonMarket(2026);

    expect(result.year).toBe(2026);
    expect(result.seasonRef).toBe("season-uuid");
    expect(result.riders).toHaveLength(1);
    expect(result.constructors).toHaveLength(1);
    expect(result.teams).toHaveLength(1);
    expect(result.affiliations).toHaveLength(1);
    // US-42: dorsal del career step + colores hex pasan por el I/O.
    expect(result.riders[0]).toMatchObject({ number: 93 });
    expect(result.teams[0]).toMatchObject({
      color: "#ad0000",
      textColor: "#ffffff",
    });
  });

  it("sin temporada en la fuente → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({ "/results/seasons": [{ id: "x", year: 2025 }] }),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      MarketSourceError,
    );
  });

  it("sin eventos → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/events": [],
      }),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      MarketSourceError,
    );
  });

  it("sin categoría MotoGP → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/events": events,
        "/results/categories": [{ id: "c", name: "Moto2", legacy_id: 2 }],
      }),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      MarketSourceError,
    );
  });

  it("sin riders en el evento → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/events": events,
        "/results/categories": categories,
        "/riders": [],
      }),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      MarketSourceError,
    );
  });
});

// ── PulseLiveMarketSource.fetchStandings (ADR-0014) ─────────────────────────

describe("PulseLiveMarketSource.fetchStandings (ADR-0014)", () => {
  it("normaliza la clasificación (posición, rider, equipo, constructor)", async () => {
    const standings = {
      file: "worldstanding.pdf",
      classification: [
        {
          id: "e1",
          position: 1,
          rider: {
            id: "r1",
            full_name: "Marc Marquez",
            number: 93,
            riders_api_uuid: "ru1",
          },
          team: { id: "t1", name: "Ducati Lenovo Team" },
          constructor: { id: "c1", name: "Ducati" },
          points: 365,
        },
        {
          id: "e2",
          position: 2,
          rider: {
            id: "r2",
            full_name: "Jorge Martin",
            number: 89,
            riders_api_uuid: "ru2",
          },
          team: { id: "t2", name: "Aprilia Racing" },
          constructor: { id: "c2", name: "Aprilia" },
          points: 355,
        },
      ],
      xmlFile: "worldstanding.xml",
    };
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/categories": categories,
        "/results/standings": standings,
      }),
    });

    const result = await source.fetchStandings(2026);

    expect(result).toEqual([
      {
        position: 1,
        riderFullName: "Marc Marquez",
        riderNumber: 93,
        teamName: "Ducati Lenovo Team",
        constructorName: "Ducati",
        points: 365,
      },
      {
        position: 2,
        riderFullName: "Jorge Martin",
        riderNumber: 89,
        teamName: "Aprilia Racing",
        constructorName: "Aprilia",
        points: 355,
      },
    ]);
  });

  it("tolera equipo/constructor ausentes (los deja vacíos)", async () => {
    const standings = {
      file: "worldstanding.pdf",
      classification: [
        {
          id: "e1",
          position: 1,
          rider: {
            id: "r1",
            full_name: "Rider Sin Equipo",
            number: 1,
            riders_api_uuid: "ru1",
          },
          team: null,
          constructor: null,
          points: 10,
        },
      ],
      xmlFile: "worldstanding.xml",
    };
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/categories": categories,
        "/results/standings": standings,
      }),
    });

    const result = await source.fetchStandings(2026);

    expect(result).toEqual([
      {
        position: 1,
        riderFullName: "Rider Sin Equipo",
        riderNumber: 1,
        teamName: "",
        constructorName: "",
        points: 10,
      },
    ]);
  });

  it("sin temporada en la fuente → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": [{ id: "other", year: 2025 }],
      }),
    });
    await expect(source.fetchStandings(2026)).rejects.toThrow(MarketSourceError);
  });

  it("sin categoría MotoGP → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/categories": [{ id: "cat-moto2", name: "Moto2", legacy_id: 2 }],
      }),
    });
    await expect(source.fetchStandings(2026)).rejects.toThrow(MarketSourceError);
  });

  it("clasificación vacía → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: makeFetch({
        "/results/seasons": seasons,
        "/results/categories": categories,
        "/results/standings": { file: "x.pdf", classification: [] },
      }),
    });
    await expect(source.fetchStandings(2026)).rejects.toThrow(MarketSourceError);
  });
});

// ── getJson: fallos de red / HTTP / formato ─────────────────────────────────

describe("PulseLiveMarketSource.getJson (fallos)", () => {
  it("error de red (fetch lanza) → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      /No se pudo contactar/,
    );
  });

  it("HTTP no-OK → MarketSourceError con el código", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: vi.fn(async () => new Response("err", { status: 500 })),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("respuesta no-JSON → MarketSourceError", async () => {
    const source = new PulseLiveMarketSource({
      fetchImpl: vi.fn(async () => new Response("<html>no json</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      })),
    });
    await expect(source.fetchSeasonMarket(2026)).rejects.toThrow(
      /no JSON/,
    );
  });
});
