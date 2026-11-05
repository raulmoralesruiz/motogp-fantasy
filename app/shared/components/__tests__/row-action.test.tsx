// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { RowAction } from "../row-action";
import { render, screen, userEvent } from "../../../../test/rtl";

describe("RowAction", () => {
  it("renderiza un <button> .row-action con type por defecto 'button' y propaga onClick", () => {
    const onClick = vi.fn();
    render(<RowAction onClick={onClick}>Ver detalle</RowAction>);
    const btn = screen.getByRole("button", { name: "Ver detalle" });
    expect(btn).toHaveClass("row-action");
    expect(btn).toHaveAttribute("type", "button");

    btn.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("admite type='submit'", () => {
    render(<RowAction type="submit">Guardar</RowAction>);
    expect(screen.getByRole("button", { name: "Guardar" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("con `disabled` nativo se queda deshabilitado y sin motivo", () => {
    render(<RowAction disabled>Oculto</RowAction>);
    const btn = screen.getByRole("button", { name: "Oculto" });
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-disabled");
    expect(
      document.querySelector(".button-disabled-reason"),
    ).toBeNull();
  });

  it("con `disabled` + `disabledReason` expone el motivo y no dispara onClick", async () => {
    const onClick = vi.fn();
    render(
      <RowAction disabled disabledReason="El GP ya está cerrado" onClick={onClick}>
        Cerrar
      </RowAction>,
    );
    const btn = screen.getByRole("button", { name: "Cerrar" });
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
    const reason = screen.getByText("El GP ya está cerrado");
    expect(reason).toHaveClass("button-disabled-reason");
    expect(btn).toHaveAttribute("aria-describedby", reason.id);

    const user = userEvent.setup();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("sin `disabled`, el `disabledReason` no se renderiza", () => {
    render(<RowAction disabledReason="no se muestra">Abierto</RowAction>);
    expect(screen.getByRole("button", { name: "Abierto" })).not.toBeDisabled();
    expect(
      screen.queryByText("no se muestra"),
    ).not.toBeInTheDocument();
  });
});
