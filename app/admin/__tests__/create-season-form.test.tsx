// @vitest-environment jsdom
/**
 * Tests de `app/admin/create-season-form.tsx` (T-24, fase C): creación de
 * temporada con reglas pre-rellenadas (PROVISIONAL_SEASON_RULES), validación
 * local del JSON en vivo, envío con/sin fechas y errores.
 */
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CreateSeasonForm from "../create-season-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const RULES_LABEL = "Reglas (JSON versionado)";

function mockCreate(result: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  mockResult(trpc.seasons.create.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    ...result,
  });
  return mutate;
}

describe("CreateSeasonForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("pre-rellena el editor de reglas con PROVISIONAL_SEASON_RULES", () => {
    mockCreate();
    render(<CreateSeasonForm onCreated={vi.fn()} />);
    expect(screen.getByLabelText(RULES_LABEL)).toHaveValue(
      JSON.stringify(PROVISIONAL_SEASON_RULES, null, 2),
    );
  });

  it("envía la temporada con fechas y las reglas pre-rellenadas", async () => {
    const mutate = mockCreate();
    render(<CreateSeasonForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Temporada 2026");
    await user.type(screen.getByLabelText("Año"), "2026");
    fireEvent.change(screen.getByLabelText("Fecha de inicio (opcional)"), {
      target: { value: "2026-03-27" },
    });
    fireEvent.change(screen.getByLabelText("Fecha de fin (opcional)"), {
      target: { value: "2026-11-08" },
    });
    await user.click(screen.getByRole("button", { name: "Crear temporada" }));

    expect(mutate).toHaveBeenCalledWith({
      name: "Temporada 2026",
      year: 2026,
      startDate: new Date("2026-03-27"),
      endDate: new Date("2026-11-08"),
      rules: PROVISIONAL_SEASON_RULES,
    });
  });

  it("omite las fechas vacías (undefined)", async () => {
    const mutate = mockCreate();
    render(<CreateSeasonForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Temporada 2026");
    await user.type(screen.getByLabelText("Año"), "2026");
    await user.click(screen.getByRole("button", { name: "Crear temporada" }));

    expect(mutate).toHaveBeenCalledWith({
      name: "Temporada 2026",
      year: 2026,
      startDate: undefined,
      endDate: undefined,
      rules: PROVISIONAL_SEASON_RULES,
    });
  });

  it("bloquea el envío con un JSON malformado y muestra el error local", async () => {
    const mutate = mockCreate();
    render(<CreateSeasonForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Temporada 2026");
    await user.type(screen.getByLabelText("Año"), "2026");
    fireEvent.change(screen.getByLabelText(RULES_LABEL), {
      target: { value: "{no es json" },
    });

    expect(screen.getByText("El texto no es un JSON válido.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear temporada" })).toBeDisabled();

    // El guard del onSubmit también protege contra el envío forzado.
    const form = screen.getByRole("button", { name: "Crear temporada" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("bloquea el envío con reglas inválidas (schema) y muestra el motivo", () => {
    const mutate = mockCreate();
    render(<CreateSeasonForm onCreated={vi.fn()} />);

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
    expect(screen.getByRole("button", { name: "Crear temporada" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("confirma la creación con la primera versión de reglas", () => {
    mockCreate({ isSuccess: true });
    render(<CreateSeasonForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Temporada creada con su primera versión de reglas.",
    );
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["year"], message: "El año debe ser un número" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockCreate({ isError: true, error });
    render(<CreateSeasonForm onCreated={vi.fn()} />);
    expect(screen.getByText("El año debe ser un número")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockCreate({ isError: true, error });
    render(<CreateSeasonForm onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    mockCreate({ isPending: true });
    render(<CreateSeasonForm onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creando…" })).toBeDisabled();
  });
});
