// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";

import { ConfirmDialog } from "../confirm-dialog";
import { render, screen } from "../../../../test/rtl";

function renderDialog(overrides: Partial<ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfirmDialog
      title="Marcar el GP como definitivo"
      impact="Se puntuarán los lineups (rv-1)."
      confirmLabel="Sí, marcar definitivo"
      onConfirm={onConfirm}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onConfirm, onClose };
}

describe("ConfirmDialog", () => {
  it("renderiza título, impacto y los dos controles con la acción nombrada", () => {
    renderDialog();
    expect(
      screen.getByRole("dialog", { name: "Marcar el GP como definitivo" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Se puntuarán los lineups (rv-1).")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sí, marcar definitivo" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No, volver" })).toBeInTheDocument();
  });

  it("confirma con «Sí, …» y cierra con «No, volver» sin confirmar", async () => {
    const { onConfirm, onClose } = renderDialog();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "No, volver" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sí, marcar definitivo" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("muestra el impacto irreversible como aviso", () => {
    renderDialog({ irreversible: true, impact: "Acción irreversible." });
    expect(screen.getByRole("alert")).toHaveTextContent("Acción irreversible.");
  });

  it("abre con el foco en la opción segura y lo retiene con Tab", async () => {
    renderDialog();
    const user = userEvent.setup();
    const safe = screen.getByRole("button", { name: "No, volver" });
    const confirm = screen.getByRole("button", { name: "Sí, marcar definitivo" });
    expect(safe).toHaveFocus();

    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(safe).toHaveFocus();
  });

  it("cierra con Escape", async () => {
    const { onClose } = renderDialog();
    const user = userEvent.setup();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cierra al pulsar fuera del diálogo, pero no dentro", async () => {
    const { onClose } = renderDialog();
    const user = userEvent.setup();
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement!;

    await user.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
