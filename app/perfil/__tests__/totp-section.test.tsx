// @vitest-environment jsdom
/**
 * Tests de `app/perfil/totp-section.tsx` (D-07, ADR-0039): la sección de
 * 2FA en `/perfil` — los cuatro estados (desactivado, matriculación con
 * QR, pendiente de confirmar, activo) y sus errores, sobre el `trpc`
 * mockeado.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, render, screen, userEvent } from "../../../test/rtl";

import { TotpSection } from "../totp-section";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

function renderTotp(props: { enabled: boolean; enrolled: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TotpSection enabled={props.enabled} enrolled={props.enrolled} />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe("TotpSection (D-07, ADR-0039)", () => {
  beforeEach(() => {
    resetTrpcMocks();
  });

  it("desactivado: muestra el formulario de activación y envía la contraseña", async () => {
    const enroll = vi.fn();
    mockResult(trpc.auth.totp.enroll.useMutation, {
      mutate: enroll,
      isPending: false,
      isError: false,
    });
    renderTotp({ enabled: false, enrolled: false });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Contraseña (verificación)"), "clave-123");
    await user.click(screen.getByRole("button", { name: "Activar dos pasos" }));

    expect(enroll).toHaveBeenCalledWith({ password: "clave-123" });
  });

  it("muestra el QR y el secreto tras matricular, y envía el código de confirmación", async () => {
    const confirm = vi.fn();
    mockResult(trpc.auth.totp.enroll.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      onSuccess: vi.fn(),
    });
    mockResult(trpc.auth.totp.confirm.useMutation, {
      mutate: confirm,
      isPending: false,
      isError: false,
    });
    renderTotp({ enabled: false, enrolled: false });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Contraseña (verificación)"), "clave-123");
    await user.click(screen.getByRole("button", { name: "Activar dos pasos" }));

    // El onSuccess de `enroll` monta el QR (estado local del componente).
    const enrollOptions = (
      trpc.auth.totp.enroll.useMutation as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]?.[0] as { onSuccess?: (d: unknown) => void };
    await act(async () => {
      enrollOptions?.onSuccess?.({
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        qrDataUrl: "data:image/svg+xml;utf8,mock",
      });
    });

    expect(screen.getByRole("img")).toHaveAttribute("src", "data:image/svg+xml;utf8,mock");
    expect(screen.getByText("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Código de la app de autenticación"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirmar y activar" }));
    expect(confirm).toHaveBeenCalledWith({ code: "123456" });
  });

  it("pendiente (matriculado sin confirmar): solo pide el código", () => {
    renderTotp({ enabled: false, enrolled: true });
    expect(screen.getByLabelText("Código de la app de autenticación")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar dos pasos" })).toBeNull();
  });

  it("activo: confirma el estado y envía la contraseña al desactivar", async () => {
    const disable = vi.fn();
    mockResult(trpc.auth.totp.disable.useMutation, {
      mutate: disable,
      isPending: false,
      isError: false,
    });
    renderTotp({ enabled: true, enrolled: true });

    expect(screen.getByRole("status").textContent).toContain("ACTIVA");

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Contraseña (verificación)"), "clave-123");
    await user.click(screen.getByRole("button", { name: "Desactivar dos pasos" }));
    expect(disable).toHaveBeenCalledWith({ password: "clave-123" });
  });

  it("muestra el error del servidor (p. ej. contraseña incorrecta)", () => {
    const error = clientError("La contraseña no es correcta.", {
      code: "UNAUTHORIZED",
      message: "La contraseña no es correcta.",
    });
    mockResult(trpc.auth.totp.enroll.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderTotp({ enabled: false, enrolled: false });

    expect(screen.getByRole("alert").textContent).toContain("La contraseña no es correcta.");
  });

  it("activo: al desactivar con éxito invalida profile.me (el estado llega del servidor)", async () => {
    mockResult(trpc.auth.totp.disable.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const { queryClient } = renderTotp({ enabled: true, enrolled: true });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    // Simula el éxito del servidor: el onSuccess del componente se ejecuta.
    const options = (
      trpc.auth.totp.disable.useMutation as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[0] as { onSuccess?: () => void };
    await act(async () => {
      options?.onSuccess?.();
    });

    expect(spy).toHaveBeenCalled();
  });

  it("pendiente: al confirmar con éxito invalida profile.me", async () => {
    mockResult(trpc.auth.totp.enroll.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      onSuccess: vi.fn(),
    });
    mockResult(trpc.auth.totp.confirm.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
    });
    const { queryClient } = renderTotp({ enabled: false, enrolled: true });
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const options = (
      trpc.auth.totp.confirm.useMutation as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]?.[0] as { onSuccess?: () => void };
    await act(async () => {
      options?.onSuccess?.();
    });

    expect(spy).toHaveBeenCalled();
  });

  it("pendiente: error de confirmación por campo (Zod) junto al campo del código", () => {
    const error = clientError("Entrada no válida.", {
      zod: { issues: [{ path: ["code"], message: "El código debe tener 6 dígitos." }] },
    });
    mockResult(trpc.auth.totp.confirm.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderTotp({ enabled: false, enrolled: true });

    expect(screen.getByText("El código debe tener 6 dígitos.")).toBeInTheDocument();
    // El mensaje genérico no se repite en una alerta (ya está por campo).
    expect(screen.queryByText("Entrada no válida.")).not.toBeInTheDocument();
  });

  it("pendiente: error general de confirmación (sin issues de Zod) en alerta", () => {
    const error = clientError("El código no es válido o ha caducado.", {
      code: "UNAUTHORIZED",
    });
    mockResult(trpc.auth.totp.confirm.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderTotp({ enabled: false, enrolled: true });

    expect(screen.getByRole("alert").textContent).toContain(
      "El código no es válido o ha caducado.",
    );
  });

  it("activo: error de desactivación por campo (Zod) junto al campo de contraseña", () => {
    const error = clientError("Entrada no válida.", {
      zod: { issues: [{ path: ["password"], message: "La contraseña es obligatoria." }] },
    });
    mockResult(trpc.auth.totp.disable.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderTotp({ enabled: true, enrolled: true });

    expect(screen.getByText("La contraseña es obligatoria.")).toBeInTheDocument();
  });

  it("activo: error general de desactivación (contraseña incorrecta) en alerta", () => {
    const error = clientError("La contraseña no es correcta.", {
      code: "UNAUTHORIZED",
    });
    mockResult(trpc.auth.totp.disable.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error,
    });
    renderTotp({ enabled: true, enrolled: true });

    expect(screen.getByRole("alert").textContent).toContain("La contraseña no es correcta.");
  });
});
