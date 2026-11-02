/**
 * Tests del núcleo puro de alertas operativas (T-14, ADR-0036).
 *
 * - `evaluateAlertTransition`: la política anti-spam (alerta SOLO al cruzar
 *   el umbral y al recuperar; mientras el fallo persiste, no se repite).
 * - `isFinalFailure`: solo el último intento agotado dispara la alerta de
 *   job (no cada reintento).
 * - `alertSubject` / `alertBodyHtml`: formato de las alertas (asunto
 *   estable para filtrado; cuerpo sin datos de usuario).
 */
import { describe, expect, it } from "vitest";

import {
  alertBodyHtml,
  alertSubject,
  evaluateAlertTransition,
  isFinalFailure,
  type OpsAlert,
} from "../alerts";

const THRESHOLD = 3;

describe("evaluateAlertTransition (T-14, ADR-0036)", () => {
  it("alerta al cruzar el umbral de abajo arriba (prev < N ≤ new)", () => {
    expect(evaluateAlertTransition(2, 3, THRESHOLD)).toBe("threshold_reached");
    expect(evaluateAlertTransition(0, 5, THRESHOLD)).toBe("threshold_reached");
  });

  it("avisa al recuperar (prev ≥ N > new)", () => {
    expect(evaluateAlertTransition(3, 0, THRESHOLD)).toBe("recovered");
    expect(evaluateAlertTransition(9, 2, THRESHOLD)).toBe("recovered");
  });

  it("no repite la alerta mientras el fallo persiste sobre el umbral", () => {
    expect(evaluateAlertTransition(3, 4, THRESHOLD)).toBe("none");
    expect(evaluateAlertTransition(10, 11, THRESHOLD)).toBe("none");
  });

  it("no alerta cuando el contador se mantiene bajo el umbral", () => {
    expect(evaluateAlertTransition(0, 0, THRESHOLD)).toBe("none");
    expect(evaluateAlertTransition(1, 2, THRESHOLD)).toBe("none");
    expect(evaluateAlertTransition(2, 1, THRESHOLD)).toBe("none");
  });

  it("umbral de 1: cualquier primer fallo cruza", () => {
    expect(evaluateAlertTransition(0, 1, 1)).toBe("threshold_reached");
    expect(evaluateAlertTransition(1, 0, 1)).toBe("recovered");
  });
});

describe("isFinalFailure (T-14, ADR-0036)", () => {
  it("es final al agotar los reintentos", () => {
    expect(isFinalFailure(3, 3)).toBe(true);
    expect(isFinalFailure(4, 3)).toBe(true);
  });

  it("no es final mientras quedan reintentos", () => {
    expect(isFinalFailure(1, 3)).toBe(false);
    expect(isFinalFailure(2, 3)).toBe(false);
  });
});

const SAMPLES: Record<OpsAlert["kind"], OpsAlert> = {
  "source-poll-failure": {
    kind: "source-poll-failure",
    gpName: "GP de Indonesia",
    eventLabel: "carrera principal",
    consecutiveFailures: 3,
    lastError: "HTTP 503",
  },
  "source-poll-recovered": {
    kind: "source-poll-recovered",
    gpName: "GP de Indonesia",
    eventLabel: "Q2",
  },
  "source-probe-failure": {
    kind: "source-probe-failure",
    consecutiveFailures: 3,
    lastError: "timeout 5000 ms",
  },
  "source-probe-recovered": {
    kind: "source-probe-recovered",
    lastLatencyMs: 210,
  },
  "job-failed": {
    kind: "job-failed",
    queue: "gp-prices",
    jobId: "job-42",
    attempts: 3,
    reason: "lock ocupado",
  },
};

describe("alertSubject (T-14, ADR-0036)", () => {
  it("prefijo estable [alerta motogp] + el tipo va en el asunto", () => {
    for (const alert of Object.values(SAMPLES)) {
      expect(alertSubject(alert)).toMatch(/^\[alerta motogp\] /);
      expect(alertSubject(alert)).toContain(alert.kind);
    }
  });

  it("cada tipo tiene un asunto distinto (filtrable en el buzón)", () => {
    const subjects = new Set(Object.values(SAMPLES).map((a) => alertSubject(a)));
    expect(subjects.size).toBe(Object.keys(SAMPLES).length);
  });
});

describe("alertBodyHtml (T-14, ADR-0036)", () => {
  it("incluye el dato clave de cada tipo de alerta", () => {
    expect(alertBodyHtml(SAMPLES["source-poll-failure"])).toContain("GP de Indonesia");
    expect(alertBodyHtml(SAMPLES["source-poll-failure"])).toContain("3");
    expect(alertBodyHtml(SAMPLES["source-poll-failure"])).toContain("HTTP 503");

    expect(alertBodyHtml(SAMPLES["source-probe-failure"])).toContain("timeout 5000 ms");
    expect(alertBodyHtml(SAMPLES["source-probe-recovered"])).toContain("210 ms");

    expect(alertBodyHtml(SAMPLES["job-failed"])).toContain("gp-prices");
    expect(alertBodyHtml(SAMPLES["job-failed"])).toContain("job-42");
    expect(alertBodyHtml(SAMPLES["job-failed"])).toContain("lock ocupado");
  });

  it("apunta al panel de admin (acción orientada)", () => {
    for (const alert of Object.values(SAMPLES)) {
      expect(alertBodyHtml(alert)).toContain("Jobs y fuentes");
    }
  });
});
