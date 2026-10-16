"use client";

import { useRouter } from "next/navigation";
import { type FormEvent } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

export default function LoginForm() {
  const router = useRouter();
  const login = trpc.auth.login.useMutation({
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

  const issues = login.isError ? zodIssues(login.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const generalError = login.isError && issues.length === 0 ? login.error.message : null;

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
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fieldError("password")}
      />
      {generalError && <Alert variant="error">{generalError}</Alert>}
      <Button type="submit" disabled={login.isPending}>
        {login.isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </Button>
    </form>
  );
}
