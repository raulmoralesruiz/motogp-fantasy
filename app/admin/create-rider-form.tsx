"use client";

import { type FormEvent } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface CreateRiderFormProps {
  onCreated: () => void;
}

/**
 * Formulario de creación de piloto (US-06, flujo 18): nombre + dorsal
 * opcional. La creación es idempotente por nombre: si el piloto ya existe,
 * se reutiliza (el servidor lo indica y no audita la reutilización).
 */
export default function CreateRiderForm({ onCreated }: CreateRiderFormProps) {
  const create = trpc.market.riders.create.useMutation({ onSuccess: onCreated });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = String(data.get("number") ?? "");
    create.mutate({
      name: String(data.get("name") ?? ""),
      // Vacío → null explícito (el campo es opcional).
      number: number ? Number(number) : null,
    });
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
            ? "Piloto creado."
            : "El piloto ya existía: se reutiliza (no se duplica)."}
        </Alert>
      )}
      <Field
        label="Nombre"
        name="name"
        placeholder="Francesco Bagnaia"
        required
        error={fieldError("name")}
      />
      <Field
        label="Dorsal (opcional)"
        name="number"
        type="number"
        min={1}
        placeholder="27"
        error={fieldError("number")}
      />
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creando…" : "Crear piloto"}
      </Button>
    </form>
  );
}
