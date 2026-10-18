// @vitest-environment jsdom
/**
 * Tests de `app/recuperar-contrasena/reset-request-form.tsx` (T-24, fase C):
 * solicitud de enlace de recuperación y confirmación (sin revelar si el
 * email existe — AGENTS.md §8).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, render, screen, userEvent } from "../../../test/rtl";

import ResetRequestForm from "../reset-request-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

function requestResetOptions(): { onSuccess?: () => void } {
  return asMockFn(trpc.auth.requestReset.useMutation).mock.calls[0]?.[0] ?? {};
}

describe("ResetRequestForm", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("envía el email al servidor", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.requestReset.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<ResetRequestForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.click(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    );

    expect(mutate).toHaveBeenCalledWith({ email: "piloto@liga.com" });
  });

  it("muestra la confirmación tras el envío (sin revelar si el email existe)", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.requestReset.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<ResetRequestForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.click(
      screen.getByRole("button", { name: "Enviar enlace de recuperación" }),
    );

    await act(async () => {
      requestResetOptions().onSuccess?.();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Si el email está registrado/);
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["email"], message: "El email no es válido" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.auth.requestReset.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<ResetRequestForm />);
    expect(screen.getByText("El email no es válido")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockResult(trpc.auth.requestReset.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<ResetRequestForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });

  it("desactiva el botón mientras carga", () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.requestReset.useMutation, {
      mutate,
      isPending: true,
      isError: false,
    });
    render(<ResetRequestForm />);
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  });
});
