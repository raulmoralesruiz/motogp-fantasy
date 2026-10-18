/**
 * Fuente de calendario (US-05): patrón adapter (integrations.md §1,
 * ADR-0012).
 *
 * El núcleo solo conoce el contrato `CalendarSource`; PulseLive es la
 * implementación del MVP (verificada en vivo el 2026-10-18). La
 * normalización (payload crudo → `NormalizedSeasonCalendar`) es una
 * función pura (`normalizePulseLiveCalendar`) testeada con fixtures; la
 * parte de I/O (`PulseLiveCalendarSource`) es fina y se prueba con un
 * `fetchImpl` inyectado (sin red).
 *
 * Mapeo PulseLive (ADR-0012):
 * - `Q` por orden temporal → `q1`, `q2` (una sola Q → solo `q2`).
 * - `SPR` → `sprint` (si hay varias, la última por fecha).
 * - `RAC` → `race` (si hay varias, la última por fecha: carrera
 *   reiniciada — p. ej. GP de Cataluña 2026).
 * - `FP`/`PR`/`WUP` se ignoran (no puntúan en el juego).
 * - `Gp.date` = fecha de la carrera (fallback: `date_end` del evento).
 * - `round` se deriva del orden por `date_start` (la API no tiene campo
 *   de ronda).
 * - Los eventos de test (`test: true`) se excluyen.
 */

// ── Contrato normalizado ───────────────────────────────────────────────────

/**
 * Fechas normalizadas como `Date` (UTC): el preview viaja por tRPC con
 * superjson (que serializa `Date` correctamente) y el input de
 * `calendar.import` revalida con `z.coerce.date()` (no-op sobre `Date`).
 */

/** Circuito normalizado (mapa a `Circuit`: único por (name, country)). */
export interface CalendarCircuit {
  name: string;
  country: string;
  location: string | null;
}

/** Evento de fin de semana normalizado (mapa a `WeekendEvent`). */
export interface CalendarWeekendEvent {
  type: "q1" | "q2" | "sprint" | "race";
  /** Fecha de inicio (UTC) si la fuente la proporciona. */
  startTime: Date | null;
}

/** GP normalizado (mapa a `Gp` + sus eventos). */
export interface CalendarGp {
  round: number;
  name: string;
  circuit: CalendarCircuit;
  /** Fecha de la carrera (UTC; fallback: `date_end` a medianoche). */
  date: Date;
  events: CalendarWeekendEvent[];
}

/** Calendario normalizado de temporada (lo devuelve `CalendarSource`). */
export interface NormalizedSeasonCalendar {
  year: number;
  /** Referencia estable de la temporada en la fuente (procedencia). */
  seasonRef: string;
  /** Metadatos de la fuente (auditoría). */
  source: { name: string; version: string };
  gps: CalendarGp[];
}

/** Contrato de fuente de calendario (adapter — integrations.md §1). */
export interface CalendarSource {
  readonly meta: { name: string; version: string };
  fetchSeasonCalendar(year: number): Promise<NormalizedSeasonCalendar>;
}

/** Fallo al comunicarse con la fuente (red, HTTP, formato inesperado). */
export class CalendarSourceError extends Error {}

/** Los datos de la fuente no se pueden normalizar (p. ej. GP sin carrera). */
export class CalendarNormalizationError extends Error {}

// ── Payloads crudos de PulseLive (solo los campos que usa el normalizador) ─

export interface PulseLiveSeason {
  id: string;
  year: number;
}

export interface PulseLiveCategory {
  id: string;
  name: string;
  legacy_id: number;
}

export interface PulseLiveEvent {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  date_start: string;
  /** YYYY-MM-DD */
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

export interface PulseLiveSession {
  id: string;
  /** FP | PR | Q | SPR | WUP | RAC */
  type: string;
  /** ISO 8601 (UTC). */
  date: string | null;
}

/** Calendario crudo tal y como lo ensambla `PulseLiveCalendarSource`. */
export interface PulseLiveRawCalendar {
  season: PulseLiveSeason;
  events: PulseLiveEvent[];
  /** Sesiones por id de evento, en el orden de la fuente (cronológico). */
  sessionsByEvent: Record<string, PulseLiveSession[]>;
}

/** Orden canónico de los eventos de fin de semana (para las vistas). */
export const WEEKEND_EVENT_ORDER: Record<CalendarWeekendEvent["type"], number> = {
  q1: 0,
  q2: 1,
  sprint: 2,
  race: 3,
};

// ── Normalización pura ─────────────────────────────────────────────────────

function sortByDate<T extends { date: string | null }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

/** Convierte la fecha ISO de la fuente a `Date`; `null` se conserva. */
function toUtcDate(iso: string | null, context: string): Date | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new CalendarNormalizationError(
      `La fuente devolvió una fecha inválida para ${context}: «${iso}».`,
    );
  }
  return date;
}

interface MappedWeekend {
  events: CalendarWeekendEvent[];
  /** Fecha de la carrera (null si la fuente no lo proporciona). */
  raceDate: Date | null;
}

/**
 * Mapea las sesiones de un evento a eventos de fin de semana (reglas del
 * ADR-0012). Lanza `CalendarNormalizationError` si falta Q2 o la carrera.
 */
function mapWeekendSessions(gpName: string, sessions: PulseLiveSession[]): MappedWeekend {
  const sorted = sortByDate(sessions);
  const qs = sorted.filter((s) => s.type === "Q");
  const sprints = sorted.filter((s) => s.type === "SPR");
  const races = sorted.filter((s) => s.type === "RAC");

  const events: CalendarWeekendEvent[] = [];
  const startTime = (session: PulseLiveSession, label: string) =>
    toUtcDate(session.date, `la sesión ${label} del GP «${gpName}»`);

  // Q por orden temporal: la primera → q1, la segunda → q2. Una sola Q
  // (clasificación combinada) cuenta como q2.
  const firstQ = qs[0];
  const secondQ = qs[1];
  if (firstQ) {
    if (secondQ) {
      events.push({ type: "q1", startTime: startTime(firstQ, "Q1") });
      events.push({ type: "q2", startTime: startTime(secondQ, "Q2") });
    } else {
      events.push({ type: "q2", startTime: startTime(firstQ, "Q2") });
    }
  }

  // Sprint y carrera: la última por fecha (carrera/sprint reiniciada).
  const lastSprint = sprints[sprints.length - 1];
  if (lastSprint) {
    events.push({ type: "sprint", startTime: startTime(lastSprint, "SPR") });
  }
  const lastRace = races[races.length - 1];
  if (lastRace) {
    events.push({ type: "race", startTime: startTime(lastRace, "RAC") });
  }

  events.sort((a, b) => WEEKEND_EVENT_ORDER[a.type] - WEEKEND_EVENT_ORDER[b.type]);

  const missing: string[] = [];
  if (!events.some((e) => e.type === "q2")) missing.push("Q2");
  if (!lastRace) missing.push("la carrera");
  if (missing.length > 0) {
    throw new CalendarNormalizationError(
      `El GP «${gpName}» no tiene ${missing.join(" ni ")} en la fuente; corrígelo manualmente.`,
    );
  }

  return {
    events,
    raceDate: lastRace ? startTime(lastRace, "RAC") : null,
  };
}

/**
 * Normaliza un calendario crudo de PulseLive (pura — sin I/O).
 *
 * Lanza `CalendarNormalizationError` si los datos no se pueden mapear
 * (sin eventos, o un GP sin Q2 o sin carrera).
 */
export function normalizePulseLiveCalendar(
  raw: PulseLiveRawCalendar,
  source: { name: string; version: string },
): NormalizedSeasonCalendar {
  const events = raw.events
    .filter((event) => event.test !== true)
    .sort(
      (a, b) => a.date_start.localeCompare(b.date_start) || a.name.localeCompare(b.name),
    );

  if (events.length === 0) {
    throw new CalendarNormalizationError(
      `La fuente no tiene eventos para la temporada ${raw.season.year}.`,
    );
  }

  const gps: CalendarGp[] = events.map((event, index) => {
    const sessions = raw.sessionsByEvent[event.id] ?? [];
    const weekend = mapWeekendSessions(event.name, sessions);
    // Fecha del GP = fecha de la carrera; fallback: date_end (UTC medianoche).
    const fallback = new Date(`${event.date_end}T00:00:00.000Z`);
    if (Number.isNaN(fallback.getTime())) {
      throw new CalendarNormalizationError(
        `La fuente devolvió una fecha inválida para el evento «${event.name}»: «${event.date_end}».`,
      );
    }
    const date = weekend.raceDate ?? fallback;
    return {
      round: index + 1,
      name: event.name,
      circuit: {
        name: event.circuit.name,
        country: event.country.name,
        location: event.circuit.place ?? null,
      },
      date,
      events: weekend.events,
    };
  });

  return {
    year: raw.season.year,
    seasonRef: raw.season.id,
    source,
    gps,
  };
}

// ── Implementación PulseLive (I/O fina, fetch inyectable) ─────────────────

const PULSELIVE_BASE_URL = "https://api.motogp.pulselive.com/motogp/v1";
/**
 * Categoría MotoGP en PulseLive (`legacy_id: 3`): se descubre en
 * `/results/categories` por ese identificador, no se hardcodea el UUID.
 */
const MOTO_GP_LEGACY_CATEGORY_ID = 3;

export interface PulseLiveCalendarSourceOptions {
  /** Para tests o proxies. */
  baseUrl?: string;
  /** Fetch inyectable (tests sin red). */
  fetchImpl?: typeof fetch;
}

/**
 * Fuente de calendario PulseLive (ADR-0012): GET sin auth.
 *
 * Flujo: 1) temporada por año → 2) categoría MotoGP → 3) eventos de la
 * temporada → 4) sesiones por evento. N+1 peticiones (~24 por temporada):
 * aceptable para una acción de admin.
 */
export class PulseLiveCalendarSource implements CalendarSource {
  readonly meta = { name: "pulselive", version: "v1" };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PulseLiveCalendarSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? PULSELIVE_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchSeasonCalendar(year: number): Promise<NormalizedSeasonCalendar> {
    const seasons = await this.getJson<PulseLiveSeason[]>(
      `${this.baseUrl}/results/seasons`,
    );
    const season = seasons.find((candidate) => candidate.year === year);
    if (!season) {
      throw new CalendarSourceError(`La fuente no tiene temporada para el año ${year}.`);
    }

    const categories = await this.getJson<PulseLiveCategory[]>(
      `${this.baseUrl}/results/categories?seasonUuid=${season.id}`,
    );
    const category = categories.find((c) => c.legacy_id === MOTO_GP_LEGACY_CATEGORY_ID);
    if (!category) {
      throw new CalendarSourceError(
        "La fuente no tiene la categoría MotoGP para la temporada.",
      );
    }

    const events = await this.getJson<PulseLiveEvent[]>(
      `${this.baseUrl}/results/events?seasonUuid=${season.id}`,
    );

    const sessionsByEvent: Record<string, PulseLiveSession[]> = {};
    for (const event of events) {
      sessionsByEvent[event.id] = await this.getJson<PulseLiveSession[]>(
        `${this.baseUrl}/results/sessions?eventUuid=${event.id}&categoryUuid=${category.id}`,
      );
    }

    return normalizePulseLiveCalendar({ season, events, sessionsByEvent }, this.meta);
  }

  private async getJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new CalendarSourceError(
        `No se pudo contactar con la fuente de calendario: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new CalendarSourceError(
        `La fuente de calendario respondió HTTP ${response.status}.`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new CalendarSourceError(
        "La fuente de calendario respondió contenido no JSON.",
      );
    }
  }
}
