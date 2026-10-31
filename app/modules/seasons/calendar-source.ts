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
  /**
   * Referencia estable del evento en la fuente (mapa a `Gp.sourceRef`,
   * US-17/ADR-0019); `null` si la fuente no la proporciona.
   */
  sourceEventRef: string | null;
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

// ── Timezones (PulseLive devuelve hora local etiquetada como UTC) ──────────
//
// PulseLive devuelve la hora local del país del evento con offset `+00:00`
// (p. ej. la sprint de Malasia a las 15:00 MYT llega como
// `2026-10-31T15:00:00+00:00`). Para recuperar la UTC real, se interpreta la
// hora como reloj local en el timezone IANA del circuito y se convierte.
// (Verificado 2026-10-31 contra motogp.com: sprint/race Sepang 15:00 local =
// 07:00 UTC; la API las devuelve como 15:00+00:00.)

/** País → timezone IANA (países con un solo huso relevante para MotoGP). */
const COUNTRY_TIMEZONES: Record<string, string> = {
  Australia: "Australia/Melbourne",
  Austria: "Europe/Vienna",
  Brazil: "America/Sao_Paulo",
  Czechia: "Europe/Prague",
  France: "Europe/Paris",
  Germany: "Europe/Berlin",
  Hungary: "Europe/Budapest",
  Indonesia: "Asia/Jakarta",
  Italy: "Europe/Rome",
  Japan: "Asia/Tokyo",
  Malaysia: "Asia/Kuala_Lumpur",
  Netherlands: "Europe/Amsterdam",
  Portugal: "Europe/Lisbon",
  Qatar: "Asia/Qatar",
  "San Marino": "Europe/Rome",
  Spain: "Europe/Madrid",
  Thailand: "Asia/Bangkok",
  "United Kingdom of Great Britain and Northern Ireland": "Europe/London",
  "United States of America": "America/Chicago",
};

/**
 * Overrides por circuito (países con varios husos): el circuito manda sobre
 * el país. P. ej. Mandalika (Lombok) está en WITA (UTC+8), no WIB/Jakarta
 * (UTC+7).
 */
const CIRCUIT_TIMEZONES: Record<string, string> = {
  "Pertamina Mandalika Circuit": "Asia/Makassar",
};

/**
 * Resuelve el timezone IANA de un evento. Fail-closed: si no hay mapeo,
 * lanza `CalendarNormalizationError` (no se adivina el huso).
 */
function resolveTimezone(circuitName: string, countryName: string): string {
  const byCircuit = CIRCUIT_TIMEZONES[circuitName];
  if (byCircuit) return byCircuit;
  const byCountry = COUNTRY_TIMEZONES[countryName];
  if (byCountry) return byCountry;
  throw new CalendarNormalizationError(
    `No hay timezone IANA mapeado para el circuito «${circuitName}» (país «${countryName}»); añádelo al mapa de timezones de la fuente.`,
  );
}

/** Offset (ms) de `timeZone` respecto a UTC en el instante `utcMs`. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}

/**
 * Convierte una hora reloj local (componentes) a un instante UTC (ms),
 * manejando el DST con dos iteraciones (el offset puede cambiar entre la
 * estimación inicial y la hora corregida).
 */
function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number {
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let utc = guessUtc - tzOffsetMs(guessUtc, timeZone);
  utc = guessUtc - tzOffsetMs(utc, timeZone);
  return utc;
}

/**
 * Convierte la fecha ISO de la fuente (hora local etiquetada como UTC) a
 * `Date` UTC real; `null` se conserva. Lanza si la fecha no se puede
 * interpretar como reloj local.
 */
function localWallClockToUtc(
  iso: string | null,
  timeZone: string,
  context: string,
): Date | null {
  if (iso === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  if (!match) {
    throw new CalendarNormalizationError(
      `La fuente devolvió una fecha inválida para ${context}: «${iso}».`,
    );
  }
  const toNum = (v: string | undefined): number => {
    const n = Number(v);
    if (Number.isNaN(n)) {
      throw new CalendarNormalizationError(
        `La fuente devolvió una fecha inválida para ${context}: «${iso}».`,
      );
    }
    return n;
  };
  const y = toNum(match[1]);
  const mo = toNum(match[2]);
  const d = toNum(match[3]);
  const h = toNum(match[4]);
  const mi = toNum(match[5]);
  const s = toNum(match[6]);
  return new Date(zonedTimeToUtc(y, mo, d, h, mi, s, timeZone));
}

interface MappedWeekend {
  events: CalendarWeekendEvent[];
  /** Fecha de la carrera (null si la fuente no lo proporciona). */
  raceDate: Date | null;
}

/**
 * Mapea las sesiones de un evento a eventos de fin de semana (reglas del
 * ADR-0012). Lanza `CalendarNormalizationError` si falta Q2 o la carrera.
 *
 * `timeZone` es el timezone IANA del circuito: las horas de la fuente son
 * reloj local y se convierten a UTC real (ver `localWallClockToUtc`).
 */
function mapWeekendSessions(
  gpName: string,
  sessions: PulseLiveSession[],
  timeZone: string,
): MappedWeekend {
  const sorted = sortByDate(sessions);
  const qs = sorted.filter((s) => s.type === "Q");
  const sprints = sorted.filter((s) => s.type === "SPR");
  const races = sorted.filter((s) => s.type === "RAC");

  const events: CalendarWeekendEvent[] = [];
  const startTime = (session: PulseLiveSession, label: string) =>
    localWallClockToUtc(session.date, timeZone, `la sesión ${label} del GP «${gpName}»`);

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
    const timeZone = resolveTimezone(event.circuit.name, event.country.name);
    const weekend = mapWeekendSessions(event.name, sessions, timeZone);
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
      sourceEventRef: event.id,
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
