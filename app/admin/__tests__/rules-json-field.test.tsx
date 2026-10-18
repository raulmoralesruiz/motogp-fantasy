// @vitest-environment jsdom
/**
 * Tests de `app/admin/rules-json-field.tsx` (T-24, fase C): editor de
 * reglas en JSON (etiqueta + textarea + error).
 */
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "../../../test/rtl";

import { RulesJsonField } from "../rules-json-field";

describe("RulesJsonField", () => {
  it("muestra la etiqueta y el valor del textarea con el id dado", () => {
    render(
      <RulesJsonField id="rules" label="Reglas" value='{"a": 1}' onChange={vi.fn()} />,
    );
    const textarea = screen.getByLabelText("Reglas");
    expect(textarea).toHaveValue('{"a": 1}');
    expect(textarea).toHaveAttribute("id", "rules");
  });

  it("notifica cada cambio al padre", () => {
    const onChange = vi.fn();
    render(
      <RulesJsonField id="rules" label="Reglas" value='{"a": 1}' onChange={onChange} />,
    );
    // `fireEvent.change`: userEvent.type interpreta "{" como tecla especial.
    fireEvent.change(screen.getByLabelText("Reglas"), {
      target: { value: '{"a": 2}' },
    });
    expect(onChange).toHaveBeenCalledWith('{"a": 2}');
  });

  it("muestra el error bajo el campo cuando se proporciona", () => {
    render(
      <RulesJsonField
        id="rules"
        label="Reglas"
        value="{}"
        onChange={vi.fn()}
        error="El texto no es un JSON válido."
      />,
    );
    expect(screen.getByText("El texto no es un JSON válido.")).toBeInTheDocument();
  });

  it("no muestra el error cuando es null", () => {
    render(
      <RulesJsonField
        id="rules"
        label="Reglas"
        value="{}"
        onChange={vi.fn()}
        error={null}
      />,
    );
    expect(screen.queryByText("El texto no es un JSON válido.")).not.toBeInTheDocument();
  });
});
