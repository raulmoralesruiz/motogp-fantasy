// @vitest-environment jsdom
/**
 * Tests de `app/admin/create-team-form.tsx` (US-06): creación de equipo
 * (nombre + constructor existente; un equipo pertenece a exactamente un
 * constructor — CA US-06), idempotencia, errores Zod y estados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CreateTeamForm from "../create-team-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const constructors = [
  { id: "c1", name: "Ducati" },
  { id: "c2", name: "KTM" },
];

const teamView = {
  id: "t1",
  name: "Ducati Lenovo Team",
  constructorId: "c1",
  constructorName: "Ducati",
};

describe("CreateTeamForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("envía nombre y constructorId al elegir un constructor", async () => {
    const mutate = vi.fn();
    mockResult(trpc.market.teams.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Ducati Lenovo Team");
    await user.selectOptions(screen.getByLabelText("Constructor"), "c2");
    await user.click(screen.getByRole("button", { name: "Crear equipo" }));

    expect(mutate).toHaveBeenCalledWith({
      name: "Ducati Lenovo Team",
      constructorId: "c2",
    });
  });

  it("desactiva el botón sin constructor elegido", () => {
    mockResult(trpc.market.teams.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Crear equipo" })).toBeDisabled();
  });

  it("no llama a mutate sin constructor elegido", async () => {
    const mutate = vi.fn();
    mockResult(trpc.market.teams.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    // El botón está deshabilitado: el envío no puede ocurrir.
    expect(screen.getByRole("button", { name: "Crear equipo" })).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("confirma la creación", () => {
    mockResult(trpc.market.teams.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...teamView, created: true },
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Equipo creado.");
  });

  it("indica la reutilización cuando el equipo ya existía", () => {
    mockResult(trpc.market.teams.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...teamView, created: false },
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "El equipo ya existía: se reutiliza (no se duplica).",
    );
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [
          { path: ["name"], message: "El nombre del equipo es obligatorio" },
          { path: ["constructorId"], message: "El identificador de constructor no es válido" },
        ],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.market.teams.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    expect(screen.getByText("El nombre del equipo es obligatorio")).toBeInTheDocument();
    expect(
      screen.getByText("El identificador de constructor no es válido"),
    ).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("El constructor no existe.", {
      code: "NOT_FOUND",
      message: "El constructor no existe.",
    });
    mockResult(trpc.market.teams.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("El constructor no existe.");
  });

  it("desactiva el botón mientras carga", () => {
    mockResult(trpc.market.teams.create.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<CreateTeamForm constructors={constructors} onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creando…" })).toBeDisabled();
  });
});
