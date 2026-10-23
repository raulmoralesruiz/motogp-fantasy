// @vitest-environment jsdom
/**
 * Tests de `app/admin/gp-actions.tsx` (T-24, fase C): acciones de un GP
 * (cambio de estado con transiciones válidas, lockout, añadir eventos que
 * faltan, errores del servidor).
 */
import { act, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GpView } from "../../modules/seasons";
import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import GpActions from "../gp-actions";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

function gpFixture(overrides: Partial<GpView> = {}): GpView {
  return {
    id: "gp1",
    seasonId: "s1",
    round: 1,
    name: "GP de España",
    circuit: {
      id: "c1",
      name: "Circuito de Jerez",
      country: "España",
      location: "Jerez de la Frontera",
    },
    date: new Date("2026-04-19T14:00:00Z"),
    status: "scheduled",
    lockoutAt: null,
    sourceRef: null,
    events: [
      { id: "e1", type: "q2", orderNum: 1, startTime: null, status: "scheduled" },
      { id: "e2", type: "race", orderNum: 2, startTime: null, status: "scheduled" },
    ],
    ...overrides,
  };
}

type MutationOptions = { onSuccess?: () => void };

describe("GpActions", () => {
  beforeEach(() => resetTrpcMocks());

  it("renderiza la información del GP, sus eventos y su estado", () => {
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    expect(screen.getByText("R1 · GP de España")).toBeInTheDocument();
    expect(screen.getByText(/Jerez de la Frontera/)).toBeInTheDocument();
    expect(screen.getByText(/estado: programado/)).toBeInTheDocument();
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByText("Carrera")).toBeInTheDocument();
  });

  it("solo ofrece las transiciones válidas desde el estado actual", () => {
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    expect(screen.getByRole("option", { name: "bloqueado" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "cancelado" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "finalizado" })).not.toBeInTheDocument();
  });

  it("cambia el estado y avisa al padre en el éxito", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.gps.updateStatus.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    const onChanged = vi.fn();
    render(<GpActions gp={gpFixture()} onChanged={onChanged} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Cambiar estado"), "locked");
    await user.click(screen.getByRole("button", { name: "Cambiar" }));
    expect(mutate).toHaveBeenCalledWith({ gpId: "gp1", status: "locked" });

    const options = asMockFn(trpc.seasons.gps.updateStatus.useMutation).mock
      .calls[0]?.[0] as MutationOptions | undefined;
    await act(async () => {
      options?.onSuccess?.();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Cambiar estado")).toHaveValue("");
  });

  it("no permite cambios desde un estado terminal", () => {
    render(<GpActions gp={gpFixture({ status: "finished" })} onChanged={vi.fn()} />);

    expect(screen.getByText("Estado terminal (no admite cambios).")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cambiar" })).not.toBeInTheDocument();
  });

  it("fija el lockout y avisa al padre en el éxito", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.gps.updateLockout.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    const onChanged = vi.fn();
    render(<GpActions gp={gpFixture()} onChanged={onChanged} />);

    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("Lockout"), {
      target: { value: "2026-04-19T12:00" },
    });
    await user.click(screen.getByRole("button", { name: "Fijar" }));
    expect(mutate).toHaveBeenCalledWith({
      gpId: "gp1",
      lockoutAt: new Date("2026-04-19T12:00"),
    });

    const options = asMockFn(trpc.seasons.gps.updateLockout.useMutation).mock
      .calls[0]?.[0] as MutationOptions | undefined;
    await act(async () => {
      options?.onSuccess?.();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Lockout")).toHaveValue("");
  });

  it("borra el lockout cuando ya está fijado", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.gps.updateLockout.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(
      <GpActions
        gp={gpFixture({ lockoutAt: new Date("2026-04-19T12:00:00Z") })}
        onChanged={vi.fn()}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Borrar" }));
    expect(mutate).toHaveBeenCalledWith({ gpId: "gp1", lockoutAt: null });
  });

  it("añade un evento que falta con su hora", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.gps.addEvent.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Añadir evento que falta"), "q1");
    fireEvent.change(screen.getByLabelText("Hora de inicio del evento"), {
      target: { value: "2026-04-18T10:00" },
    });
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    expect(mutate).toHaveBeenCalledWith({
      gpId: "gp1",
      type: "q1",
      startTime: new Date("2026-04-18T10:00"),
    });
  });

  it("no ofrece el formulario de eventos si ya existen todos", () => {
    render(
      <GpActions
        gp={gpFixture({
          events: [
            { id: "e0", type: "q1", orderNum: 0, startTime: null, status: "scheduled" },
            { id: "e1", type: "q2", orderNum: 1, startTime: null, status: "scheduled" },
            {
              id: "e2",
              type: "sprint",
              orderNum: 2,
              startTime: null,
              status: "scheduled",
            },
            { id: "e3", type: "race", orderNum: 3, startTime: null, status: "scheduled" },
          ],
        })}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.queryByText("Añadir evento que falta")).not.toBeInTheDocument();
  });

  it("muestra el error general de estado", () => {
    const error = clientError("Transición no permitida", {
      code: "BAD_REQUEST",
      message: "Transición no permitida",
    });
    mockResult(trpc.seasons.gps.updateStatus.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Transición no permitida");
  });

  it("no muestra alerta general para un error de validación Zod", () => {
    const error = clientError("Invalid input", {
      zod: { issues: [{ path: ["status"], message: "Estado inválido" }] },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.seasons.gps.updateStatus.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("muestra el lockout fijado", () => {
    render(
      <GpActions
        gp={gpFixture({ lockoutAt: new Date("2026-04-19T12:00:00Z") })}
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByText(/lockout:/)).toBeInTheDocument();
  });

  it("desactiva el botón mientras cambia el estado", async () => {
    mockResult(trpc.seasons.gps.updateStatus.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Cambiar estado"), "locked");
    expect(screen.getByRole("button", { name: "Cambiando…" })).toBeDisabled();
  });

  it("al añadir un evento: avisa al padre y limpia el formulario", async () => {
    const mutate = vi.fn();
    mockResult(trpc.seasons.gps.addEvent.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    const onChanged = vi.fn();
    render(<GpActions gp={gpFixture()} onChanged={onChanged} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Añadir evento que falta"), "q1");
    await user.click(screen.getByRole("button", { name: "Añadir" }));
    expect(mutate).toHaveBeenCalledWith({
      gpId: "gp1",
      type: "q1",
      startTime: null,
    });

    const options = asMockFn(trpc.seasons.gps.addEvent.useMutation).mock.calls[0]?.[0] as
      MutationOptions | undefined;
    await act(async () => {
      options?.onSuccess?.();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Añadir evento que falta")).toHaveValue("");
  });

  it("muestra el error general del lockout", () => {
    const error = clientError("No se pudo fijar el lockout", {
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo fijar el lockout",
    });
    mockResult(trpc.seasons.gps.updateLockout.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo fijar el lockout");
  });

  it("muestra el error general al añadir un evento", () => {
    const error = clientError("No se pudo añadir el evento", {
      code: "INTERNAL_SERVER_ERROR",
      message: "No se pudo añadir el evento",
    });
    mockResult(trpc.seasons.gps.addEvent.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<GpActions gp={gpFixture()} onChanged={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo añadir el evento");
  });
});
