"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

export default function RegisterForm() {
  const [done, setDone] = useState(false);
  const register = trpc.auth.register.useMutation({
    // F3 P2: el éxito del momento de mayor stakes es visible — mismo
    // patrón que las páginas hermanas (recuperar/reestablecer):
    // confirmación explícita + acción en bloque, no un salto silencioso.
    onSuccess: () => setDone(true),
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

  if (done) {
    return (
      <div className="form">
        <Alert variant="success">
          Cuenta creada. Ahora monta tu primer lineup: 2 oro + 2 plata + 1
          constructor + 1 equipo.
        </Alert>
        {/* F3 R5 P1: el pico del onboarding empuja al objetivo #1 del producto
            (activación >60%: primer lineup tras el registro — PRODUCT.md). La
            intro ya primó la composición; la salida la convierte en acción.
            El dashboard queda como salida secundaria. */}
        <Link className="button" href="/lineups">
          Monta tu primer lineup
        </Link>
        <Link className="button-secondary" href="/">
          Ir a mi dashboard
        </Link>
      </div>
    );
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
      {/* F3 P3: las reglas visibles ANTES del primer error (auth.ts: 3–20,
          letras/números/guiones bajos) — evita el round-trip de validación. */}
      <p className="muted">3–20 caracteres: letras, números y guiones bajos.</p>
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
        {/* Barrido P3 (auth): el checkbox cablea `aria-invalid`/`aria-describedby`
            igual que `Field` — los lectores de pantalla anuncian el error
            «debes aceptar los términos» (antes: el error no estaba asociado). */}
        <input
          id="termsAccepted"
          name="termsAccepted"
          type="checkbox"
          required
          aria-invalid={fieldError("termsAccepted") ? true : undefined}
          aria-describedby={
            fieldError("termsAccepted") ? "termsAccepted-error" : undefined
          }
        />
        {/* F3 P1: el consentimiento debe ser INFORMADO — la etiqueta enlaza
            a los documentos reales (antes: texto sin enlaces a páginas que
            no existían; ahora /terminos y /privacidad). */}
        <label htmlFor="termsAccepted">
          Acepto los <a href="/terminos">términos</a> y la{" "}
          <a href="/privacidad">política de privacidad</a>
        </label>
      </div>
      {fieldError("termsAccepted") && (
        // F3 P3: anunciado a lectores de pantalla (igual que el error de Field).
        <p className="field-error" role="alert" id="termsAccepted-error">
          {fieldError("termsAccepted")}
        </p>
      )}
      {generalError && <Alert variant="error">{generalError}</Alert>}
      <Button type="submit" disabled={register.isPending}>
        {register.isPending ? "Creando cuenta…" : "Crear cuenta"}
      </Button>
    </form>
  );
}
