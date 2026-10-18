/**
 * Tests de la tabla de transiciones de estado del GP (US-05).
 *
 * CA: el GP transita `scheduled → locked → finished/cancelled` y solo el
 * admin lo cambia (auditado — la parte de servicio se cubre en integración).
 * `scheduled → finished` no está permitido: el congelamiento de precios
 * ocurre en el lockout y debe preceder al fin (game-rules.md §6).
 */
import { describe, expect, it } from "vitest";

import {
  allowedGpStatusTransitions,
  canTransitionGpStatus,
  GP_STATUSES,
  GP_TRANSITIONS,
  isGpStatus,
} from "../gp-status";

describe("canTransitionGpStatus (US-05)", () => {
  it("scheduled → locked y scheduled → cancelled son válidas", () => {
    expect(canTransitionGpStatus("scheduled", "locked")).toBe(true);
    expect(canTransitionGpStatus("scheduled", "cancelled")).toBe(true);
  });

  it("locked → finished y locked → cancelled son válidas", () => {
    expect(canTransitionGpStatus("locked", "finished")).toBe(true);
    expect(canTransitionGpStatus("locked", "cancelled")).toBe(true);
  });

  it("scheduled → finished NO es válida (el lockout debe preceder al fin)", () => {
    expect(canTransitionGpStatus("scheduled", "finished")).toBe(false);
  });

  it("finished y cancelled son estados terminales", () => {
    for (const target of GP_STATUSES) {
      expect(canTransitionGpStatus("finished", target)).toBe(false);
      expect(canTransitionGpStatus("cancelled", target)).toBe(false);
    }
  });

  it("cambiar a su propio estado no es una transición (no-op del servicio)", () => {
    for (const status of GP_STATUSES) {
      expect(canTransitionGpStatus(status, status)).toBe(false);
    }
  });

  it("la tabla cubre todos los estados y allowedGpStatusTransitions la refleja", () => {
    for (const status of GP_STATUSES) {
      expect(GP_TRANSITIONS[status]).toBeDefined();
      expect(allowedGpStatusTransitions(status)).toEqual([...GP_TRANSITIONS[status]]);
    }
  });
});

describe("isGpStatus (US-05)", () => {
  it("acepta los cuatro estados y rechaza el resto", () => {
    for (const status of GP_STATUSES) {
      expect(isGpStatus(status)).toBe(true);
    }
    expect(isGpStatus("pending")).toBe(false);
    expect(isGpStatus("")).toBe(false);
    expect(isGpStatus(null)).toBe(false);
    expect(isGpStatus(42)).toBe(false);
  });
});
