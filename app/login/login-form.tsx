"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

/**
 * Email enmascarado (mismo patrón que la home, F3 P3): primera letra +
 * dominio. Es el email del propio usuario, pero se minimiza la PII visible
 * (AGENTS.md §8, GDPR).
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * Login (US-01) + segundo factor (D-07, ADR-0039):
 * - Paso 1: email + contraseña.
 * - Paso 2 (solo si la cuenta tiene 2FA activo): el servidor devuelve un
 *   reto de vida corta y el formulario pide el código de la app de
 *   autenticación; la cookie de sesión solo se emite en `verifyTotp`.
 *
 * F3 (impeccable, 2026-11-08):
 * - P1: el paso 2 tiene salida («Volver a iniciar sesión»): el error
 *   «El reto ha caducado. Vuelve a iniciar sesión» prescribe una acción
 *   que la UI ahora ofrece.
 * - P2: foco en el campo de código al cambiar de paso (`autoFocus`).
 * - P2: salida «¿Perdiste el dispositivo?» — sin callejón silencioso.
 * - P3: email enmascarado: se ve para qué cuenta es el código.
 */
/**
 * Destino tras el login: `?next=<ruta>` si es una ruta relativa válida
 * (F4 P3: `/unirse` conserva la puerta de entrada tras el login — el
 * usuario invitado no vuelve a la home a re-encontrarla), si no, la home.
 * Solo se acepta `next` que empiece por `/` simple: ni URLs absolutas ni
 * protocol-relative (`//…`) — sin `next`, el cliente no puede salir del
 * sitio.
 */
function redirectTarget(searchParams: URLSearchParams): string {
  const next = searchParams.get("next");
  return next !== null && next.startsWith("/") && !next.startsWith("//")
    ? next
    : "/";
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Reto TOTP del paso 2 (null = paso 1).
  const [challenge, setChallenge] = useState<string | null>(null);
  // Email del paso 1: para indicar de qué cuenta es el código (F3 P3).
  const [email, setEmail] = useState("");

  // F3 P2: el foco viaja al campo de código al entrar en el paso 2.
  // `autoFocus` no dispara cuando la rama se monta dinámicamente sobre un
  // `<form>` reutilizado del paso 1 (React 19 aplica el foco en
  // `commitMount`, que se salta al reconciliar la rama); `useEffect` + ref
  // es determinista tanto en el montaje como en el cambio de paso.
  const codeRef = useRef<HTMLInputElement>(null);
  // F3 R4 P1: al volver del paso 2, el foco viaja al campo de contraseña
  // (el email se conserva; la contraseña es lo único que hay que repetir).
  // Sin esto el foco queda en <body> y un usuario de teclado/lector de
  // pantalla tiene que recorrer la página desde arriba (asimetría con el
  // 1→2, que sí enfoca el código).
  const passwordRef = useRef<HTMLInputElement>(null);
  const [returnedFromStep2, setReturnedFromStep2] = useState(false);
  useEffect(() => {
    if (challenge) {
      codeRef.current?.focus();
    } else if (returnedFromStep2) {
      passwordRef.current?.focus();
    }
  }, [challenge, returnedFromStep2]);

  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (data?.totpRequired && data.totpToken) {
        setChallenge(data.totpToken);
      } else {
        router.push(redirectTarget(searchParams));
      }
    },
  });

  const verifyTotp = trpc.auth.verifyTotp.useMutation({
    onSuccess: () => router.push(redirectTarget(searchParams)),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const emailValue = String(data.get("email") ?? "");
    setEmail(emailValue);
    login.mutate({
      email: emailValue,
      password: String(data.get("password") ?? ""),
    });
  }

  function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    const data = new FormData(event.currentTarget);
    verifyTotp.mutate({
      token: challenge,
      code: String(data.get("code") ?? "").trim(),
    });
  }

  // F3 P1: salida del paso 2. `verifyTotp.reset()` borra el error de la
  // verificación fallida (TanStack conserva `isError` hasta `reset()`).
  function backToStep1() {
    verifyTotp.reset();
    // F3 R4 P1: marca el retorno para que el efecto de foco mueva el foco
    // al campo de contraseña (ver `useEffect` + `passwordRef` arriba).
    setReturnedFromStep2(true);
    setChallenge(null);
  }

  const loginIssues = login.isError ? zodIssues(login.error) : [];
  const loginFieldError = (name: string) =>
    loginIssues.find((issue) => issue.path?.[0] === name)?.message;
  const loginGeneralError =
    login.isError && loginIssues.length === 0 ? login.error.message : null;

  const totpIssues = verifyTotp.isError ? zodIssues(verifyTotp.error) : [];
  const totpFieldError = (name: string) =>
    totpIssues.find((issue) => issue.path?.[0] === name)?.message;
  const totpGeneralError =
    verifyTotp.isError && totpIssues.length === 0
      ? verifyTotp.error.message
      : null;

  if (challenge) {
    return (
      // F3 R4: `key` distinto por paso. Sin él, React reconcilia las dos ramas
      // sobre el mismo `<form>` (mismo mecanismo que anuló `autoFocus`) y
      // REUTILIZA el input de la contraseña como input del código: el valor
      // tecleado en el paso 1 queda visible en el campo del paso 2 (PII).
      // Con `key` cada rama se desmonta/monta entera: el código nace vacío.
      <form key="step-2" className="form" onSubmit={onCode} noValidate>
        <p className="muted">
          {/* F3 P3: de qué cuenta es el código (email enmascarado). */}
          {email ? (
            <>
              Introduce el código de 6 dígitos de tu app de autenticación
              para <strong>{maskEmail(email)}</strong>.
            </>
          ) : (
            "Introduce el código de 6 dígitos de tu app de autenticación."
          )}
        </p>
        <Field
          label="Código de verificación"
          name="code"
          type="text"
          // F3 P2: el foco viaja al paso nuevo (teclado/lector de pantalla);
          // ver `useEffect` + `codeRef` arriba.
          ref={codeRef}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          required
          error={totpFieldError("code")}
        />
        {totpGeneralError && <Alert variant="error">{totpGeneralError}</Alert>}
        {/* F3 R5 P1: el peor momento del flujo (bloqueo por 2FA) merece
            diseño: elevado (caja info, no un <p> al pie) y con expectativa de
            proceso y plazo — no solo un buzón. El canal es un buzón real que
            recibe (decisión del dueño, 2026-11-08), no un «no-reply» muerto. */}
        <Alert variant="info">
          ¿Perdiste el dispositivo o la app de autenticación? Escríbenos a{" "}
          <a href="mailto:raumorales22@gmail.com">raumorales22@gmail.com</a>:
          te pediremos verificar tu identidad y respondemos en 24–48 h.
        </Alert>
        <Button type="submit" disabled={verifyTotp.isPending}>
          {verifyTotp.isPending ? "Verificando…" : "Verificar"}
        </Button>
        {/* F3 P1: salida del paso 2 — el medio que prescribe el error
            «El reto ha caducado. Vuelve a iniciar sesión». */}
        <Button type="button" variant="secondary" onClick={backToStep1}>
          Volver a iniciar sesión
        </Button>
      </form>
    );
  }

  return (
    <form key="step-1" className="form" onSubmit={onSubmit} noValidate>
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        // F3 P2: al volver del paso 2, el email ya escrito se conserva
        // (solo hay que repetir la contraseña), no se pierde.
        defaultValue={email}
        placeholder="tu@email.com"
        required
        error={loginFieldError("email")}
      />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        // F3 R4 P1: el foco aterriza aquí al volver del paso 2.
        ref={passwordRef}
        required
        error={loginFieldError("password")}
      />
      {/* F3 P3: junto al campo de contraseña (convención y expectativa del
          usuario), no al pie del formulario. F3 P2: target táctil de 44 px
          (Regla de los 44) — acción secundaria neutra, no un enlace fino. */}
      <a className="button-secondary" href="/recuperar-contrasena">
        ¿Olvidaste tu contraseña?
      </a>
      {loginGeneralError && <Alert variant="error">{loginGeneralError}</Alert>}
      <Button type="submit" disabled={login.isPending}>
        {login.isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
