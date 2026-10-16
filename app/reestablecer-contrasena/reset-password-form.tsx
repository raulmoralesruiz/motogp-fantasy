"use client";

import { useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const reset = trpc.auth.resetPassword.useMutation({
    onSuccess: () => setDone(true),
  });

  if (!token) {
    return (
      <Alert variant="error">
        El enlace de recuperación no es válido o está incompleto. Solicita uno nuevo desde
        la página de <a href="/recuperar-contrasena">recuperar contraseña</a>.
      </Alert>
    );
  }

  if (done) {
    return (
      <div className="form">
        <Alert variant="success">
          Contraseña restablecida. Ya puedes iniciar sesión con tu nueva contraseña.
        </Alert>
        <a href="/login">Ir a iniciar sesión</a>
      </div>
    );
  }

  // Const arrow (no declaración hoisted) para que el estrechamiento de `token`
  // (string, tras el early return de arriba) se mantenga dentro del closure.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    reset.mutate({ token, password });
  };

  const issues = reset.isError ? zodIssues(reset.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const generalError = reset.isError && issues.length === 0 ? reset.error.message : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field
        label="Nueva contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        error={fieldError("password")}
      />
      <Field
        label="Repite la contraseña"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={mismatch ? "Las contraseñas no coinciden" : null}
      />
      {generalError && <Alert variant="error">{generalError}</Alert>}
      <Button type="submit" disabled={reset.isPending}>
        {reset.isPending ? "Restableciendo…" : "Restablecer contraseña"}
      </Button>
    </form>
  );
}
