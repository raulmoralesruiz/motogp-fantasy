// @vitest-environment jsdom
/**
 * Tests de `app/admin/create-rider-form.tsx` (US-06): creación de piloto
 * (idempotente por nombre), dorsal opcional, errores Zod y estados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CreateRiderForm from "../create-rider-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const riderView = {
  id: "r1",
  name: "Francesco Bagnaia",
  number: 27,
  isActive: true,
};

describe("CreateRiderForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("envía nombre y dorsal", async () => {
    const mutate = vi.fn();
    mockResult(trpc.market.riders.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Francesco Bagnaia");
    await user.type(screen.getByLabelText("Dorsal (opcional)"), "27");
    await user.click(screen.getByRole("button", { name: "Crear piloto" }));

    expect(mutate).toHaveBeenCalledWith({ name: "Francesco Bagnaia", number: 27 });
  });

  it("envía number=null cuando el dorsal está vacío", async () => {
    const mutate = vi.fn();
    mockResult(trpc.market.riders.create.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Sin dorsal");
    await user.click(screen.getByRole("button", { name: "Crear piloto" }));

    expect(mutate).toHaveBeenCalledWith({ name: "Sin dorsal", number: null });
  });

  it("confirma la creación", () => {
    mockResult(trpc.market.riders.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...riderView, created: true },
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Piloto creado.");
  });

  it("indica la reutilización cuando el piloto ya existía", () => {
    mockResult(trpc.market.riders.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: { ...riderView, created: false },
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "El piloto ya existía: se reutiliza (no se duplica).",
    );
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["name"], message: "El nombre del piloto es obligatorio" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.market.riders.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);
    expect(screen.getByText("El nombre del piloto es obligatorio")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockResult(trpc.market.riders.create.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    mockResult(trpc.market.riders.create.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<CreateRiderForm onCreated={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Creando…" })).toBeDisabled();
  });
});
