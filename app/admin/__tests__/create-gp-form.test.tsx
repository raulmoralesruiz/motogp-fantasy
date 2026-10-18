// @vitest-environment jsdom
/**
 * Tests de `app/admin/create-gp-form.tsx` (T-24, fase C): creación manual
 * de GP (Q2 + carrera obligatorias, eventos opcionales, lockout, errores).
 */
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CircuitView } from "../../modules/seasons";
import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CreateGpForm from "../create-gp-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const circuits: CircuitView[] = [
  {
    id: "c1",
    name: "Circuito de Jerez",
    country: "España",
    location: "Jerez de la Frontera",
  },
];

function mockCreate(result: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  mockResult(trpc.seasons.gps.create.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    ...result,
  });
  return mutate;
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Ronda"), "1");
  await user.type(screen.getByLabelText("Nombre"), "GP de España");
  await user.selectOptions(screen.getByLabelText("Circuito"), "c1");
  fireEvent.change(screen.getByLabelText("Fecha (día de carrera)"), {
    target: { value: "2026-04-19" },
  });
}

describe("CreateGpForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("premarca Q2 y carrera (obligatorias) y deja Q1 y sprint sin marcar", () => {
    mockCreate();
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Q2 *" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Carrera *" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Q1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sprint" })).not.toBeChecked();
  });

  it("envía el GP con los eventos marcados y sus horas", async () => {
    const mutate = mockCreate();
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await fillRequired(user);
    fireEvent.change(screen.getByLabelText("Lockout (opcional, editable después)"), {
      target: { value: "2026-04-19T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Hora de inicio de Carrera"), {
      target: { value: "2026-04-19T14:00" },
    });
    await user.click(screen.getByRole("button", { name: "Crear GP" }));

    expect(mutate).toHaveBeenCalledWith({
      seasonId: "s1",
      round: 1,
      name: "GP de España",
      circuitId: "c1",
      date: new Date("2026-04-19"),
      lockoutAt: new Date("2026-04-19T12:00"),
      events: [
        { type: "q2", startTime: null },
        { type: "race", startTime: new Date("2026-04-19T14:00") },
      ],
    });
  });

  it("incluye los eventos opcionales cuando se marcan", async () => {
    const mutate = mockCreate();
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await fillRequired(user);
    await user.click(screen.getByRole("checkbox", { name: "Q1" }));
    fireEvent.change(screen.getByLabelText("Hora de inicio de Q1"), {
      target: { value: "2026-04-18T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Crear GP" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [
          { type: "q1", startTime: new Date("2026-04-18T10:00") },
          { type: "q2", startTime: null },
          { type: "race", startTime: null },
        ],
      }),
    );
  });

  it("no envía sin fecha ni sin circuito", () => {
    const mutate = mockCreate();
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    const form = screen.getByRole("button", { name: "Crear GP" }).closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("desactiva el botón cuando Q2 o carrera no están marcadas", async () => {
    mockCreate();
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Q2 *" }));
    expect(screen.getByRole("button", { name: "Crear GP" })).toBeDisabled();
  });

  it("confirma la creación con sus eventos", () => {
    mockCreate({ isSuccess: true });
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("GP creado con sus eventos.");
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["name"], message: "El nombre es obligatorio" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockCreate({ isError: true, error });
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByText("El nombre es obligatorio")).toBeInTheDocument();
  });

  it("muestra el error de campo del circuito", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["circuitId"], message: "El circuito no es válido" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockCreate({ isError: true, error });
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByText("El circuito no es válido")).toBeInTheDocument();
  });

  it("muestra el error de eventos bajo el bloque de eventos", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["events"], message: "Q2 y carrera son obligatorias" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockCreate({ isError: true, error });
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByText("Q2 y carrera son obligatorias")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockCreate({ isError: true, error });
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    mockCreate({ isPending: true });
    render(<CreateGpForm seasonId="s1" circuits={circuits} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creando…" })).toBeDisabled();
  });
});
