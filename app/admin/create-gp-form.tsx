"use client";

import { useState, type FormEvent } from "react";

import { Alert, Button, Field } from "@/shared/components";
import type { CircuitView } from "@/modules/seasons";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

interface CreateGpFormProps {
  /** Temporada a la que pertenece el GP (seleccionada en la sección). */
  seasonId: string;
  circuits: CircuitView[];
  onCreated: () => void;
}

const EVENT_TYPES = ["q1", "q2", "sprint", "race"] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_LABELS: Record<EventType, string> = {
  q1: "Q1",
  q2: "Q2",
  sprint: "Sprint",
  race: "Carrera",
};

interface EventState {
  checked: boolean;
  /** Valor de `<input type="datetime-local">` (cadena vacía = sin hora). */
  startTime: string;
}

/**
 * Formulario de creación manual de GP (US-05, flujo 18): Q2 y carrera
 * obligatorias (CA), Q1 y sprint opcionales (se pueden añadir después con
 * `gps.addEvent`); `lockoutAt` opcional y editable después (auditado).
 * Fallback de la import de calendario (ADR-0012).
 */
export default function CreateGpForm({
  seasonId,
  circuits,
  onCreated,
}: CreateGpFormProps) {
  const create = trpc.seasons.gps.create.useMutation({ onSuccess: onCreated });
  const [circuitId, setCircuitId] = useState("");
  const [lockoutAt, setLockoutAt] = useState("");
  const [events, setEvents] = useState<Record<EventType, EventState>>({
    q1: { checked: false, startTime: "" },
    q2: { checked: true, startTime: "" },
    sprint: { checked: false, startTime: "" },
    race: { checked: true, startTime: "" },
  });

  function toggleEvent(type: EventType, checked: boolean) {
    setEvents((prev) => ({ ...prev, [type]: { ...prev[type], checked } }));
  }

  function setEventTime(type: EventType, startTime: string) {
    setEvents((prev) => ({ ...prev, [type]: { ...prev[type], startTime } }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const date = String(data.get("date") ?? "");
    if (!date || !circuitId) return;
    create.mutate({
      seasonId,
      round: Number(data.get("round") ?? 0),
      name: String(data.get("name") ?? ""),
      circuitId,
      date: new Date(date),
      lockoutAt: lockoutAt ? new Date(lockoutAt) : null,
      events: EVENT_TYPES.filter((type) => events[type].checked).map((type) => ({
        type,
        startTime: events[type].startTime ? new Date(events[type].startTime) : null,
      })),
    });
  }

  const issues = create.isError ? zodIssues(create.error) : [];
  const fieldError = (name: string) =>
    issues.find((issue) => issue.path?.[0] === name)?.message;
  const eventsError =
    issues.find((issue) => issue.path?.[0] === "events")?.message ?? null;
  const generalError =
    create.isError && issues.length === 0 ? create.error.message : null;

  const canSubmit = events.q2.checked && events.race.checked;

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {generalError && <Alert variant="error">{generalError}</Alert>}
      {create.isSuccess && <Alert variant="success">GP creado con sus eventos.</Alert>}
      <Field
        label="Ronda"
        name="round"
        type="number"
        min={1}
        placeholder="1"
        required
        error={fieldError("round")}
      />
      <Field
        label="Nombre"
        name="name"
        placeholder="GP de España"
        required
        error={fieldError("name")}
      />
      <div className="field">
        <label htmlFor="gpCircuitId">Circuito</label>
        <select
          id="gpCircuitId"
          name="circuitId"
          value={circuitId}
          onChange={(event) => setCircuitId(event.target.value)}
        >
          <option value="">— Elige un circuito —</option>
          {circuits.map((circuit) => (
            <option key={circuit.id} value={circuit.id}>
              {circuit.name} ({circuit.country})
            </option>
          ))}
        </select>
        {fieldError("circuitId") && (
          <p className="field-error">{fieldError("circuitId")}</p>
        )}
      </div>
      <Field
        label="Fecha (día de carrera)"
        name="date"
        type="date"
        required
        error={fieldError("date")}
      />
      <Field
        label="Lockout (opcional, editable después)"
        name="lockoutAt"
        type="datetime-local"
        value={lockoutAt}
        onChange={(event) => setLockoutAt(event.target.value)}
        error={fieldError("lockoutAt")}
      />
      <fieldset className="field">
        <legend>Eventos del fin de semana (Q2 y carrera obligatorias)</legend>
        {EVENT_TYPES.map((type) => (
          <div key={type}>
            <label>
              <input
                type="checkbox"
                checked={events[type].checked}
                onChange={(event) => toggleEvent(type, event.target.checked)}
              />{" "}
              {EVENT_LABELS[type]}
              {type === "q2" || type === "race" ? " *" : ""}
            </label>
            <input
              type="datetime-local"
              aria-label={`Hora de inicio de ${EVENT_LABELS[type]}`}
              value={events[type].startTime}
              disabled={!events[type].checked}
              onChange={(event) => setEventTime(type, event.target.value)}
            />
          </div>
        ))}
        {eventsError && <p className="field-error">{eventsError}</p>}
      </fieldset>
      <Button type="submit" disabled={create.isPending || !canSubmit}>
        {create.isPending ? "Creando…" : "Crear GP"}
      </Button>
    </form>
  );
}
