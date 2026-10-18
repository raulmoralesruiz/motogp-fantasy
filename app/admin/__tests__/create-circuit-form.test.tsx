// @vitest-environment jsdom
/**
 * Tests de `app/admin/create-circuit-form.tsx` (T-24, fase C): creación
 * de circuito (idempotente por (name, country)), errores Zod y estados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CreateCircuitForm from "../create-circuit-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const circuitView = {
  id: "c1",
  name: "Circuito de Jerez",
  country: "España",
  location: "Jerez de la Frontera",
};

describe("CreateCircuitForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("envía nombre, país y ubicación", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Circuito de Jerez");
    await user.type(screen.getByLabelText("País"), "España");
    await user.type(
      screen.getByLabelText("Ubicación (opcional)"),
      "Jerez de la Frontera",
    );
    await user.click(screen.getByRole("button", { name: "Crear circuito" }));

    expect(mutate).toHaveBeenCalledWith({
      name: "Circuito de Jerez",
      country: "España",
      location: "Jerez de la Frontera",
    });
  });

  it("envía location=null cuando la ubicación está vacía", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Circuito de Jerez");
    await user.type(screen.getByLabelText("País"), "España");
    await user.click(screen.getByRole("button", { name: "Crear circuito" }));

    expect(mutate).toHaveBeenCalledWith({
      name: "Circuito de Jerez",
      country: "España",
      location: null,
    });
  });

  it("confirma la creación", () => {
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...circuitView, created: true },
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Circuito creado.");
  });

  it("indica la reutilización cuando el circuito ya existía", () => {
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...circuitView, created: false },
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "El circuito ya existía: se reutiliza (no se duplica).",
    );
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["country"], message: "El país es obligatorio" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);
    expect(screen.getByText("El país es obligatorio")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    mockResult(trpc.seasons.circuits.create.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<CreateCircuitForm onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creando…" })).toBeDisabled();
  });
});
