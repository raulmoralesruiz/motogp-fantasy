"use client";

import { type FormEvent } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface CreateCircuitFormProps {
  onCreated: () => void;
}

/**
 * Formulario de creación de circuito (US-05, flujo 18): nombre, país y
 * ubicación opcional. La creación es idempotente por `(name, country)`:
 * si el circuito ya existe, se reutiliza (el servidor lo indica y no
 * audita la reutilización).
 */
export default function CreateCircuitForm({ onCreated }: CreateCircuitFormProps) {
  const create = trpc.seasons.circuits.create.useMutation({ onSuccess: onCreated });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    create.mutate({
      name: String(data.get("name") ?? ""),
      country: String(data.get("country") ?? ""),
      // Vacío → null explícito (el campo es opcional).
      location: String(data.get("location") ?? "") || null,
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
            ? "Circuito creado."
            : "El circuito ya existía: se reutiliza (no se duplica)."}
        </Alert>
      )}
      <Field
        label="Nombre"
        name="name"
        placeholder="Circuito de Jerez"
        required
        error={fieldError("name")}
      />
      <Field
        label="País"
        name="country"
        placeholder="España"
        required
        error={fieldError("country")}
      />
      <Field
        label="Ubicación (opcional)"
        name="location"
        placeholder="Jerez de la Frontera"
        error={fieldError("location")}
      />
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creando…" : "Crear circuito"}
      </Button>
    </form>
  );
}
