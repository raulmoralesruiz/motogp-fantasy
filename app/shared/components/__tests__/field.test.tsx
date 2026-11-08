// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { Field } from "../field";
import { render, screen } from "../../../../test/rtl";

describe("Field", () => {
  it("renderiza etiqueta + input con id único por instancia", () => {
    render(<Field label="Email" name="email" type="email" placeholder="tu@email.com" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("name", "email");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("placeholder", "tu@email.com");
    expect(input.id).not.toBe("");
  });

  it("dos campos con el mismo name no comparten id (las etiquetas no se cruzan)", () => {
    render(
      <>
        <Field label="Nombre" name="name" />
        <Field label="Nombre" name="name" />
      </>,
    );
    const [first, second] = screen.getAllByLabelText("Nombre");
    expect(first?.id).not.toBe(second?.id);
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

  it("asocia el error al input (aria-invalid + aria-describedby) y lo anuncia (role=alert)", () => {
    render(<Field label="Email" name="email" error="Obligatorio" />);
    const input = screen.getByLabelText("Email");
    const error = screen.getByText("Obligatorio");
    // F3 P2: el error es visible para lectores de pantalla y enlazado al campo.
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
    expect(error).toHaveAttribute("role", "alert");
  });

  it("no muestra error ni atributos de error si no hay", () => {
    render(<Field label="Email" name="email" />);
    expect(document.querySelector(".field-error")).toBeNull();
    const input = screen.getByLabelText("Email");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});
