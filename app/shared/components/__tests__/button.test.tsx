// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { Button } from "../button";
import { render, screen } from "../../../../test/rtl";

describe("Button", () => {
  it("renderiza un <button> con la clase .button y type por defecto 'button'", () => {
    render(<Button>Hola</Button>);
    const btn = screen.getByRole("button", { name: "Hola" });
    expect(btn).toHaveClass("button");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("admite type='submit' y propaga el evento onClick", () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" onClick={onClick}>
        Enviar
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Enviar" });
    expect(btn).toHaveAttribute("type", "submit");
    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respeta el atributo disabled", () => {
    render(<Button disabled>Bloqueado</Button>);
    expect(screen.getByRole("button", { name: "Bloqueado" })).toBeDisabled();
  });

  it("escribe el motivo de bloqueo junto al botón deshabilitado y lo asocia con aria-describedby", () => {
    render(
      <Button disabled disabledReason="Elige un activo.">
        Fijar
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Fijar" });
    const reason = screen.getByText("Elige un activo.");
    // Con motivo escrito el bloqueo es `aria-disabled`: el botón sigue en el
    // orden de foco y el motivo se anuncia al navegar con teclado/lector.
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-describedby", reason.id);
  });

  it("no muestra el motivo si el botón está habilitado", () => {
    render(<Button disabledReason="Elige un activo.">Fijar</Button>);
    expect(screen.queryByText("Elige un activo.")).not.toBeInTheDocument();
  });
});
