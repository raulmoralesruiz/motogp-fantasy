// @vitest-environment jsdom
/**
 * Test de `app/global-error.tsx` (T-14, ADR-0036): error boundary global
 * de App Router.
 *
 * Contrato verificado:
 * - captura el error en `Sentry.captureException` (mock: en tests el SDK
 *   no se inicializa — sin DSN —; el mock verifica la llamada);
 * - renderiza la página de error estándar dentro de `<html lang="es">`.
 */
import { describe, expect, it, vi } from "vitest";

const sentryMocks = vi.hoisted(() => ({ captureException: vi.fn() }));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentryMocks.captureException,
}));

import { render, screen } from "../../test/rtl";

import GlobalError from "../global-error";

describe("GlobalError (T-14, ADR-0036)", () => {
  it("captura el error en Sentry y renderiza la página de error estándar", () => {
    const error = new Error("boom (test)");
    render(<GlobalError error={error} />);

    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureException).toHaveBeenCalledWith(error);
    // jsdom hoistea el <html> renderizado al documento raíz (layout.test).
    expect(document.documentElement.getAttribute("lang")).toBe("es");
    expect(screen.getByText(/Application error/)).toBeInTheDocument();
  });
});
