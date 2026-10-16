"use client";

import { useRouter } from "next/navigation";
import { type FormEvent } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

export default function RegisterForm() {
  const router = useRouter();
  const register = trpc.auth.register.useMutation({
    onSuccess: () => router.push("/"),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    register.mutate({
      email: String(data.get("email") ?? ""),
      username: String(data.get("username") ?? ""),
      password: String(data.get("password") ?? ""),
      termsAccepted: data.get("termsAccepted") === "on",
    });
  }

  const issues = register.isError ? zodIssues(register.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const generalError =
    register.isError && issues.length === 0 ? register.error.message : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        placeholder="tu@email.com"
        required
        error={fieldError("email")}
      />
      <Field
        label="Nombre de usuario"
        name="username"
        autoComplete="username"
        placeholder="tu_nombre"
        required
        error={fieldError("username")}
      />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        placeholder="Mínimo 8 caracteres"
        required
        error={fieldError("password")}
      />
      <div className="field check">
        <input id="termsAccepted" name="termsAccepted" type="checkbox" required />
        <label htmlFor="termsAccepted">
          Acepto los términos y la política de privacidad
        </label>
      </div>
      {fieldError("termsAccepted") && (
        <p className="field-error">{fieldError("termsAccepted")}</p>
      )}
      {generalError && <Alert variant="error">{generalError}</Alert>}
      <Button type="submit" disabled={register.isPending}>
        {register.isPending ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
    </form>
  );
}
