"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

/**
 * Login (US-01) + segundo factor (D-07, ADR-0039):
 * - Paso 1: email + contraseña.
 * - Paso 2 (solo si la cuenta tiene 2FA activo): el servidor devuelve un
 *   reto de vida corta y el formulario pide el código de la app de
 *   autenticación; la cookie de sesión solo se emite en `verifyTotp`.
 */
export default function LoginForm() {
  const router = useRouter();
  // Reto TOTP del paso 2 (null = paso 1).
  const [challenge, setChallenge] = useState<string | null>(null);

  const login = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      if (data?.totpRequired && data.totpToken) {
        setChallenge(data.totpToken);
      } else {
        router.push("/");
      }
    },
  });

  const verifyTotp = trpc.auth.verifyTotp.useMutation({
    onSuccess: () => router.push("/"),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    login.mutate({
      email: String(data.get("email") ?? ""),
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
      <form className="form" onSubmit={onCode} noValidate>
        <p className="muted">
          Introduce el código de 6 dígitos de tu app de autenticación.
        </p>
        <Field
          label="Código de verificación"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          required
          error={totpFieldError("code")}
        />
        {totpGeneralError && <Alert variant="error">{totpGeneralError}</Alert>}
        <Button type="submit" disabled={verifyTotp.isPending}>
          {verifyTotp.isPending ? "Verificando…" : "Verificar"}
        </Button>
      </form>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="tu@email.com"
        required
        error={loginFieldError("email")}
      />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={loginFieldError("password")}
      />
      {loginGeneralError && <Alert variant="error">{loginGeneralError}</Alert>}
      <Button type="submit" disabled={login.isPending}>
        {login.isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
