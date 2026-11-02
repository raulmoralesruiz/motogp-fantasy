/**
 * Tests del punto de captura de Sentry de la app (T-14, ADR-0036).
 *
 * `app/server/sentry.ts` envuelve `@sentry/node` con dos garantías:
 * - **no-op sin DSN** (modo provisional): ni `withScope` ni `capture*` se
 *   llaman si `NEXT_PUBLIC_SENTRY_DSN` está vacío;
 * - **nunca lanza**: si el SDK lanza (p. ej. cliente caído), los capturers
 *   se tragan el error (reportar errores no puede romper el flujo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({
  withScope: vi.fn((cb: (scope: unknown) => unknown) =>
    cb({ setTag: vi.fn() }),
  ),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  withScope: sentryMocks.withScope,
  captureException: sentryMocks.captureException,
  captureMessage: sentryMocks.captureMessage,
}));

import {
  captureException,
  captureMessage,
  isSentryEnabled,
} from "../sentry";

const OLD_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (OLD_DSN === undefined) {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  } else {
    process.env.NEXT_PUBLIC_SENTRY_DSN = OLD_DSN;
  }
});

describe("isSentryEnabled (T-14, ADR-0036)", () => {
  it("false con DSN vacío o ausente (modo provisional)", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "";
    expect(isSentryEnabled()).toBe(false);

    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    expect(isSentryEnabled()).toBe(false);
  });

  it("true con DSN presente", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.local/1";
    expect(isSentryEnabled()).toBe(true);
  });

  it("false con DSN de solo espacios (no cuenta como fijado)", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "   ";
    expect(isSentryEnabled()).toBe(false);
  });
});

describe("captureException / captureMessage (T-14, ADR-0036)", () => {
  it("sin DSN: NO tocan el SDK (no-op completo)", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "";

    captureException(new Error("boom"), { "trpc.path": "x" });
    captureMessage("hola", { a: "b" });

    expect(sentryMocks.withScope).not.toHaveBeenCalled();
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
    expect(sentryMocks.captureMessage).not.toHaveBeenCalled();
  });

  it("con DSN: captura con los tags del contexto", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.local/1";

    const setTag1 = vi.fn();
    sentryMocks.withScope.mockImplementation(
      (cb: (scope: unknown) => void) => cb({ setTag: setTag1 }),
    );
    captureException(new Error("boom"), { "trpc.path": "results.myScore" });
    expect(setTag1).toHaveBeenCalledWith("trpc.path", "results.myScore");
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);

    const setTag2 = vi.fn();
    sentryMocks.withScope.mockImplementation(
      (cb: (scope: unknown) => void) => cb({ setTag: setTag2 }),
    );
    captureMessage("alerta", { "alert.kind": "job-failed" });
    expect(setTag2).toHaveBeenCalledWith("alert.kind", "job-failed");
    expect(sentryMocks.captureMessage).toHaveBeenCalledWith("alerta");
  });

  it("si el SDK lanza: el capturer NO propaga (nunca lanza)", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://key@sentry.local/1";
    sentryMocks.withScope.mockImplementation(() => {
      throw new Error("sentry caído (test)");
    });

    expect(() =>
      captureException(new Error("boom"), { x: "y" }),
    ).not.toThrow();
    expect(() => captureMessage("alerta", {})).not.toThrow();
  });
});
