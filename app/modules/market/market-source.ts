/**
 * Fuente de mercado (US-06/ADR-0013): patrón adapter (integrations.md §1).
 *
 * El núcleo solo conoce el contrato `MarketSource`; PulseLive es la
 * implementación del MVP. La normalización (payload crudo → `NormalizedMarket`)
 * es una función pura (`normalizePulseLiveMarket`) testeada con fixtures; la
 * parte de I/O (`PulseLiveMarketSource`) es fina y se prueba con un
 * `fetchImpl` inyectado (sin red).
 *
 * Fuente PulseLive (estrategia):
 * - `/results/seasons` → temporada por año (UUID).
 * - `/results/events?seasonUuid=X` → eventos de la temporada.
 * - `/riders?eventUuid=X&categoryUuid=Y` → riders con `current_career_step.team`
 *   y `team.constructor` para cada evento.
 * - Agregamos constructores, equipos y afiliaciones por temporada.
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
  /** Constructor (fabricante de la moto). */
  manufacturer: NormalizedConstructor;
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
  /** Clasificación del campeonato (para la heurística de P0, ADR-0014). */
  fetchStandings(seasonYear: number): Promise<StandingsEntry[]>;
}

/** Fallo al comunicarse con la fuente (red, HTTP, formato inesperado). */
export class MarketSourceError extends Error {}

/** Los datos de la fuente no se pueden normalizar. */
export class MarketNormalizationError extends Error {}

// ── Payloads crudos de PulseLive (solo los campos que usa el normalizador) ─

export interface PulseLiveSeason {
  id: string;
  year: number;
}

export interface PulseLiveEvent {
  id: string;
  name: string;
  date_start: string;
  date_end: string;
  test?: boolean;
  circuit: {
    name: string;
    place?: string | null;
  };
  country: {
    name: string;
  };
}

/** Rider con su equipo actual (current_career_step.team). */
export interface PulseLiveRider {
  id: string;
  name: string;
  surname: string;
  nickname: string | null;
  number: number | null;
  country: {
    iso: string;
    name: string;
  };
  current_career_step: {
    season: number;
    number: number;
    sponsored_team: string;
    team: {
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
    } | null;
    category: {
      id: string;
      name: string;
      legacy_id: number;
    };
    in_grid: boolean;
    current: boolean;
  };
  retired: boolean;
  published: boolean;
}

// ── Normalización pura ─────────────────────────────────────────────────────

/**
 * Normaliza un payload crudo de PulseLive (pura — sin I/O).
 *
 * - Constructores: únicos por `name` (orden de aparición).
 * - Equipos: únicos por `name`.
 * - Pilotos: únicos por `sourceId`.
 * - Afiliaciones: rider→equipo para cada rider con equipo válido.
 * - Solo se incluyen riders cuyo `current_career_step.team.category.name`
 *   es "MotoGP" (se filtran los de Moto2/Moto3).
 *
 * Lanza `MarketNormalizationError` si los datos no se pueden mapear.
 */
export function normalizePulseLiveMarket(
  riders: PulseLiveRider[],
  seasonYear: number,
  seasonRef: string,
  source: { name: string; version: string },
): NormalizedMarket {
  if (riders.length === 0) {
    throw new MarketNormalizationError(
      `La fuente no tiene riders para la temporada ${seasonYear}.`,
    );
  }

  // Filtrar solo riders de MotoGP (equipo con categoría MotoGP).
  const motogpRiders = riders.filter(
    (r) =>
      r.current_career_step?.team?.category?.name === "MotoGP" &&
      r.current_career_step?.team?.id !== undefined,
  );
  if (motogpRiders.length === 0) {
    throw new MarketNormalizationError(
      `La fuente no tiene riders de MotoGP para la temporada ${seasonYear}.`,
    );
  }

  // Constructores únicos por nombre (orden de aparición).
  const constructorMap = new Map<string, NormalizedConstructor>();
  for (const rider of motogpRiders) {
    const team = rider.current_career_step.team!;
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
  for (const rider of motogpRiders) {
    const team = rider.current_career_step.team!;
    if (!teamMap.has(team.name)) {
      teamMap.set(team.name, {
        sourceId: team.id,
        name: team.name,
        manufacturer: {
          sourceId: team.constructor.id,
          name: team.constructor.name,
        },
      });
    }
  }
  const teams = Array.from(teamMap.values());

  // Pilotos únicos por sourceId.
  const riderMap = new Map<string, NormalizedRider>();
  for (const rider of motogpRiders) {
    if (!riderMap.has(rider.id)) {
      riderMap.set(rider.id, {
        sourceId: rider.id,
        name: rider.name,
        surname: rider.surname,
        number: rider.number ?? null,
        countryIso: rider.country?.iso ?? null,
      });
    }
  }
  const ridersNormalized = Array.from(riderMap.values());

  // Afiliaciones: riderSourceId → teamSourceId.
  const affiliationMap = new Map<string, NormalizedAffiliation>();
  for (const rider of motogpRiders) {
    const team = rider.current_career_step.team!;
    if (!affiliationMap.has(rider.id)) {
      affiliationMap.set(rider.id, {
        riderSourceId: rider.id,
        teamSourceId: team.id,
        seasonYear,
      });
    }
  }
  const affiliations = Array.from(affiliationMap.values());

  return {
    year: seasonYear,
    seasonRef,
    source,
    constructors,
    teams,
    riders: ridersNormalized,
    affiliations,
  };
}

// ── Implementación PulseLive (I/O fina, fetch inyectable) ─────────────────

const PULSELIVE_BASE_URL = "https://api.motogp.pulselive.com/motogp/v1";

export interface PulseLiveMarketSourceOptions {
  /** Para tests o proxies. */
  baseUrl?: string;
  /** Fetch inyectable (tests sin red). */
  fetchImpl?: typeof fetch;
}

/**
 * Fuente de mercado PulseLive.
 *
 * Estrategia:
 * 1. `/results/seasons` → temporada por año.
 * 2. `/results/events?seasonUuid=X` → eventos (GPs).
 * 3. `/riders?eventUuid=X&categoryUuid=Y` → riders con equipo.
 *    Usamos el primer evento (GP más antiguo) para obtener todos los riders
 *    de la temporada con su equipo actual.
 * 4. Agregamos constructores, equipos y afiliaciones.
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

    // 2) Eventos de la temporada.
    const events = await this.getJson<PulseLiveEvent[]>(
      `${this.baseUrl}/results/events?seasonUuid=${season.id}`,
    );
    if (events.length === 0) {
      throw new MarketSourceError(
        `La fuente no tiene eventos para la temporada ${seasonYear}.`,
      );
    }

    // 3) Riders con equipo del primer evento (GP más antiguo de la temporada).
    //    Usamos el primer evento porque todos los riders están en la grid.
    const firstEvent = events[0]!;

    // Necesitamos el categoryUuid de MotoGP para el endpoint /riders.
    // Lo descubrimos probando con el category legacy_id 3 (MotoGP).
    // El endpoint /results/categories devuelve la categoría MotoGP.
    const categories = await this.getJson<PulseLiveCategory[]>(
      `${this.baseUrl}/results/categories?seasonUuid=${season.id}`,
    );
    const motogpCategory = categories.find((c) => c.legacy_id === 3);
    if (!motogpCategory) {
      throw new MarketSourceError(
        "La fuente no tiene la categoría MotoGP para la temporada.",
      );
    }

    const riders = await this.getJson<PulseLiveRider[]>(
      `${this.baseUrl}/riders?eventUuid=${firstEvent.id}&categoryUuid=${motogpCategory.id}`,
    );

    if (riders.length === 0) {
      throw new MarketSourceError(
        `La fuente no tiene riders para el evento «${firstEvent.name}».`,
      );
    }

    return normalizePulseLiveMarket(riders, seasonYear, season.id, this.meta);
  }

  /**
   * Fetch de la clasificación del campeonato (para P0 heurística).
   *
   * - `/results/seasons` → temporada por año.
   * - `/results/categories` → categoría MotoGP.
   * - `/results/standings?seasonUuid=X&categoryUuid=Y` → clasificación.
   */
  async fetchStandings(seasonYear: number): Promise<StandingsEntry[]> {
    const seasons = await this.getJson<PulseLiveSeason[]>(
      `${this.baseUrl}/results/seasons`,
    );
    const season = seasons.find((candidate) => candidate.year === seasonYear);
    if (!season) {
      throw new MarketSourceError(
        `La fuente no tiene temporada para el año ${seasonYear}.`,
      );
    }

    const categories = await this.getJson<PulseLiveCategory[]>(
      `${this.baseUrl}/results/categories?seasonUuid=${season.id}`,
    );
    const motogpCategory = categories.find((c) => c.legacy_id === 3);
    if (!motogpCategory) {
      throw new MarketSourceError(
        "La fuente no tiene la categoría MotoGP para la temporada.",
      );
    }

    const standings = await this.getJson<PulseLiveStandingsResponse>(
      `${this.baseUrl}/results/standings?seasonUuid=${season.id}&categoryUuid=${motogpCategory.id}`,
    );

    if (!standings.classification || standings.classification.length === 0) {
      throw new MarketSourceError(
        `La fuente no tiene clasificación para la temporada ${seasonYear}.`,
      );
    }

    return standings.classification.map((entry) => ({
      position: entry.position,
      riderFullName: entry.rider.full_name,
      riderNumber: entry.rider.number,
      teamName: entry.team?.name ?? "",
      constructorName: entry.constructor?.name ?? "",
      points: entry.points ?? 0,
    }));
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

interface PulseLiveCategory {
  id: string;
  name: string;
  legacy_id: number;
}

/** Entrada de la clasificación del campeonato. */
export interface StandingsEntry {
  position: number;
  riderFullName: string;
  riderNumber: number;
  teamName: string;
  constructorName: string;
  points: number;
}

/** Respuesta cruda de `/results/standings`. */
interface PulseLiveStandingsResponse {
  file: string;
  classification: Array<{
    id: string;
    position: number;
    rider: {
      id: string;
      full_name: string;
      number: number;
      riders_api_uuid: string;
    };
    team?: {
      id: string;
      name: string;
    } | null;
    constructor?: {
      id: string;
      name: string;
    } | null;
    points?: number;
  }>;
  xmlFile: string;
}
