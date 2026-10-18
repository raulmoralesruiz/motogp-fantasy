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
});
