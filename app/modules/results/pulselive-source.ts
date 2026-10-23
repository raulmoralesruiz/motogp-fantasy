/**
 * Fuente de resultados PulseLive (US-17): patrón adapter (integrations.md
 * §1.1, ADR-0019).
 *
 * El núcleo solo conoce el contrato `ResultsSource`; PulseLive es la
 * implementación del MVP (verificada en vivo el 2026-10-21). La
 * normalización (payload crudo → `NormalizedEventResults`) es una función
 * pura (`normalizePulseLiveClassification`) testeada con fixtures grabadas;
 * la parte de I/O (`PulseLiveResultsSource`) es fina y se prueba con un
 * `fetchImpl` inyectado (sin red) — U2.
 *
 * Mapeo PulseLive (ADR-0019):
 * - `riderRef` = `rider.riders_id` (UUID estable; fail-closed si falta).
 * - Estados de entrada: `INSTND` → FINISHED; `OUTSTND`/`NOTFINISHFIRST` →
 *   DNF; `NOTONRESTARTGRID` → ABSENT; desconocido → error de normalización.
 * - Selección de sesión: la última `Q`/`SPR`/`RAC` por fecha (coherente con
 *   ADR-0012; carrera reiniciada → la segunda `RAC`).
 * - Bonos: `pole` (q2, posición 1); `fastest-lap` (race, piloto de
 *   `records[type="fastestLap"]`, solo si terminó); sprint sin bonos.
 * - `penalties`: siempre `[]` (la fuente no aporta DQ/time-penalty; el admin
 *   los añade vía import manual y la entrada queda en `raw` para auditoría).
 * - `rawPoints` = `points` del payload (puntos oficiales; `null` en Q2).
 * - `raw` = payload original de la entrada (auditoría).
 */

import { z } from "zod";

import type {
  ResultBonusCode,
  ResultEventKind,
  ResultPenaltyCode,
} from "@/shared/types";

import { resultEventLabel } from "./core/codes";

// ── Contrato normalizado ───────────────────────────────────────────────────

/**
 * Estado de un GP según la fuente (refinamiento del contrato de
 * integrations.md §1.1, ADR-0019). No confundir con `GpStatus` de
 * shared/types (FINISHED/DNF/ABSENT), que es el estado de puntuación por
 * piloto.
 */
export type SourceGpStatus =
  | "provisional"
  | "definitive"
  | "cancelled"
  | "not-started";

/** Entrada de resultados normalizada (integrations.md §1.1). */
export interface NormalizedResultEntry {
  /** Referencia estable del piloto en la fuente (`rider.riders_id`). */
  riderRef: string;
  /** Posición final (≥ 1). `null` si no terminó (DNF/ABSENT). */
  position: number | null;
  /** ¿Salió el piloto? `false` → ABSENT (no partícipe). */
  started: boolean;
  /** ¿Terminó el piloto? `true` → FINISHED (posición ≥ 1). */
  finished: boolean;
  /** Códigos de penalización (siempre `[]` en PulseLive). */
  penalties: readonly ResultPenaltyCode[];
  /** Códigos de bono aportados por la fuente (ver mapeo en la cabecera). */
  bonuses: readonly ResultBonusCode[];
  /** Puntos oficiales de la fuente (auditoría); `null` si no los aporta. */
  rawPoints: number | null;
  /** Payload original de la entrada (auditoría). */
  raw: Record<string, unknown>;
}

/** Resultados normalizados de un evento (lo devuelve `fetchEventResults`). */
export interface NormalizedEventResults {
  event: ResultEventKind;
  status: Exclude<SourceGpStatus, "not-started">;
  entries: NormalizedResultEntry[];
  /** Momento de la consulta (UTC; `Date` es superjson-safe, como el calendario). */
  fetchedAt: Date;
  /** Versión de la fuente (auditoría). */
  sourceVersion: string;
}

/** Contrato de fuente de resultados (adapter — integrations.md §1.1). */
export interface ResultsSource {
  /** Metadatos de la fuente (auditoría). */
  readonly meta: { name: string; version: string; authorized: boolean };
  fetchEventResults(
    gpId: string,
    event: ResultEventKind,
  ): Promise<NormalizedEventResults>;
  /** Estado del GP según la fuente (ADR-0019). */
  fetchGpStatus(gpId: string): Promise<SourceGpStatus>;
}

/** Fallo al comunicarse con la fuente (red, HTTP, vínculo, formato). */
export class PulseLiveSourceError extends Error {}

/**
 * El GP no está vinculado a un evento de la fuente (el admin debe
 * `results.linkSource`).
 */
export class SourceNotLinkedError extends PulseLiveSourceError {}

/**
 * La sesión seleccionada no ha terminado (estado esperado antes de que se
 * celebre; el job la salta sin contarla como fallo).
 */
export class SourceSessionNotFinishedError extends PulseLiveSourceError {}

/** Los datos de la fuente no se pueden normalizar (fail-closed). */
export class ResultsNormalizationError extends PulseLiveSourceError {}

// ── Payloads crudos de PulseLive (solo los campos que usa el normalizador) ─

/** Sesión de un evento (para la selección; distinta de la del calendario). */
export interface PulseLiveResultsSession {
  id: string;
  /** FP | PR | Q | SPR | WUP | RAC */
  type: string;
  /** ISO 8601 (UTC). */
  date: string | null;
  /** FINISHED | NOT-STARTED (estados observados). */
  status: string;
}

/** Referencia de piloto en una entrada o registro de la fuente. */
export interface PulseLiveRiderRef {
  /** UUID estable del piloto en la fuente (`riderRef`, ADR-0019). */
  riders_id: string;
  full_name: string;
}

/** Entrada de la clasificación (Q2/sprint/carrera). */
export interface PulseLiveClassificationEntry {
  /** Posición final (≥ 1). `null` si no terminó. */
  position: number | null;
  /** INSTND | OUTSTND | NOTFINISHFIRST | NOTONRESTARTGRID (observados). */
  status: string;
  /** Puntos oficiales de campeonato (ausente en Q2). */
  points?: number | null;
  rider: PulseLiveRiderRef;
}

/** Registro auxiliar (`bestLap`/`poleLap`/`fastestLap`/`recordLap`). */
export interface PulseLiveRecord {
  type: string;
  rider: PulseLiveRiderRef;
}

/** Clasificación cruda tal y como la devuelve `/results/classification`. */
export interface PulseLiveClassification {
  classification: PulseLiveClassificationEntry[];
  records: PulseLiveRecord[];
}

// ── Validación Zod (fail-closed) ───────────────────────────────────────────

const riderRefSchema = z
  .object({
    riders_id: z.string().min(1),
    full_name: z.string().min(1),
  })
  .passthrough();

const classificationEntrySchema = z
  .object({
    position: z.number().int().positive().nullable(),
    status: z.string().min(1),
    points: z.number().int().nullable().optional(),
    rider: riderRefSchema,
  })
  .passthrough();

const recordSchema = z
  .object({
    type: z.string().min(1),
    rider: riderRefSchema,
  })
  .passthrough();

const classificationSchema = z
  .object({
    classification: z.array(classificationEntrySchema).min(1),
    // Auxiliares: su ausencia no es un error (la normalización no depende).
    records: z.array(recordSchema).default([]),
  })
  .passthrough();

// ── Normalización pura ─────────────────────────────────────────────────────

/** Contexto de normalización (evento, GP, momento, fuente). */
export interface NormalizeClassificationContext {
  event: ResultEventKind;
  /** Nombre del GP (para los mensajes de error). */
  gpName: string;
  /** Momento de la consulta (UTC). */
  fetchedAt: Date;
  source: { name: string; version: string };
}

interface MappedEntryStatus {
  started: boolean;
  finished: boolean;
}

/**
 * Mapea el estado de entrada de la fuente a `started`/`finished`
 * (fail-closed, ADR-0019).
 */
function mapEntryStatus(
  status: string,
  ctx: NormalizeClassificationContext,
): MappedEntryStatus {
  switch (status) {
    case "INSTND":
      return { started: true, finished: true };
    case "OUTSTND":
    case "NOTFINISHFIRST":
      return { started: true, finished: false };
    case "NOTONRESTARTGRID":
      return { started: false, finished: false };
    default:
      throw new ResultsNormalizationError(
        `La fuente devolvió un estado de entrada desconocido «${status}» en ${resultEventLabel(
          ctx.event,
        )} del GP «${ctx.gpName}» (fail-closed, ADR-0019).`,
      );
  }
}

/**
 * Selecciona la sesión de un tipo de evento (pura; coherente con ADR-0012):
 * la última `Q`/`SPR`/`RAC` por fecha (carrera reiniciada → la segunda).
 *
 * Lanza `ResultsNormalizationError` si no hay sesión del tipo pedido
 * (inconsistencia de datos; el admin revisa el vínculo).
 */
export function selectPulseLiveSession(
  sessions: PulseLiveResultsSession[],
  event: ResultEventKind,
  gpName: string,
): PulseLiveResultsSession {
  const sessionType: Record<ResultEventKind, string> = {
    q2: "Q",
    sprint: "SPR",
    race: "RAC",
  };
  const wanted = sessionType[event];
  const candidates = sessions
    .filter((s) => s.type === wanted)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const last = candidates[candidates.length - 1];
  if (!last) {
    throw new ResultsNormalizationError(
      `El GP «${gpName}» no tiene sesión ${wanted} en la fuente para ${resultEventLabel(
        event,
      )}; revisa el vínculo (results.linkSource) (fail-closed, ADR-0019).`,
    );
  }
  return last;
}

/**
 * Normaliza una clasificación cruda de PulseLive (pura — sin I/O).
 *
 * Fail-closed (ADR-0019): lanza `ResultsNormalizationError` ante formato
 * inesperado (Zod), estado de entrada desconocido, falta de `riders_id`,
 * inconsistencia posición/terminado (en ambos sentidos) o piloto de
 * `fastestLap` ausente de la clasificación.
 */
export function normalizePulseLiveClassification(
  payload: unknown,
  ctx: NormalizeClassificationContext,
): NormalizedEventResults {
  const label = resultEventLabel(ctx.event);
  const gp = `GP «${ctx.gpName}»`;

  const parsed = classificationSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`)
      .join("; ");
    throw new ResultsNormalizationError(
      `La fuente devolvió un formato inesperado en ${label} del ${gp} (fail-closed, ADR-0019): ${issues}`,
    );
  }

  const { classification, records } = parsed.data;

  const entries: NormalizedResultEntry[] = classification.map((entry) => {
    const { started, finished } = mapEntryStatus(entry.status, ctx);

    // Coherencia posición/terminado (fail-closed, ambos sentidos).
    if (finished && entry.position === null) {
      throw new ResultsNormalizationError(
        `${gp} ${label}: «${entry.rider.full_name}» aparece como terminado sin posición (fail-closed, ADR-0019).`,
      );
    }
    if (!finished && entry.position !== null) {
      throw new ResultsNormalizationError(
        `${gp} ${label}: «${entry.rider.full_name}» tiene posición ${entry.position} sin haber terminado (fail-closed, ADR-0019).`,
      );
    }

    return {
      riderRef: entry.rider.riders_id,
      position: finished ? entry.position : null,
      started,
      finished,
      penalties: [],
      bonuses: [],
      rawPoints: entry.points ?? null,
      raw: entry,
    };
  });

  // Bonos aportados por la fuente (ADR-0019).
  if (ctx.event === "q2") {
    const pole = entries.find((e) => e.position === 1);
    if (pole) pole.bonuses = ["pole"];
  } else if (ctx.event === "race") {
    const fastestLap = records.find((record) => record.type === "fastestLap");
    if (fastestLap) {
      const holder = entries.find(
        (e) => e.riderRef === fastestLap.rider.riders_id,
      );
      if (!holder) {
        throw new ResultsNormalizationError(
          `${gp} ${label}: el piloto de la vuelta rápida («${fastestLap.rider.full_name}») no está en la clasificación (fail-closed, ADR-0019).`,
        );
      }
      // Vuelta rápida sin terminar no otorga bono (scoring.md).
      if (holder.finished) holder.bonuses = ["fastest-lap"];
    }
  }
  // sprint: sin bonos.

  return {
    event: ctx.event,
    status: "provisional",
    entries,
    fetchedAt: ctx.fetchedAt,
    sourceVersion: ctx.source.version,
  };
}

// ── Implementación PulseLive (I/O fina, dependencias inyectadas) ───────────

const PULSELIVE_BASE_URL = "https://api.motogp.pulselive.com/motogp/v1";
/**
 * Categoría MotoGP en PulseLive (`legacy_id: 3`): se descubre en
 * `/results/categories` por ese identificador, no se hardcodea el UUID
 * (mismo descubrimiento que el calendario, ADR-0012).
 */
const MOTO_GP_LEGACY_CATEGORY_ID = 3;

/**
 * Resolución del vínculo GP ↔ evento de la fuente (DI, ADR-0019): el
 * adapter no toca la BD (mismo patrón que `fetchImpl`), la capa de
 * servicio la implementa.
 */
export interface EventRefResolution {
  /** Año de la temporada del GP (descubrimiento de temporada/categoría). */
  seasonYear: number;
  /** Campo `id` del evento en la fuente; `null` si el GP no está vinculado. */
  eventRef: string | null;
  /** Nombre del GP (mensajes de error en español). */
  gpName: string;
}

export type EventRefResolver = (gpId: string) => Promise<EventRefResolution | null>;

/** Temporada de la fuente (solo los campos que usa el descubrimiento). */
export interface PulseLiveSourceSeason {
  id: string;
  year: number;
}

/** Categoría de la fuente (solo los campos que usa el descubrimiento). */
export interface PulseLiveSourceCategory {
  id: string;
  /** Identificador legado de la categoría (MotoGP = 3). */
  legacy_id: number;
}

/** Evento de la fuente (solo los campos que usa el catálogo, ADR-0019). */
export interface PulseLiveSourceEvent {
  id: string;
  name: string;
  /** Eventos de test: se excluyen del catálogo (mismo criterio que el calendario). */
  test?: boolean;
}

export interface PulseLiveResultsSourceOptions {
  /** Para tests o proxies. */
  baseUrl?: string;
  /** Fetch inyectable (tests sin red). */
  fetchImpl?: typeof fetch;
  /**
   * Resuelve el vínculo GP ↔ evento de la fuente (DI, ADR-0019). `null` →
   * el GP no existe en la BD; `eventRef = null` → no está vinculado
   * (`SourceNotLinkedError`). Por defecto: siempre `null` (fail-closed).
   */
  eventRefResolver?: EventRefResolver;
}

/**
 * Fuente de resultados PulseLive (US-17, ADR-0019): GET sin auth.
 *
 * Flujo de `fetchEventResults`: 1) resolver el vínculo del GP (DI) →
 * 2) descubrir temporada/categoría (caché en memoria por año) →
 * 3) sesiones del evento → 4) gate de sesión (`FINISHED`; si no,
 * `SourceSessionNotFinishedError`) → 5) clasificación → normalización pura.
 *
 * `fetchedAt` usa el reloj real (código de I/O; el `now` inyectado es del
 * job, que decide la ventana de polling, no del adapter).
 */
export class PulseLiveResultsSource implements ResultsSource {
  /** `authorized: false` — fuente pública sin autorización explícita (integrations.md §2.1). */
  readonly meta = { name: "pulselive", version: "v1", authorized: false };

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly eventRefResolver: EventRefResolver;
  /**
   * Caché en memoria de temporada/categoría descubiertas (por año,
   * ADR-0019): evita re-descubrir en cada intento del job.
   */
  private readonly seasonCache = new Map<
    number,
    { seasonId: string; categoryId: string }
  >();
  /**
   * Caché en memoria de eventos de temporada (por año, ADR-0019): el
   * calendario de la fuente es estable durante la temporada.
   */
  private readonly seasonEventsCache = new Map<
    number,
    Array<{ eventRef: string; name: string }>
  >();

  constructor(options: PulseLiveResultsSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? PULSELIVE_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.eventRefResolver = options.eventRefResolver ?? (async () => null);
  }

  async fetchEventResults(
    gpId: string,
    event: ResultEventKind,
  ): Promise<NormalizedEventResults> {
    const gp = await this.resolveGp(gpId);
    const { categoryId } = await this.discoverSeason(gp.seasonYear);

    const sessions = await this.getJson<PulseLiveResultsSession[]>(
      `${this.baseUrl}/results/sessions?eventUuid=${gp.eventRef}&categoryUuid=${categoryId}`,
    );

    // Gate de sesión (ADR-0019): `NOT-STARTED` → HTTP 400 en
    // `/classification`; se salta antes de fetchear.
    const session = selectPulseLiveSession(sessions, event, gp.gpName);
    if (session.status !== "FINISHED") {
      throw new SourceSessionNotFinishedError(
        `La sesión ${session.type} del GP «${gp.gpName}» no ha terminado (estado de la fuente: ${session.status}); se reintentará.`,
      );
    }

    const payload = await this.getJson<unknown>(
      `${this.baseUrl}/results/classification?sessionUuid=${session.id}&categoryUuid=${categoryId}`,
    );

    return normalizePulseLiveClassification(payload, {
      event,
      gpName: gp.gpName,
      fetchedAt: new Date(),
      source: this.meta,
    });
  }

  async fetchGpStatus(gpId: string): Promise<SourceGpStatus> {
    const gp = await this.resolveGp(gpId);
    const { categoryId } = await this.discoverSeason(gp.seasonYear);

    const sessions = await this.getJson<PulseLiveResultsSession[]>(
      `${this.baseUrl}/results/sessions?eventUuid=${gp.eventRef}&categoryUuid=${categoryId}`,
    );

    // La última sesión RAC representa el estado del GP (mismo criterio de
    // selección que `fetchEventResults`, ADR-0012/ADR-0019).
    const races = sessions
      .filter((s) => s.type === "RAC")
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    const last = races[races.length - 1];
    if (!last) {
      throw new ResultsNormalizationError(
        `El GP «${gp.gpName}» no tiene sesión RAC en la fuente; revisa el vínculo (results.linkSource) (fail-closed, ADR-0019).`,
      );
    }
    // PulseLive nunca declara «definitivo» (decisión admin, ADR-0018).
    switch (last.status) {
      case "FINISHED":
        return "provisional";
      case "NOT-STARTED":
        return "not-started";
      default:
        throw new PulseLiveSourceError(
          `La fuente devolvió un estado de sesión desconocido «${last.status}» para el GP «${gp.gpName}» (fail-closed, ADR-0019).`,
        );
    }
  }

  /**
   * Eventos de la temporada en la fuente (US-17, ADR-0019): catálogo para
   * `linkSource` (match por nombre) y la UI de admin. Extensión del
   * contrato `ResultsSource` (no forma parte de él; lo satisface
   * `SourceEventCatalog` del servicio). Reutiliza el descubrimiento de
   * temporada con caché por año; excluye eventos de test.
   */
  async listSeasonEvents(
    seasonYear: number,
  ): Promise<Array<{ eventRef: string; name: string }>> {
    const cached = this.seasonEventsCache.get(seasonYear);
    if (cached) return cached;

    const { seasonId } = await this.discoverSeason(seasonYear);
    const events = await this.getJson<PulseLiveSourceEvent[]>(
      `${this.baseUrl}/results/events?seasonUuid=${seasonId}`,
    );
    const list = events
      .filter((event) => event.test !== true)
      .map((event) => ({ eventRef: event.id, name: event.name }));
    this.seasonEventsCache.set(seasonYear, list);
    return list;
  }

  /** Resuelve el vínculo del GP; `eventRef = null` → `SourceNotLinkedError`. */
  private async resolveGp(gpId: string): Promise<EventRefResolution & { eventRef: string }> {
    const resolution = await this.eventRefResolver(gpId);
    if (!resolution) {
      throw new PulseLiveSourceError(
        `El GP «${gpId}» no se encontró en la base de datos.`,
      );
    }
    if (!resolution.eventRef) {
      throw new SourceNotLinkedError(
        `El GP «${resolution.gpName}» no está vinculado a un evento de la fuente; vincúlalo con results.linkSource (ADR-0019).`,
      );
    }
    return { ...resolution, eventRef: resolution.eventRef };
  }

  /**
   * Descubre temporada (por año) y categoría MotoGP (`legacy_id 3`) con
   * caché en memoria por temporada (ADR-0019).
   */
  private async discoverSeason(
    seasonYear: number,
  ): Promise<{ seasonId: string; categoryId: string }> {
    const cached = this.seasonCache.get(seasonYear);
    if (cached) return cached;

    const seasons = await this.getJson<PulseLiveSourceSeason[]>(
      `${this.baseUrl}/results/seasons`,
    );
    const season = seasons.find((candidate) => candidate.year === seasonYear);
    if (!season) {
      throw new PulseLiveSourceError(
        `La fuente no tiene temporada para el año ${seasonYear}.`,
      );
    }

    const categories = await this.getJson<PulseLiveSourceCategory[]>(
      `${this.baseUrl}/results/categories?seasonUuid=${season.id}`,
    );
    const category = categories.find(
      (c) => c.legacy_id === MOTO_GP_LEGACY_CATEGORY_ID,
    );
    if (!category) {
      throw new PulseLiveSourceError(
        `La fuente no tiene la categoría MotoGP para la temporada ${seasonYear}.`,
      );
    }

    const discovered = { seasonId: season.id, categoryId: category.id };
    this.seasonCache.set(seasonYear, discovered);
    return discovered;
  }

  private async getJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(url);
    } catch (error) {
      throw new PulseLiveSourceError(
        `No se pudo contactar con la fuente de resultados: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!response.ok) {
      throw new PulseLiveSourceError(
        `La fuente de resultados respondió HTTP ${response.status}.`,
      );
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new PulseLiveSourceError(
        "La fuente de resultados respondió contenido no JSON.",
      );
    }
  }
}
