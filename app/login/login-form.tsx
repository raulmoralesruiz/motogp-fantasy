"use client";

import { useRouter } from "next/navigation";
import { type FormEvent } from "react";

import { trpc } from "@/trpc/client";

type ZodIssueLike = { path?: (string | number)[]; message: string };

/** Extrae los issues de Zod del error tRPC (si procede). */
function zodIssues(error: unknown): ZodIssueLike[] {
  const data = (
    error as { data?: { zod?: ZodIssueLike[] | { issues?: ZodIssueLike[] } } } | null
  )?.data;
  const zod = data?.zod;
  if (Array.isArray(zod)) return zod;
  if (zod && Array.isArray(zod.issues)) return zod.issues;
  return [];
}

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
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@email.com"
          required
        />
        {fieldError("email") && <p className="field-error">{fieldError("email")}</p>}
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {fieldError("password") && <p className="field-error">{fieldError("password")}</p>}
      </div>
      {generalError && (
        <p className="form-error" role="alert">
          {generalError}
        </p>
      )}
      <button type="submit" disabled={login.isPending}>
        {login.isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
    </form>
  );
}
