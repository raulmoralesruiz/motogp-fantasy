/**
 * Fuente de mercado (US-06/ADR-0013): patrón adapter (integrations.md §1).
 *
 * El núcleo solo conoce el contrato `MarketSource`; PulseLive es la
 * implementación del MVP. La normalización (payload crudo → `NormalizedMarket`)
 * es una función pura (`normalizePulseLiveMarket`) testeada con fixtures; la
 * parte de I/O (`PulseLiveMarketSource`) es fina y se prueba con un
 * `fetchImpl` inyectado (sin red).
 *
 * Fuente PulseLive:
 * - `GET /motogp/v1/teams?seasonYear={year}&categoryUuid={motogp_uuid}`
 *   devuelve 12 equipos con sus `riders` y `constructor`.
 * - El `categoryUuid` de MotoGP se descubre en `/results/categories` por
 *   `legacy_id: 3`.
 */

// ── Contrato normalizado ───────────────────────────────────────────────────

/** Constructor (mapa a `Constructor`: único por `name`). */
export interface NormalizedConstructor {
  /** ID en la fuente (auditoría, mapeo rider_mappings futuro). */
  sourceId: string | null;
  name: string;
}

/** Equipo (mapa a `Team`: único por `name`). */
export interface NormalizedTeam {
  /** ID en la fuente (auditoría, mapeo rider_mappings futuro). */
  sourceId: string | null;
  name: string;
  constructor: NormalizedConstructor;
}

/** Piloto (mapa a `Rider`: único por `name` en BD). */
export interface NormalizedRider {
  /** ID en la fuente (auditoría, mapeo rider_mappings futuro). */
  sourceId: string | null;
  name: string;
  surname: string;
  number: number | null;
  countryIso: string | null;
}

/** Afiliación normalizada: rider → equipo en temporada dada. */
export interface NormalizedAffiliation {
  riderSourceId: string;
  teamSourceId: string;
  seasonYear: number;
}

/** Mercado normalizado de temporada (lo devuelve `MarketSource`). */
export interface NormalizedMarket {
  year: number;
  /** Referencia estable de la temporada en la fuente (procedencia). */
  seasonRef: string;
  /** Metadatos de la fuente (auditoría). */
  source: { name: string; version: string };
  /** Constructores únicos (por name). */
  constructors: NormalizedConstructor[];
  /** Equipos únicos (por name). */
  teams: NormalizedTeam[];
  /** Pilotos únicos (por sourceId). */
  riders: NormalizedRider[];
  /** Afiliaciones rider→equipo en la temporada. */
  affiliations: NormalizedAffiliation[];
}

/** Contrato de fuente de mercado (adapter — integrations.md §1). */
export interface MarketSource {
  readonly meta: { name: string; version: string };
  fetchSeasonMarket(seasonYear: number): Promise<NormalizedMarket>;
}

/** Fallo al comunicarse con la fuente (red, HTTP, formato inesperado). */
export class MarketSourceError extends Error {}

/** Los datos de la fuente no se pueden normalizar. */
export class MarketNormalizationError extends Error {}

// ── Payloads crudos de PulseLive (solo los campos que usa el normalizador) ─

export interface PulseLiveTeam {
  id: string;
  name: string;
  legacy_id: number;
  type: string;
  color: string;
  text_color: string;
  picture: string | null;
  constructor: {
    id: string;
    name: string;
    legacy_id: number;
  };
  category: {
    id: string;
    name: string;
    legacy_id: number;
  };
  riders: Array<{
    id: string;
    name: string;
    surname: string;
    nickname: string | null;
    number: number | null;
    country: {
      iso: string;
      name: string;
    };
    birth_date: string;
    birth_city: string;
    retired: boolean;
    published: boolean;
  }>;
}

export interface PulseLiveCategory {
  id: string;
  name: string;
  legacy_id: number;
}

// ── Normalización pura ─────────────────────────────────────────────────────

/**
 * Normaliza un payload crudo de PulseLive (pura — sin I/O).
 *
 * - Constructores: únicos por `name` (orden de aparición en `teams`).
 * - Equipos: únicos por `name`.
 * - Pilotos: únicos por `sourceId` (el ID de PulseLive).
 * - Afiliaciones: rider→equipo para cada rider de cada equipo.
 *
 * Lanza `MarketNormalizationError` si los datos no se pueden mapear.
 */
export function normalizePulseLiveMarket(
  teams: PulseLiveTeam[],
  seasonYear: number,
  seasonRef: string,
  source: { name: string; version: string },
): NormalizedMarket {
  if (teams.length === 0) {
    throw new MarketNormalizationError(
      `La fuente no tiene equipos para la temporada ${seasonYear}.`,
    );
  }

  // Constructores únicos por nombre (orden de aparición).
  const constructorMap = new Map<string, NormalizedConstructor>();
  for (const team of teams) {
    const ctor = team.constructor;
    if (!constructorMap.has(ctor.name)) {
      constructorMap.set(ctor.name, {
        sourceId: ctor.id,
        name: ctor.name,
      });
    }
  }
  const constructors = Array.from(constructorMap.values());

  // Equipos únicos por nombre.
  const teamMap = new Map<string, NormalizedTeam>();
  for (const team of teams) {
    if (!teamMap.has(team.name)) {
      teamMap.set(team.name, {
        sourceId: team.id,
        name: team.name,
        constructor: {
          sourceId: team.constructor.id,
          name: team.constructor.name,
        },
      });
    }
  }
  const teamsNormalized = Array.from(teamMap.values());

  // Pilotos únicos por sourceId.
  const riderMap = new Map<string, NormalizedRider>();
  for (const team of teams) {
    for (const rider of team.riders) {
      if (!riderMap.has(rider.id)) {
        riderMap.set(rider.id, {
          sourceId: rider.id,
          name: rider.name,
          surname: rider.surname,
          number: rider.number,
          countryIso: rider.country?.iso ?? null,
        });
      }
    }
  }
  const riders = Array.from(riderMap.values());

  // Afiliaciones: riderSourceId → teamSourceId.
  const affiliationMap = new Map<string, NormalizedAffiliation>();
  for (const team of teams) {
    for (const rider of team.riders) {
      const key = rider.id;
      if (!affiliationMap.has(key)) {
        affiliationMap.set(key, {
          riderSourceId: rider.id,
          teamSourceId: team.id,
          seasonYear,
        });
      }
    }
  }
  const affiliations = Array.from(affiliationMap.values());

  return {
    year: seasonYear,
    seasonRef,
    source,
    constructors,
    teams: teamsNormalized,
    riders,
    affiliations,
  };
}

// ── Implementación PulseLive (I/O fina, fetch inyectable) ─────────────────

const PULSELIVE_BASE_URL = "https://api.motogp.pulselive.com/motogp/v1";
/**
 * Categoría MotoGP en PulseLive (`legacy_id: 3`): se descubre en
 * `/results/categories` por ese identificador, no se hardcodea el UUID.
 */
const MOTO_GP_LEGACY_CATEGORY_ID = 3;

export interface PulseLiveMarketSourceOptions {
  /** Para tests o proxies. */
  baseUrl?: string;
  /** Fetch inyectable (tests sin red). */
  fetchImpl?: typeof fetch;
}

/**
 * Fuente de mercado PulseLive (ADR-0013): GET sin auth.
 *
 * Flujo: 1) temporada por año → 2) categoría MotoGP → 3) equipos de la
 * temporada. 2 peticiones (~24 por temporada para el calendario, aquí solo 2).
 */
export class PulseLiveMarketSource implements MarketSource {
  readonly meta = { name: "pulselive", version: "v1" };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PulseLiveMarketSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? PULSELIVE_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchSeasonMarket(seasonYear: number): Promise<NormalizedMarket> {
    // 1) Temporada por año.
    const seasons = await this.getJson<PulseLiveSeason[]>(
      `${this.baseUrl}/results/seasons`,
    );
    const season = seasons.find((candidate) => candidate.year === seasonYear);
    if (!season) {
      throw new MarketSourceError(
        `La fuente no tiene temporada para el año ${seasonYear}.`,
      );
    }

    // 2) Categoría MotoGP por legacy_id.
    const categories = await this.getJson<PulseLiveCategory[]>(
      `${this.baseUrl}/results/categories?seasonUuid=${season.id}`,
    );
    const category = categories.find((c) => c.legacy_id === MOTO_GP_LEGACY_CATEGORY_ID);
    if (!category) {
      throw new MarketSourceError(
        "La fuente no tiene la categoría MotoGP para la temporada.",
      );
    }

    // 3) Equipos de la temporada.
    const teams = await this.getJson<PulseLiveTeam[]>(
      `${this.baseUrl}/teams?seasonYear=${seasonYear}&categoryUuid=${category.id}`,
    );

    return normalizePulseLiveMarket(teams, seasonYear, season.id, this.meta);
  }

  private async getJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new MarketSourceError(
        `No se pudo contactar con la fuente de mercado: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new MarketSourceError(
        `La fuente de mercado respondió HTTP ${response.status}.`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new MarketSourceError(
        "La fuente de mercado respondió contenido no JSON.",
      );
    }
  }
}

// ── Tipos auxiliares ───────────────────────────────────────────────────────

interface PulseLiveSeason {
  id: string;
  year: number;
}
