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
        <label htmlFor="username">Nombre de usuario</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          placeholder="tu_nombre"
          required
        />
        {fieldError("username") && (
          <p className="field-error">{fieldError("username")}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          required
        />
        {fieldError("password") && (
          <p className="field-error">{fieldError("password")}</p>
        )}
      </div>
      <div className="field check">
        <input id="termsAccepted" name="termsAccepted" type="checkbox" required />
        <label htmlFor="termsAccepted">
          Acepto los términos y la política de privacidad
        </label>
      </div>
      {fieldError("termsAccepted") && (
        <p className="field-error">{fieldError("termsAccepted")}</p>
      )}
      {generalError && (
        <p className="form-error" role="alert">
          {generalError}
        </p>
      )}
      <button type="submit" disabled={register.isPending}>
        {register.isPending ? "Creando cuenta…" : "Crear cuenta"}
      </button>
    </form>
  );
}
