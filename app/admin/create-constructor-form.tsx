"use client";

import { type FormEvent } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface CreateConstructorFormProps {
  onCreated: () => void;
}

/**
 * Formulario de creación de constructor (US-06, flujo 18): nombre. La
 * creación es idempotente por nombre: si el constructor ya existe, se
 * reutiliza (el servidor lo indica y no audita la reutilización). El
 * constructor es un activo distinto del equipo (invariante 5).
 */
export default function CreateConstructorForm({
  onCreated,
}: CreateConstructorFormProps) {
  const create = trpc.market.constructors.create.useMutation({
    onSuccess: onCreated,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    create.mutate({ name: String(data.get("name") ?? "") });
  }

  const issues = create.isError ? zodIssues(create.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const generalError =
    create.isError && issues.length === 0 ? create.error.message : null;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {generalError && <Alert variant="error">{generalError}</Alert>}
      {create.isSuccess && (
        <Alert variant="success">
          {create.data?.created
            ? "Constructor creado."
            : "El constructor ya existía: se reutiliza (no se duplica)."}
        </Alert>
      )}
      <Field
        label="Nombre"
        name="name"
        placeholder="Ducati"
        required
        error={fieldError("name")}
      />
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creando…" : "Crear constructor"}
      </Button>
    </form>
  );
}
