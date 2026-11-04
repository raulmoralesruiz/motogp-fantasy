"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface TotpSectionProps {
  /** 2FA activo (el login exige código). */
  enabled: boolean;
  /** Secreto matriculado (pending hasta confirmar o activo). */
  enrolled: boolean;
}

/**
 * 2FA TOTP (D-07, ADR-0039) — sección de `/perfil`.
 *
 * Tres estados:
 * - ACTIVO: aviso + desactivar (re-autenticación con contraseña).
 * - MATRICULADO SIN CONFIRMAR: confirmar con el código de la app o
 *   matricular de nuevo (nuevo QR).
 * - DESACTIVADO: matricular (contraseña → QR + secreto → código → activo).
 *
 * `enabled`/`enrolled` llegan como props desde la página (la query
 * `profile.me` es única; el componente solo gestiona sus mutations).
 */
export function TotpSection({ enabled, enrolled }: TotpSectionProps) {
  const queryClient = useQueryClient();
  // Resultado de `enroll` (QR + secreto para mostrar en la UI).
  const [qr, setQr] = useState<{ secret: string; qrDataUrl: string } | null>(null);

  function invalidateMe() {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.profile.me) });
  }

  const enroll = trpc.auth.totp.enroll.useMutation({
    onSuccess: (data) => setQr({ secret: data.secret, qrDataUrl: data.qrDataUrl }),
  });

  const confirm = trpc.auth.totp.confirm.useMutation({
    onSuccess: () => {
      setQr(null);
      invalidateMe();
    },
  });

  const disable = trpc.auth.totp.disable.useMutation({
    onSuccess: () => {
      setQr(null);
      invalidateMe();
    },
  });

  function onEnroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    enroll.mutate({ password: String(data.get("totp-password") ?? "") });
  }

  function onConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    confirm.mutate({ code: String(data.get("code") ?? "").trim() });
  }

  function onDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    disable.mutate({ password: String(data.get("totp-password") ?? "") });
  }

  const enrollFieldError = (name: string) =>
    enroll.isError ? zodIssues(enroll.error).find((i) => i.path?.[0] === name)?.message : null;
  const enrollGeneralError =
    enroll.isError && zodIssues(enroll.error).length === 0
      ? enroll.error.message
      : null;

  const confirmFieldError = (name: string) =>
    confirm.isError
      ? zodIssues(confirm.error).find((i) => i.path?.[0] === name)?.message
      : null;
  const confirmGeneralError =
    confirm.isError && zodIssues(confirm.error).length === 0
      ? confirm.error.message
      : null;

  const disableFieldError = (name: string) =>
    disable.isError
      ? zodIssues(disable.error).find((i) => i.path?.[0] === name)?.message
      : null;
  const disableGeneralError =
    disable.isError && zodIssues(disable.error).length === 0
      ? disable.error.message
      : null;

  if (enabled) {
    return (
      <div>
        <Alert variant="success">
          Autenticación en dos pasos ACTIVA: al iniciar sesión se pedirá el
          código de tu app de autenticación.
        </Alert>
        <p className="muted">
          Para desactivarla introduce tu contraseña. Recomendado para
          administradores globales (security.md §5).
        </p>
        <form className="form" onSubmit={onDisable} noValidate>
          <Field
            label="Contraseña (verificación)"
            name="totp-password"
            type="password"
            autoComplete="current-password"
            required
            error={disableFieldError("password")}
          />
          {disableGeneralError && <Alert variant="error">{disableGeneralError}</Alert>}
          <Button type="submit" disabled={disable.isPending}>
            {disable.isPending ? "Desactivando…" : "Desactivar dos pasos"}
          </Button>
        </form>
      </div>
    );
  }

  if (enrolled) {
    // Matriculado sin confirmar: pendiente de un código válido.
    return (
      <div>
        <Alert variant="info">
          Tienes una matriculación de dos pasos PENDIENTE: introduce el código
          de tu app de autenticación para activarla.
        </Alert>
        <form className="form" onSubmit={onConfirm} noValidate>
          <Field
            label="Código de la app de autenticación"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            required
            error={confirmFieldError("code")}
          />
          {confirmGeneralError && <Alert variant="error">{confirmGeneralError}</Alert>}
          <Button type="submit" disabled={confirm.isPending}>
            {confirm.isPending ? "Confirmando…" : "Confirmar y activar"}
          </Button>
        </form>
      </div>
    );
  }

  if (qr) {
    // Matriculación recién generada: QR + secreto (para entrada manual) + código.
    return (
      <div>
        <Alert variant="info">
          Escanea el código con tu app de autenticación (Google Authenticator,
          Aegis, 1Password…) o introduce el secreto a mano, y escribe aquí el
          código de 6 dígitos para activar.
        </Alert>
        {/* Data URL de un SVG estático generado en el servidor: el secreto
            viaja solo entre el cliente y nuestra API (sin servicios externos).
            <img> (no next/image): la data URL no es una imagen remota
            optimizable (ADR-0039). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- QR SVG estático server-side (ADR-0039) */}
        <img
          src={qr.qrDataUrl}
          alt="Código QR de matriculación de la autenticación en dos pasos"
          width={256}
          height={256}
        />
        <p className="muted">
          Secreto: <strong>{qr.secret}</strong>
        </p>
        <form className="form" onSubmit={onConfirm} noValidate>
          <Field
            label="Código de la app de autenticación"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            required
            error={confirmFieldError("code")}
          />
          {confirmGeneralError && <Alert variant="error">{confirmGeneralError}</Alert>}
          <Button type="submit" disabled={confirm.isPending}>
            {confirm.isPending ? "Confirmando…" : "Confirmar y activar"}
          </Button>
        </form>
      </div>
    );
  }

  // Desactivado y sin matriculación pendiente: formulario de activación.
  return (
    <div>
      <p className="muted">
        Añade un segundo factor con tu app de autenticación (TOTP, RFC 6238).
        Recomendado para administradores globales (security.md §5).
      </p>
      <form className="form" onSubmit={onEnroll} noValidate>
        <Field
          label="Contraseña (verificación)"
          name="totp-password"
          type="password"
          autoComplete="current-password"
          required
          error={enrollFieldError("password")}
        />
        {enrollGeneralError && <Alert variant="error">{enrollGeneralError}</Alert>}
        <Button type="submit" disabled={enroll.isPending}>
          {enroll.isPending ? "Preparando…" : "Activar dos pasos"}
        </Button>
      </form>
    </div>
  );
}
