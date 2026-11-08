// @vitest-environment jsdom
/**
 * Tests de `app/registro/register-form.tsx` (T-24, fase C): registro con
 * términos, redirección, errores Zod por campo y errores generales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, render, screen, userEvent } from "../../../test/rtl";

import RegisterForm from "../register-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

function registerOptions(): { onSuccess?: () => void } {
  return asMockFn(trpc.auth.register.useMutation).mock.calls[0]?.[0] ?? {};
}

describe("RegisterForm", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("envía los datos con los términos aceptados", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.register.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<RegisterForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Nombre de usuario"), "piloto1");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(
      screen.getByLabelText("Acepto los términos y la política de privacidad"),
    );
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(mutate).toHaveBeenCalledWith({
      email: "piloto@liga.com",
      username: "piloto1",
      password: "clave-secreta-1",
      termsAccepted: true,
    });
  });

  it("envía termsAccepted=false si no se marca la casilla", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.register.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<RegisterForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Nombre de usuario"), "piloto1");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ termsAccepted: false }),
    );
  });

  it("muestra el éxito y la salida al dashboard tras el registro (F3 P2)", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.register.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<RegisterForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Nombre de usuario"), "piloto1");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(
      screen.getByLabelText("Acepto los términos y la política de privacidad"),
    );
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await act(async () => {
      registerOptions().onSuccess?.();
    });
    // F3 P2: confirmación explícita + acción en bloque (no un salto silencioso).
    expect(screen.getByRole("status")).toHaveTextContent(/Cuenta creada/);
    // F3 R5 P1: el pico del onboarding empuja al objetivo #1 del producto
    // (activación: primer lineup tras el registro — PRODUCT.md), no a un
    // dashboard neutro.
    const cta = screen.getByRole("link", { name: "Monta tu primer lineup" });
    expect(cta).toHaveAttribute("href", "/lineups");
    expect(cta).toHaveClass("button");
    // El dashboard queda como salida secundaria.
    const dashboard = screen.getByRole("link", { name: "Ir a mi dashboard" });
    expect(dashboard).toHaveAttribute("href", "/");
    expect(dashboard).toHaveClass("button-secondary");
  });

  it("enlaza los términos y la privacidad a sus páginas (F3 P1)", () => {
    render(<RegisterForm />);
    expect(screen.getByRole("link", { name: "términos" })).toHaveAttribute(
      "href",
      "/terminos",
    );
    expect(
      screen.getByRole("link", { name: "política de privacidad" }),
    ).toHaveAttribute("href", "/privacidad");
  });

  it("muestra las reglas del nombre de usuario antes del primer error (F3 P3)", () => {
    render(<RegisterForm />);
    expect(
      screen.getByText("3–20 caracteres: letras, números y guiones bajos."),
    ).toBeInTheDocument();
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["username"], message: "El nombre de usuario no es válido" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.auth.register.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<RegisterForm />);
    expect(screen.getByText("El nombre de usuario no es válido")).toBeInTheDocument();
  });

  it("muestra el error de campo de los términos", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["termsAccepted"], message: "Debes aceptar los términos" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.auth.register.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<RegisterForm />);
    // F3 P3: el rechazo de los términos se anuncia a lectores de pantalla.
    expect(screen.getByRole("alert")).toHaveTextContent("Debes aceptar los términos");
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("El email ya está registrado", {
      code: "CONFLICT",
      message: "El email ya está registrado",
    });
    mockResult(trpc.auth.register.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<RegisterForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("El email ya está registrado");
  });

  it("desactiva el botón mientras carga", () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.register.useMutation, {
      mutate,
      isPending: true,
      isError: false,
    });
    render(<RegisterForm />);
    expect(screen.getByRole("button", { name: "Creando cuenta…" })).toBeDisabled();
  });
});
