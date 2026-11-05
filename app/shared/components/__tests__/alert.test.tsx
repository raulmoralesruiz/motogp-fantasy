// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { Alert } from "../alert";
import { render, screen } from "../../../../test/rtl";

describe("Alert", () => {
  it("variant='error' → <p class=alert-error role=alert> (caja tintada global)", () => {
    render(<Alert variant="error">Algo salió mal</Alert>);
    const el = screen.getByRole("alert");
    expect(el).toHaveClass("alert-error");
    expect(el).toHaveTextContent("Algo salió mal");
  });

  it("variant='success' → <p class=alert-ok role=status> (caja tintada global)", () => {
    render(<Alert variant="success">Listo</Alert>);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("alert-ok");
    expect(el).toHaveTextContent("Listo");
  });

  it("variant='warning' → <p class=alert-warning role=alert>", () => {
    render(<Alert variant="warning">Lockout en 10 minutos</Alert>);
    const el = screen.getByRole("alert");
    expect(el).toHaveClass("alert-warning");
    expect(el).toHaveTextContent("Lockout en 10 minutos");
  });

  it("variant='info' → <p class=alert-info role=status>", () => {
    render(<Alert variant="info">Resultados actualizados</Alert>);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("alert-info");
    expect(el).toHaveTextContent("Resultados actualizados");
  });
});
