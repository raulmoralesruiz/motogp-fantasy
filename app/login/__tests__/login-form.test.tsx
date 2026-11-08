// @vitest-environment jsdom
/**
 * Tests de `app/login/login-form.tsx` (T-24, fase C): envío de credenciales,
 * redirección (incl. `?next=` relativo, F4 P3), errores de validación Zod
 * por campo y errores generales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";
import { act, render, screen, userEvent } from "../../../test/rtl";

import LoginForm from "../login-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

import { trpc } from "@/trpc/client";

type LoginData = { totpRequired?: boolean; totpToken?: string | null };
function loginOptions(): { onSuccess?: (data?: LoginData) => void } {
  return asMockFn(trpc.auth.login.useMutation).mock.calls[0]?.[0] ?? {};
}

describe("LoginForm", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("envía email y contraseña al servidor", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(mutate).toHaveBeenCalledWith({
      email: "piloto@liga.com",
      password: "clave-secreta-1",
    });
  });

  it("redirige al inicio tras el login correcto", async () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("redirige a `next` si es una ruta relativa válida (conserva la puerta de entrada)", async () => {
    navigation.searchParams = new URLSearchParams("next=/unirse");
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/unirse");
  });

  it("descarta `next` no relativo (open-redirect) y redirige a la home", async () => {
    navigation.searchParams = new URLSearchParams("next=//evil.com");
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("muestra el error de validación Zod por campo", () => {
    const error = clientError("Invalid input", {
      zod: {
        issues: [{ path: ["email"], message: "El email no es válido" }],
      },
      code: "BAD_REQUEST",
      message: "Invalid input",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<LoginForm />);
    expect(screen.getByText("El email no es válido")).toBeInTheDocument();
  });

  it("muestra el error general cuando no hay issues de campo", () => {
    const error = clientError("Credenciales inválidas", {
      code: "UNAUTHORIZED",
      message: "Credenciales inválidas",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<LoginForm />);
    expect(screen.getByRole("alert")).toHaveTextContent("Credenciales inválidas");
  });

  it("desactiva el botón mientras carga", () => {
    const mutate = vi.fn();
    mockResult(trpc.auth.login.useMutation, {
      mutate,
      isPending: true,
      isError: false,
    });
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Iniciando sesión…" })).toBeDisabled();
  });

  it("paso 1: «¿Olvidaste tu contraseña?» junto al campo de contraseña (F3 P3)", () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);
    const link = screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" });
    expect(link).toHaveAttribute("href", "/recuperar-contrasena");
    // Junto al campo de contraseña: el campo y el enlace son hermanos
    // directos en el formulario (antes el enlace vivía al pie de la página).
    const password = screen.getByLabelText("Contraseña");
    expect(link.closest("form")).toBe(password.closest("form"));
    // F3 P2: target táctil de 44 px (Regla de los 44) — acción secundaria
    // neutra, no un enlace fino de ~24 px.
    expect(link).toHaveClass("button-secondary");
  });
});

describe("LoginForm · segundo factor (D-07, ADR-0039)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    resetNavigationMocks();
  });

  it("si el login devuelve un reto: pide el código y NO redirige", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const verify = vi.fn();
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: verify,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });

    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();
  });

  it("envía el código en verifyTotp y redirige al éxito", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const verify = vi.fn();
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: verify,
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Código de verificación"), "123456");
    await user.click(screen.getByRole("button", { name: "Verificar" }));

    expect(verify).toHaveBeenCalledWith({ token: "reto-123", code: "123456" });
    // El onSuccess es el del COMPONENTE (capturado por el mock).
    const verifyOptions: { onSuccess?: () => void } =
      asMockFn(trpc.auth.verifyTotp.useMutation).mock.calls[0]?.[0] ?? {};
    await act(async () => {
      verifyOptions.onSuccess?.();
    });
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("muestra el error del segundo factor (código inválido/caducado)", async () => {
    const error = clientError("El código no es válido o ha caducado.", {
      code: "UNAUTHORIZED",
      message: "El código no es válido o ha caducado.",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    render(<LoginForm />);

    // Pasar al paso 2 (reto) antes de comprobar el error del paso 2.
    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    expect(
      screen.getByRole("alert").textContent,
    ).toContain("El código no es válido o ha caducado.");
  });

  it("paso 2: «Volver a iniciar sesión» regresa al paso 1 y limpia el error del reto (F3 P1)", async () => {
    const reset = vi.fn();
    const error = clientError("El reto ha caducado. Vuelve a iniciar sesión.", {
      code: "UNAUTHORIZED",
      message: "El reto ha caducado. Vuelve a iniciar sesión.",
    });
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
      reset,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("El reto ha caducado");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Volver a iniciar sesión" }));

    // El error de la verificación fallida se limpia (TanStack lo conserva hasta reset()).
    expect(reset).toHaveBeenCalled();
    // Y el paso 1 vuelve a estar disponible (el reto ya no).
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código de verificación")).not.toBeInTheDocument();
  });

  it("paso 2: indica de qué cuenta es el código, con email enmascarado (F3 P3)", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "piloto@liga.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    // Solo la primera letra de la parte local (PII minimizada, GDPR).
    expect(screen.getByText("p***@liga.com")).toBeInTheDocument();
  });

  it("paso 2: el campo de código recibe el foco al cambiar de paso (F3 P2)", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    // `autoFocus` es conductual en React (foca al montar, no renderiza el
    // atributo): el campo de código tiene el foco al llegar al paso 2.
    expect(screen.getByLabelText("Código de verificación")).toHaveFocus();
  });

  it("paso 2: salida «¿Perdiste el dispositivo?» (F3 P2)", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    // F3 R5 P1: elevado (caja info, no un <p> al pie) y con expectativa de
    // proceso y plazo — no solo un buzón.
    const info = screen.getByRole("status");
    expect(info).toHaveTextContent(/Perdiste el dispositivo/);
    expect(info).toHaveTextContent(/24–48 h/);
    // F3 P1: el canal de contacto es un buzón real que recibe (mailto), no
    // un «no-reply» semánticamente muerto ni una referencia inexistente.
    expect(
      screen.getByRole("link", { name: "raumorales22@gmail.com" }),
    ).toHaveAttribute("href", "mailto:raumorales22@gmail.com");
  });

  it("paso 1 → 2: el campo de código NO hereda el valor de la contraseña (F3 R4)", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "juan@correo.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    // El campo de código debe montar vacío: si hereda el valor de la
    // contraseña (rama reconciliada sobre el <form> reutilizado), la PII
    // queda visible en el campo equivocado.
    expect(screen.getByLabelText("Código de verificación")).toHaveValue("");
  });

  it("paso 2 → volver: el email escrito se conserva, solo se repite la contraseña (F3 P2)", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      reset: vi.fn(),
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "juan@correo.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    expect(screen.getByLabelText("Código de verificación")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Volver a iniciar sesión" }));
    // El email no se pierde al salir del paso 2 (antes el campo volvía vacío):
    // solo hay que repetir la contraseña.
    expect(screen.getByLabelText("Email")).toHaveValue("juan@correo.com");
  });

  it("paso 2 → volver: el foco aterriza en la contraseña, no en <body> (F3 R4 P1)", async () => {
    mockResult(trpc.auth.login.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    mockResult(trpc.auth.verifyTotp.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      reset: vi.fn(),
    });
    render(<LoginForm />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "juan@correo.com");
    await user.type(screen.getByLabelText("Contraseña"), "clave-secreta-1");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await act(async () => {
      loginOptions().onSuccess?.({ totpRequired: true, totpToken: "reto-123" });
    });
    expect(screen.getByLabelText("Código de verificación")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Volver a iniciar sesión" }));
    // Asimetría corregida: el 1→2 enfoca el código; el 2→1 enfoca la
    // contraseña (el email se conserva, es lo único que hay que repetir).
    expect(screen.getByLabelText("Contraseña")).toHaveFocus();
  });
});
