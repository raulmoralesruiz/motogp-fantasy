"use client";

import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

export default function ResetRequestForm() {
  const [sent, setSent] = useState(false);
  const requestReset = trpc.auth.requestReset.useMutation({
    onSuccess: () => setSent(true),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    requestReset.mutate({ email: String(data.get("email") ?? "") });
  }

  if (sent) {
    return (
      <div className="form">
        <Alert variant="success">
          Si el email está registrado, recibirás un enlace de recuperación en los próximos
          minutos. Revisa también la carpeta de spam.
        </Alert>
      </div>
    );
  }

  const issues = requestReset.isError ? zodIssues(requestReset.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const generalError =
    requestReset.isError && issues.length === 0 ? requestReset.error.message : null;

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
      {generalError && <Alert variant="error">{generalError}</Alert>}
      <Button type="submit" disabled={requestReset.isPending}>
        {requestReset.isPending ? "Enviando…" : "Enviar enlace de recuperación"}
      </Button>
    </form>
  );
}
