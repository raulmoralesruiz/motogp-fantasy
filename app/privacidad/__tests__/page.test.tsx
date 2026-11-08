// @vitest-environment jsdom
/**
 * Tests de `app/privacidad/page.tsx` (F3 P1, auth pages): la política de
 * privacidad a la que apunta la casilla de aceptación del registro debe
 * existir y describir los datos reales y los derechos GDPR ya implementados
 * (exportación JSON y eliminación/anonimización — US-03, ADR-0016).
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "../../../test/rtl";

import PrivacidadPage from "../page";

describe("PrivacidadPage", () => {
  it("muestra el título, la salida al registro y las secciones", () => {
    render(<PrivacidadPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Política de privacidad",
    );
    expect(screen.getByRole("link", { name: "Volver al registro" })).toHaveAttribute(
      "href",
      "/registro",
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "1. Qué datos recogemos" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "4. Tus derechos" }),
    ).toBeInTheDocument();
  });

  it("describe los derechos GDPR ya implementados (exportación y supresión)", () => {
    render(<PrivacidadPage />);
    expect(screen.getByText(/exporta todos tus datos en un archivo JSON/i)).toBeInTheDocument();
    expect(screen.getByText(/elimina tu cuenta/i)).toBeInTheDocument();
  });

  it("ofrece un canal de contacto real y accionable (F3 P1)", () => {
    render(<PrivacidadPage />);
    expect(
      screen.getByRole("link", { name: "raumorales22@gmail.com" }),
    ).toHaveAttribute("href", "mailto:raumorales22@gmail.com");
  });
});
