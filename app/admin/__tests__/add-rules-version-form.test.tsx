// @vitest-environment jsdom
/**
 * Tests de `app/admin/add-rules-version-form.tsx` (T-24, fase C): añadir
 * versión de reglas a una temporada existente (pre-relleno con la última
 * versión, validación local, errores del servidor).
 */
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import AddRulesVersionForm from "../add-rules-version-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const RULES_LABEL = "Nueva versión de reglas (JSON)";

const season: SeasonWithRules = {
  id: "s1",
  name: "Temporada 2026",
  year: 2026,
  startDate: null,
  endDate: null,
  status: "planned",
  rules: [
    {
      id: "r1",
      version: "provisional-v1",
      rules: {
        ...PROVISIONAL_SEASON_RULES,
        economy: { ...PROVISIONAL_SEASON_RULES.economy, B: 105 },
      },
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
};

function mockAddVersion(result: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  mockResult(trpc.seasons.addRulesVersion.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    ...result,
  });
  return mutate;
}

describe("AddRulesVersionForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("bloquea el envío sin temporada seleccionada", () => {
    const mutate = mockAddVersion();
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Añadir versión" })).toBeDisabled();

    // El guard del onSubmit también protege contra el envío forzado.
    const form = screen.getByRole("button", { name: "Añadir versión" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("pre-rellena el editor con la última versión de la temporada elegida", async () => {
    mockAddVersion();
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");

    const prefill = JSON.parse(
      (screen.getByLabelText(RULES_LABEL) as HTMLTextAreaElement).value,
    );
    expect(prefill.economy.B).toBe(105);
  });

  it("envía la nueva versión con las reglas del editor", async () => {
    const mutate = mockAddVersion();
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "Añadir versión" }));

    expect(mutate).toHaveBeenCalledWith({
      seasonId: "s1",
      rules: {
        ...PROVISIONAL_SEASON_RULES,
        economy: { ...PROVISIONAL_SEASON_RULES.economy, B: 105 },
      },
    });
  });

  it("bloquea el envío con un JSON malformado y muestra el error local", () => {
    const mutate = mockAddVersion();
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(RULES_LABEL), {
      target: { value: "{no es json" },
    });

    expect(screen.getByText("El texto no es un JSON válido.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir versión" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("bloquea el envío con reglas inválidas (schema) y muestra el motivo", () => {
    const mutate = mockAddVersion();
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);

    const bad = {
      ...PROVISIONAL_SEASON_RULES,
      economy: { ...PROVISIONAL_SEASON_RULES.economy, option: "X" },
    };
    fireEvent.change(screen.getByLabelText(RULES_LABEL), {
      target: { value: JSON.stringify(bad) },
    });

    expect(
      screen.getByText(/La opción económica debe ser A, B, C o E/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir versión" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("confirma la adición sin modificar las versiones anteriores", () => {
    mockAddVersion({ isSuccess: true });
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Nueva versión de reglas añadida (las versiones anteriores no se modifican).",
    );
  });

  it("muestra el error de validación Zod en el campo de reglas", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["rules"], message: "Las reglas no son válidas" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockAddVersion({ isError: true, error });
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);
    expect(screen.getByText("Las reglas no son válidas")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockAddVersion({ isError: true, error });
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    mockAddVersion({ isPending: true });
    render(<AddRulesVersionForm seasons={[season]} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Añadiendo…" })).toBeDisabled();
  });
});
