// @vitest-environment jsdom
/**
 * Tests de `app/terminos/page.tsx` (F3 P1, auth pages): los términos de uso
 * a los que apunta la casilla de aceptación del registro deben existir y ser
 * legibles — un consentimiento sin documento no es informado.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "../../../test/rtl";

import TerminosPage from "../page";

describe("TerminosPage", () => {
  it("muestra el título, la salida al registro y las secciones", () => {
    render(<TerminosPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Términos de uso",
    );
    expect(screen.getByRole("link", { name: "Volver al registro" })).toHaveAttribute(
      "href",
      "/registro",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "1. Qué es este servicio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "6. Limitación de responsabilidad" }),
    ).toBeInTheDocument();
  });

  it("declara que no es un producto oficial de MotoGP (sin licencias)", () => {
    render(<TerminosPage />);
    expect(
      screen.getByText(/No es un producto oficial ni patrocinado por MotoGP/),
    ).toBeInTheDocument();
  });

  it("ofrece un canal de contacto real y accionable (F3 P1)", () => {
    render(<TerminosPage />);
    expect(
      screen.getByRole("link", { name: "raumorales22@gmail.com" }),
    ).toHaveAttribute("href", "mailto:raumorales22@gmail.com");
  });
});
