/**
 * Tests de la fuente de resultados PulseLive (US-17, ADR-0019).
 *
 * - `normalizePulseLiveClassification`: función pura, testeada con fixtures
 *   grabados en vivo (GP de Indonesia 2026: Q2, sprint y carrera) y payloads
 *   sintéticos (fail-closed: estado desconocido, falta de `riders_id`,
 *   inconsistencia posición/terminado en ambos sentidos, piloto de
 *   `fastestLap` ausente, `NOTONRESTARTGRID`, etc.).
 * - `selectPulseLiveSession`: función pura (última sesión por tipo por
 *   fecha, carrera reiniciada, fecha nula, sin candidatos).
 *
 * La I/O (`PulseLiveResultsSource`: sesión sin terminar, GP sin vincular,
 * errores HTTP/timeout) se prueba en U2 con `fetchImpl` inyectado (sin red).
 */
import { describe, expect, it } from "vitest";

import type { ResultEventKind } from "@/shared/types";

import {
  normalizePulseLiveClassification,
  ResultsNormalizationError,
  selectPulseLiveSession,
  type NormalizeClassificationContext,
  type PulseLiveClassification,
  type PulseLiveClassificationEntry,
  type PulseLiveRecord,
  type PulseLiveResultsSession,
} from "../pulselive-source";

import {
  indonesiaQ2,
  indonesiaRace,
  indonesiaSprint,
} from "../../../../test/fixtures/pulselive/index";

const SOURCE = { name: "pulselive", version: "v1" };
const GP_NAME = "GRAND PRIX OF INDONESIA";
const FETCHED_AT = new Date("2026-10-21T12:00:00.000Z");

function ctx(
  event: ResultEventKind,
  gpName: string = GP_NAME,
): NormalizeClassificationContext {
  return { event, gpName, fetchedAt: FETCHED_AT, source: SOURCE };
}

function makeEntry(
  overrides: Partial<PulseLiveClassificationEntry> = {},
): PulseLiveClassificationEntry {
  return {
    position: 1,
    status: "INSTND",
    rider: { riders_id: "rid-1", full_name: "Piloto Uno" },
    ...overrides,
  };
}

function makePayload(
  classification: PulseLiveClassificationEntry[],
  records: PulseLiveRecord[] = [],
): PulseLiveClassification {
  return { classification, records };
}

let sessionCounter = 0;
function makeSession(
  type: string,
  date: string | null,
): PulseLiveResultsSession {
  sessionCounter += 1;
  return { id: `s-${sessionCounter}`, type, date, status: "FINISHED" };
}

describe("normalizePulseLiveClassification — fixtures Indonesia 2026 (US-17)", () => {
  it("Q2: 12 entradas, todas salidas y terminadas, posiciones 1–12 en orden", () => {
    const result = normalizePulseLiveClassification(indonesiaQ2, ctx("q2"));

    expect(result).toMatchObject({
      event: "q2",
      status: "provisional",
      fetchedAt: FETCHED_AT,
      sourceVersion: "v1",
    });
    expect(result.entries).toHaveLength(12);
    for (const [i, entry] of result.entries.entries()) {
      expect(entry.position).toBe(i + 1);
      expect(entry.started).toBe(true);
      expect(entry.finished).toBe(true);
      expect(entry.penalties).toEqual([]);
      expect(entry.rawPoints).toBeNull();
    }
  });

  it("Q2: pole (posición 1) con bono; raw conserva el payload original", () => {
    const result = normalizePulseLiveClassification(indonesiaQ2, ctx("q2"));
    const first = result.entries[0];
    expect(first).toBeDefined();
    expect(first?.riderRef).toBe("eec1f7dc-b115-44f6-82aa-73130e5c92cf");
    expect(first?.bonuses).toEqual(["pole"]);
    for (const entry of result.entries.slice(1)) {
      expect(entry.bonuses).toEqual([]);
    }
    // raw: payload original de la entrada (auditoría).
    expect(first?.raw).toMatchObject({
      id: "8b1d7285-95d4-4bbd-8566-947036a2c56d",
      position: 1,
      status: "INSTND",
    });
    expect(first?.raw).toHaveProperty("team");
    expect(first?.raw).toHaveProperty("constructor");
  });

  it("sprint: 22 entradas (20 terminadas + 2 DNF NOTFINISHFIRST), sin bonos", () => {
    const result = normalizePulseLiveClassification(indonesiaSprint, ctx("sprint"));

    expect(result.entries).toHaveLength(22);
    const finished = result.entries.filter((e) => e.finished);
    const dnf = result.entries.filter((e) => !e.finished);
    expect(finished).toHaveLength(20);
    expect(dnf).toHaveLength(2);
    for (const entry of dnf) {
      expect(entry.position).toBeNull();
      expect(entry.started).toBe(true);
      expect(entry.finished).toBe(false);
      expect(entry.bonuses).toEqual([]);
      expect(entry.rawPoints).toBe(0);
    }
    for (const entry of finished) {
      expect(entry.position).not.toBeNull();
      expect(entry.bonuses).toEqual([]);
    }
  });

  it("sprint: DNF con riders_id conocidos; ganador con 12 puntos", () => {
    const result = normalizePulseLiveClassification(indonesiaSprint, ctx("sprint"));
    const byRef = new Map(result.entries.map((e) => [e.riderRef, e]));
    const bezzecchi = byRef.get("e622ec5b-5ccf-457c-a67f-ec028f0ddf6e");
    const fernandez = byRef.get("eec1f7dc-b115-44f6-82aa-73130e5c92cf");
    expect(bezzecchi?.finished).toBe(false);
    expect(fernandez?.finished).toBe(false);
    const winner = byRef.get("23e50438-a657-4fb0-a190-3262b5472f29");
    expect(winner?.position).toBe(1);
    expect(winner?.rawPoints).toBe(12);
  });

  it("carrera: 21 entradas (17 terminadas + 4 DNF OUTSTND)", () => {
    const result = normalizePulseLiveClassification(indonesiaRace, ctx("race"));

    expect(result.entries).toHaveLength(21);
    const dnfRefs = [
      "c883a3b8-17ce-419d-b71b-32c252f6fc7e", // Toprak
      "b0c1fea6-2dd5-4e26-8a18-0ac9fe6870e4", // Miller
      "66b78301-5826-4986-b11e-fa68a7bd77a7", // Bagnaia
      "71052114-5bce-4307-908c-4cc2bd387aac", // Aldeguer
    ];
    const byRef = new Map(result.entries.map((e) => [e.riderRef, e]));
    for (const ref of dnfRefs) {
      const entry = byRef.get(ref);
      expect(entry).toBeDefined();
      expect(entry?.position).toBeNull();
      expect(entry?.started).toBe(true);
      expect(entry?.finished).toBe(false);
      expect(entry?.rawPoints).toBe(0);
    }
  });

  it("carrera: vuelta rápida (holder terminó) con bono fastest-lap; ganador 25 pts", () => {
    const result = normalizePulseLiveClassification(indonesiaRace, ctx("race"));
    const byRef = new Map(result.entries.map((e) => [e.riderRef, e]));
    const bezzecchi = byRef.get("e622ec5b-5ccf-457c-a67f-ec028f0ddf6e");
    expect(bezzecchi?.position).toBe(1);
    expect(bezzecchi?.finished).toBe(true);
    expect(bezzecchi?.bonuses).toEqual(["fastest-lap"]);
    expect(bezzecchi?.rawPoints).toBe(25);
    // Solo un piloto con bonos.
    expect(result.entries.filter((e) => e.bonuses.length > 0)).toHaveLength(1);
  });
});

describe("normalizePulseLiveClassification — sintéticos fail-closed (ADR-0019)", () => {
  it("estado de entrada desconocido → error con el estado y el GP", () => {
    expect(() =>
      normalizePulseLiveClassification(
        makePayload([makeEntry({ status: "MISTERIOSO" })]),
        ctx("race"),
      ),
    ).toThrow(
      `estado de entrada desconocido «MISTERIOSO» en carrera principal del GP «${GP_NAME}» (fail-closed, ADR-0019)`,
    );
  });

  it("falta riders_id → error de formato (Zod)", () => {
    expect(() =>
      normalizePulseLiveClassification(
        {
          classification: [
            { position: 1, status: "INSTND", rider: { full_name: "Sin ID" } },
          ],
        },
        ctx("sprint"),
      ),
    ).toThrow(ResultsNormalizationError);
  });

  it("terminado sin posición → error con el nombre del piloto", () => {
    expect(() =>
      normalizePulseLiveClassification(
        makePayload([makeEntry({ position: null })]),
        ctx("q2"),
      ),
    ).toThrow("«Piloto Uno» aparece como terminado sin posición");
  });

  it("posición sin haber terminado → error con el nombre del piloto", () => {
    expect(() =>
      normalizePulseLiveClassification(
        makePayload([makeEntry({ status: "OUTSTND", position: 5 })]),
        ctx("race"),
      ),
    ).toThrow("«Piloto Uno» tiene posición 5 sin haber terminado");
  });

  it("fastestLap: piloto no está en la clasificación → error", () => {
    expect(() =>
      normalizePulseLiveClassification(
        makePayload(
          [makeEntry()],
          [
            {
              type: "fastestLap",
              rider: { riders_id: "rid-otra", full_name: "Otro Piloto" },
            },
          ],
        ),
        ctx("race"),
      ),
    ).toThrow("el piloto de la vuelta rápida («Otro Piloto») no está en la clasificación");
  });

  it("fastestLap: holder DNF → sin bono (no es error)", () => {
    const result = normalizePulseLiveClassification(
      makePayload(
        [
          makeEntry(),
          makeEntry({
            position: null,
            status: "NOTFINISHFIRST",
            rider: { riders_id: "rid-otra", full_name: "Otro Piloto" },
          }),
        ],
        [
          {
            type: "fastestLap",
            rider: { riders_id: "rid-otra", full_name: "Otro Piloto" },
          },
        ],
      ),
      ctx("race"),
    );
    const holder = result.entries.find((e) => e.riderRef === "rid-otra");
    expect(holder?.bonuses).toEqual([]);
    expect(result.entries.filter((e) => e.bonuses.length > 0)).toHaveLength(0);
  });

  it("clasificación vacía → error de formato (Zod min 1)", () => {
    expect(() =>
      normalizePulseLiveClassification(makePayload([]), ctx("race")),
    ).toThrow(ResultsNormalizationError);
  });

  it("payload no objeto → error de formato (Zod)", () => {
    for (const payload of [null, "hola", 42, []]) {
      expect(() => normalizePulseLiveClassification(payload, ctx("race"))).toThrow(
        ResultsNormalizationError,
      );
    }
  });

  it("NOTONRESTARTGRID → ABSENT (no salió, no terminó)", () => {
    const result = normalizePulseLiveClassification(
      makePayload([
        makeEntry(),
        makeEntry({
          position: null,
          status: "NOTONRESTARTGRID",
          points: null,
          rider: { riders_id: "rid-2", full_name: "Piloto Dos" },
        }),
      ]),
      ctx("sprint"),
    );
    const absent = result.entries.find((e) => e.riderRef === "rid-2");
    expect(absent).toMatchObject({
      position: null,
      started: false,
      finished: false,
      bonuses: [],
      penalties: [],
      rawPoints: null,
    });
  });

  it("records ausente → default [] (no es error)", () => {
    const result = normalizePulseLiveClassification(
      { classification: [makeEntry()] },
      ctx("race"),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.bonuses).toEqual([]);
  });

  it("q2: sin posición 1 → nadie con bono de pole", () => {
    const result = normalizePulseLiveClassification(
      makePayload([
        makeEntry({
          position: 2,
          rider: { riders_id: "rid-2", full_name: "Piloto Dos" },
        }),
      ]),
      ctx("q2"),
    );
    expect(result.entries[0]?.bonuses).toEqual([]);
  });
});

describe("selectPulseLiveSession (US-17)", () => {
  it("q2: la última Q por fecha (de varias)", () => {
    const sessions = [
      makeSession("Q", "2026-03-08T12:00:00+00:00"),
      makeSession("Q", "2026-03-08T12:45:00+00:00"),
      makeSession("RAC", "2026-03-09T13:00:00+00:00"),
    ];
    const selected = selectPulseLiveSession(sessions, "q2", GP_NAME);
    expect(selected.type).toBe("Q");
    expect(selected.date).toBe("2026-03-08T12:45:00+00:00");
  });

  it("sprint: la última SPR por fecha", () => {
    const sessions = [
      makeSession("SPR", "2026-03-08T14:00:00+00:00"),
      makeSession("SPR", "2026-03-08T15:00:00+00:00"),
    ];
    const selected = selectPulseLiveSession(sessions, "sprint", GP_NAME);
    expect(selected.date).toBe("2026-03-08T15:00:00+00:00");
  });

  it("carrera reiniciada: la segunda RAC", () => {
    const sessions = [
      makeSession("RAC", "2026-03-09T13:00:00+00:00"),
      makeSession("RAC", "2026-03-09T16:00:00+00:00"),
    ];
    const selected = selectPulseLiveSession(sessions, "race", GP_NAME);
    expect(selected.date).toBe("2026-03-09T16:00:00+00:00");
  });

  it("fecha nula se ordena primero (pierde contra cualquier fecha)", () => {
    const sessions = [
      makeSession("Q", "2026-03-08T12:00:00+00:00"),
      makeSession("Q", null),
    ];
    const selected = selectPulseLiveSession(sessions, "q2", GP_NAME);
    expect(selected.date).toBe("2026-03-08T12:00:00+00:00");
  });

  it("sin sesión del tipo → error mencionando el GP y el vínculo", () => {
    const sessions = [makeSession("RAC", "2026-03-09T13:00:00+00:00")];
    expect(() => selectPulseLiveSession(sessions, "q2", "GP SIN Q")).toThrow(
      "El GP «GP SIN Q» no tiene sesión Q en la fuente para Q2; revisa el vínculo (results.linkSource)",
    );
  });
});
