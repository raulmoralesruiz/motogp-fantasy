"use client";

import { useState, type FormEvent } from "react";

import type { ConstructorView } from "@/modules/market";
import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface CreateTeamFormProps {
  constructors: ConstructorView[];
  onCreated: () => void;
}

/**
 * Formulario de creación de equipo (US-06, flujo 18): nombre + constructor
 * (debe existir; un equipo pertenece a exactamente un constructor — CA
 * US-06). La creación es idempotente por nombre: si el equipo ya existe, se
 * reutiliza (el servidor lo indica y no audita la reutilización).
 */
export default function CreateTeamForm({
  constructors,
  onCreated,
}: CreateTeamFormProps) {
  const create = trpc.market.teams.create.useMutation({ onSuccess: onCreated });
  const [constructorId, setConstructorId] = useState("");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (!constructorId) return;
    create.mutate({
      name: String(data.get("name") ?? ""),
      constructorId,
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
            ? "Equipo creado."
            : "El equipo ya existía: se reutiliza (no se duplica)."}
        </Alert>
      )}
      <Field
        label="Nombre"
        name="name"
        placeholder="Ducati Lenovo Team"
        required
        error={fieldError("name")}
      />
      <div className="field">
        <label htmlFor="teamConstructorId">Constructor</label>
        <select
          id="teamConstructorId"
          name="constructorId"
          value={constructorId}
          onChange={(event) => setConstructorId(event.target.value)}
        >
          <option value="">— Elige un constructor —</option>
          {constructors.map((constructor) => (
            <option key={constructor.id} value={constructor.id}>
              {constructor.name}
            </option>
          ))}
        </select>
        {fieldError("constructorId") && (
          <p className="field-error">{fieldError("constructorId")}</p>
        )}
      </div>
      <Button type="submit" disabled={create.isPending || constructorId === ""}>
        {create.isPending ? "Creando…" : "Crear equipo"}
      </Button>
    </form>
  );
}
