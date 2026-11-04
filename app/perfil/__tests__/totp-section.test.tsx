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
});
