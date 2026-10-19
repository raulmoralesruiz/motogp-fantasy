// @vitest-environment jsdom
/**
 * Tests de `app/admin/create-constructor-form.tsx` (US-06): creación de
 * constructor (idempotente por nombre), errores Zod y estados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CreateConstructorForm from "../create-constructor-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const constructorView = { id: "c1", name: "Ducati" };

describe("CreateConstructorForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("envía el nombre", async () => {
    const mutate = vi.fn();
    mockResult(trpc.market.constructors.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateConstructorForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Ducati");
    await user.click(screen.getByRole("button", { name: "Crear constructor" }));

    expect(mutate).toHaveBeenCalledWith({ name: "Ducati" });
  });

  it("confirma la creación", () => {
    mockResult(trpc.market.constructors.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...constructorView, created: true },
    });
    render(<CreateConstructorForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Constructor creado.");
  });

  it("indica la reutilización cuando el constructor ya existía", () => {
    mockResult(trpc.market.constructors.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...constructorView, created: false },
    });
    render(<CreateConstructorForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "El constructor ya existía: se reutiliza (no se duplica).",
    );
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["name"], message: "El nombre del constructor es obligatorio" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.market.constructors.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateConstructorForm onCreated={vi.fn()} />);
    expect(screen.getByText("El nombre del constructor es obligatorio")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockResult(trpc.market.constructors.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateConstructorForm onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    mockResult(trpc.market.constructors.create.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<CreateConstructorForm onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creando…" })).toBeDisabled();
  });
});
