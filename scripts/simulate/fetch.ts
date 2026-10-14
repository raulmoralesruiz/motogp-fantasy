/**
 * Fetch — datos reales de PulseLive (pública, sin auth) → fixtures.
 *
 * Genera:
 *   data/fixtures/season-2026.json  (GPs terminados + roster + clasificación)
 *   data/fixtures/season-2025.json  (clasificación 2025 → base de P0)
 *
 * Uso: `npm run fetch:data`
 *
 * Fuente: `docs/architecture/integrations.md` (adapter `PulseLiveSource`).
 * Este script es la implementación de lectura de ese adapter para la
 * simulación; la app usará el contrato `ResultsSource` con la misma lógica.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  Gp,
  GpResult,
  GpStatus,
  PrevSeasonFixture,
  RiderAsset,
  SeasonFixture,
  StandingEntry,
} from "../../app/shared/types/index.js";

const BASE = "https://api.motogp.pulselive.com/motogp/v1";
const YEAR = 2026;
const PREV_YEAR = 2025;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES_DIR = join(ROOT, "data", "fixtures");

// ---------------------------------------------------------------------------
// Cliente HTTP con reintentos
// ---------------------------------------------------------------------------

async function getJson(url: string, attempt = 1): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} para ${url}`);
    return (await res.json()) as unknown;
  } catch (err) {
    if (attempt >= 3) throw err;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return getJson(url, attempt + 1);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Mapeo de la respuesta cruda a los tipos de fixture
// ---------------------------------------------------------------------------

interface RawRider {
  riders_id: string;
  full_name: string;
  number?: number;
}
interface RawTeam {
  name: string;
}
interface RawClassificationEntry {
  position: number | null;
  rider: RawRider;
  team?: RawTeam;
  constructor?: RawTeam;
  total_laps?: number;
  status?: string;
}
interface RawStandings {
  classification: RawClassificationEntry[];
}
interface RawSession {
  id: string;
  type: string;
  date: string;
}
interface RawEvent {
  id: string;
  short_name: string;
  name: string;
  date_start: string;
  status: string;
  test: boolean;
}

/**
 * Mapeo de estado robusto (no depende del código crudo):
 *   posición asignada → FINISHED · sin posición y con vueltas → DNF ·
 *   sin posición y sin vueltas → ABSENT (no salió).
 */
function mapStatus(entry: RawClassificationEntry): GpStatus {
  if (entry.position != null) return "FINISHED";
  return (entry.total_laps ?? 0) > 0 ? "DNF" : "ABSENT";
}

function mapResult(entry: RawClassificationEntry): GpResult {
  return {
    riderId: entry.rider.riders_id,
    position: entry.position,
    status: mapStatus(entry),
    laps: entry.total_laps ?? 0,
  };
}

function mapStanding(entry: RawClassificationEntry): StandingEntry {
  return {
    riderId: entry.rider.riders_id,
    name: entry.rider.full_name,
    points: (entry as RawClassificationEntry & { points?: number }).points ?? 0,
    team: entry.team?.name,
    constructor: entry.constructor?.name,
  };
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async function fetchSeasons(): Promise<Map<number, string>> {
  const seasons = (await getJson(`${BASE}/results/seasons`)) as Array<{
    id: string;
    year: number;
  }>;
  return new Map(seasons.map((s) => [s.year, s.id]));
}

async function fetchMotoGpCategory(seasonUuid: string): Promise<string> {
  const categories = (await getJson(
    `${BASE}/results/categories?seasonUuid=${seasonUuid}`,
  )) as Array<{ id: string; name: string }>;
  const m = categories.find((c) => c.name.toLowerCase().includes("motogp"));
  if (!m) throw new Error("Categoría MotoGP no encontrada");
  return m.id;
}

async function fetchGps(seasonUuid: string, categoryUuid: string): Promise<Gp[]> {
  const events = (await getJson(
    `${BASE}/results/events?seasonUuid=${seasonUuid}`,
  )) as RawEvent[];
  const finished = events
    .filter((e) => e.status === "FINISHED" && !e.test)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));

  const gps: Gp[] = [];
  for (let i = 0; i < finished.length; i++) {
    const ev = finished[i];
    if (!ev) continue;
    const sessions = (await getJson(
      `${BASE}/results/sessions?eventUuid=${ev.id}&categoryUuid=${categoryUuid}`,
    )) as RawSession[];
    const race = sessions.find((s) => s.type === "RAC");
    if (!race) {
      console.warn(`⚠️  ${ev.short_name}: sin sesión RAC, se omite`);
      continue;
    }
    const cls = (await getJson(
      `${BASE}/results/session/${race.id}/classification?seasonYear=${YEAR}`,
    )) as { classification: RawClassificationEntry[] };
    gps.push({
      order: i + 1,
      shortName: ev.short_name,
      name: ev.name,
      date: race.date.slice(0, 10),
      results: cls.classification.map(mapResult),
    });
    console.log(
      `  GP ${i + 1}/${finished.length} ${ev.short_name} (${cls.classification.length} pilotos)`,
    );
    await sleep(250);
  }
  return gps;
}

async function fetchRawStandings(
  seasonUuid: string,
  categoryUuid: string,
): Promise<RawStandings> {
  return (await getJson(
    `${BASE}/results/standings?seasonUuid=${seasonUuid}&categoryUuid=${categoryUuid}`,
  )) as RawStandings;
}

async function main(): Promise<void> {
  console.log("Fetch de datos reales (PulseLive) → data/fixtures/");
  const seasons = await fetchSeasons();
  const uuid26 = seasons.get(YEAR);
  const uuid25 = seasons.get(PREV_YEAR);
  if (!uuid26 || !uuid25)
    throw new Error(`Temporadas ${YEAR}/${PREV_YEAR} no encontradas`);
  const categoryUuid = await fetchMotoGpCategory(uuid26);

  console.log(`\nClasificación ${YEAR}:`);
  const raw26 = await fetchRawStandings(uuid26, categoryUuid);
  const standings26: StandingEntry[] = raw26.classification.map(mapStanding);
  const roster: RiderAsset[] = raw26.classification
    .filter((e) => e.team && e.constructor)
    .map((e) => ({
      riderId: e.rider.riders_id,
      name: e.rider.full_name,
      team: e.team!.name,
      constructor: e.constructor!.name,
      number: e.rider.number ?? 0,
    }));
  console.log(`  ${roster.length} pilotos en el roster`);

  console.log(`\nGPs ${YEAR} terminados:`);
  const gps = await fetchGps(uuid26, categoryUuid);

  console.log(`\nClasificación ${PREV_YEAR} (base de P0):`);
  const raw25 = await fetchRawStandings(uuid25, categoryUuid);
  const standings25: StandingEntry[] = raw25.classification.map(mapStanding);
  console.log(`  ${standings25.length} pilotos`);

  const fixture26: SeasonFixture = {
    year: YEAR,
    seasonUuid: uuid26,
    categoryUuid,
    fetchedAt: new Date().toISOString(),
    gps,
    roster,
    standings: standings26,
  };
  const fixture25: PrevSeasonFixture = {
    year: PREV_YEAR,
    seasonUuid: uuid25,
    categoryUuid,
    fetchedAt: new Date().toISOString(),
    standings: standings25,
  };

  await mkdir(FIXTURES_DIR, { recursive: true });
  const f26 = join(FIXTURES_DIR, `season-${YEAR}.json`);
  const f25 = join(FIXTURES_DIR, `season-${PREV_YEAR}.json`);
  await writeFile(f26, JSON.stringify(fixture26, null, 2));
  await writeFile(f25, JSON.stringify(fixture25, null, 2));
  console.log(`\n✅ ${f26} (${gps.length} GPs, ${roster.length} pilotos)`);
  console.log(`✅ ${f25} (${standings25.length} pilotos)`);
}

main().catch((err) => {
  console.error("❌ Fetch fallido:", err);
  process.exit(1);
});
