// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { Alert } from "../alert";
import { render, screen } from "../../../../test/rtl";

describe("Alert", () => {
  it("variant='error' → <p class=form-error role=alert>", () => {
    render(<Alert variant="error">Algo salió mal</Alert>);
    const el = screen.getByRole("alert");
    expect(el).toHaveClass("form-error");
    expect(el).toHaveTextContent("Algo salió mal");
  });

  it("variant='success' → <p class=ok role=status>", () => {
    render(<Alert variant="success">Listo</Alert>);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("ok");
    expect(el).toHaveTextContent("Listo");
  });
});
