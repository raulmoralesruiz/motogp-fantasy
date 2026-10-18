// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { Field } from "../field";
import { render, screen } from "../../../../test/rtl";

describe("Field", () => {
  it("renderiza etiqueta + input; el id se deriva de name", () => {
    render(<Field label="Email" name="email" type="email" placeholder="tu@email.com" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("placeholder", "tu@email.com");
  });

  it("usa el id explícito si se pasa", () => {
    render(<Field label="X" name="x" id="custom-id" />);
    expect(screen.getByLabelText("X")).toHaveAttribute("id", "custom-id");
  });

  it("muestra el mensaje de error si hay", () => {
    render(<Field label="Email" name="email" error="Obligatorio" />);
    expect(screen.getByText("Obligatorio")).toBeInTheDocument();
    expect(document.querySelector(".field-error")).not.toBeNull();
  });

  it("no muestra error si no hay", () => {
    render(<Field label="Email" name="email" />);
    expect(document.querySelector(".field-error")).toBeNull();
  });
});
