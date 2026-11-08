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
 * Cuatro estados (orden de evaluación — el QR va antes que PENDIENTE para
 * que la re-matriculación sea visible):
 * - ACTIVO: aviso + desactivar (re-autenticación con contraseña).
 * - QR PENDIENTE DE CONFIRMAR: QR + secreto + código (nuevo o re-emitido)
 *   + cancelar.
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

  const confirm = trpc.auth.totp.confirm.useMutation({
    onSuccess: () => {
      setQr(null);
      invalidateMe();
    },
  });

  const enroll = trpc.auth.totp.enroll.useMutation({
    onSuccess: (data) => {
      // Nueva matriculación: borra el éxito de cualquier confirmación previa.
      // El estado `isSuccess` de la mutación persiste hasta un `reset()`; si
      // no se limpia, un ciclo activar→desactivar→re-matricular dejaría el
      // flag stale y la rama de éxito se dispararía con 2FA pendiente (F3 P2).
      confirm.reset();
      setQr({ secret: data.secret, qrDataUrl: data.qrDataUrl });
    },
  });

  const disable = trpc.auth.totp.disable.useMutation({
    onSuccess: () => {
      // Al desactivar, la confirmación previa ya no es relevante: se resetea
      // para que el flag `isSuccess` no se filtre a un ciclo posterior (F3 P2).
      confirm.reset();
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
          Para desactivarla introduce tu contraseña.
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

  if (qr) {
    // Matriculación recién generada (o re-matriculación desde PENDIENTE):
    // QR + secreto (para entrada manual) + código. Se evalúa ANTES que
    // `enrolled`: tras «Generar nuevo código» desde el estado PENDIENTE el
    // `qr` se llena y debe mostrarse aquí (F3 P1 — si fuera después, la
    // rama PENDIENTE la ocultaría y el escape sería un no-op silencioso).
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
          style={{ maxWidth: "100%", height: "auto" }}
        />
        <p className="muted">
          Secreto: <code>{qr.secret}</code>
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
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            // Borra el error de la confirmación (si la hubo): al volver al
            // estado PENDIENTE no debe reaparecer un fallo ya superado (F3 P3).
            confirm.reset();
            setQr(null);
            // Sincroniza `profile.me`: si veníamos del estado desactivado,
            // el secreto ya existe en el servidor y la sección debe mostrar
            // PENDIENTE (no «desactivado» con props obsoletas).
            invalidateMe();
          }}
        >
          Cancelar
        </Button>
      </div>
    );
  }

  // F3 P3/P2: la confirmación acaba de salir bien pero las props
  // (`enabled`/`enrolled`, de `profile.me`) aún son stale (refetch en curso):
  // se muestra el estado de éxito hasta que llegue `me`, en vez de parpadear
  // "PENDIENTE" o el formulario de activación. Se evalúa ANTES que `enrolled`
  // para cubrir también el gap de matriculación nueva. El flag `isSuccess` se
  // resetea en `enroll`/`disable` (arriba), así que no se filtra a un ciclo
  // posterior — si se filtrara, esta rama afirmaría "ACTIVA" con 2FA pendiente.
  if (confirm.isSuccess) {
    return (
      <div>
        <Alert variant="success">
          Autenticación en dos pasos ACTIVA: al iniciar sesión se pedirá el
          código de tu app de autenticación.
        </Alert>
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
        {/* F3 P1: escape del estado PENDIENTE — si el teléfono se pierde o el
            código no funciona, se genera uno nuevo (re-autenticación con
            contraseña; el backend reemplaza el secreto pendiente). */}
        <p className="muted">
          ¿No puedes introducir el código? Genera un código nuevo (se reemplaza
          el pendiente) introduciendo tu contraseña.
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
          <Button type="submit" variant="secondary" disabled={enroll.isPending}>
            {enroll.isPending ? "Preparando…" : "Generar nuevo código"}
          </Button>
        </form>
      </div>
    );
  }

  // Desactivado y sin matriculación pendiente: formulario de activación.
  return (
    <div>
      <p className="muted">
        Añade un segundo factor con tu app de autenticación. Es especialmente
        recomendada si eres administrador global.
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
