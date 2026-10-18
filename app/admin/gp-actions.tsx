"use client";

import { useState, type FormEvent } from "react";
import type { GpStatus } from "@prisma/client";

import { Alert, Button } from "@/shared/components";
import { allowedGpStatusTransitions } from "@/modules/seasons/gp-status";
import type { GpView } from "@/modules/seasons";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

export const GP_STATUS_LABELS: Record<GpStatus, string> = {
  scheduled: "programado",
  locked: "bloqueado",
  finished: "finalizado",
  cancelled: "cancelado",
};

const EVENT_TYPES = ["q1", "q2", "sprint", "race"] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_LABELS: Record<EventType, string> = {
  q1: "Q1",
  q2: "Q2",
  sprint: "Sprint",
  race: "Carrera",
};

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: Date | string): string {
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface GpActionsProps {
  gp: GpView;
  onChanged: () => void;
}

/**
 * Acciones de un GP (US-05, flujo 18): cambio de estado (tabla pura
 * `gp-status.ts`: solo se ofrecen las transiciones válidas), fijar/borrar
 * `lockoutAt` y añadir un evento que falta (Q1/sprint opcionales).
 * Todo auditado server-side (T-09).
 */
export default function GpActions({ gp, onChanged }: GpActionsProps) {
  const updateStatus = trpc.seasons.gps.updateStatus.useMutation({
    onSuccess: () => {
      setStatus("");
      onChanged();
    },
  });
  const updateLockout = trpc.seasons.gps.updateLockout.useMutation({
    onSuccess: () => {
      setLockoutAt("");
      onChanged();
    },
  });
  const addEvent = trpc.seasons.gps.addEvent.useMutation({
    onSuccess: () => {
      setEventType("");
      setEventTime("");
      onChanged();
    },
  });

  const [status, setStatus] = useState("");
  const [lockoutAt, setLockoutAt] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventTime, setEventTime] = useState("");

  const allowed = allowedGpStatusTransitions(gp.status);
  const missingEvents = EVENT_TYPES.filter(
    (type) => !gp.events.some((event) => event.type === type),
  );

  const statusError =
    updateStatus.isError && zodIssues(updateStatus.error).length === 0
      ? updateStatus.error.message
      : null;
  const lockoutError =
    updateLockout.isError && zodIssues(updateLockout.error).length === 0
      ? updateLockout.error.message
      : null;
  const addEventError =
    addEvent.isError && zodIssues(addEvent.error).length === 0
      ? addEvent.error.message
      : null;

  function onStatusSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status) return;
    updateStatus.mutate({ gpId: gp.id, status: status as GpStatus });
  }

  function onAddEventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventType) return;
    addEvent.mutate({
      gpId: gp.id,
      type: eventType as EventType,
      startTime: eventTime ? new Date(eventTime) : null,
    });
  }

  return (
    <div>
      <strong>
        R{gp.round} · {gp.name}
      </strong>{" "}
      — {gp.circuit.name} ({gp.circuit.country})
      {gp.circuit.location ? `, ${gp.circuit.location}` : ""} ·{" "}
      {formatDate(gp.date)} · estado: {GP_STATUS_LABELS[gp.status]}
      {gp.lockoutAt ? ` · lockout: ${formatDateTime(gp.lockoutAt)}` : ""}
      <ul>
        {gp.events.map((event) => (
          <li key={event.id}>
            {EVENT_LABELS[event.type]}
            {event.startTime ? ` (${formatDateTime(event.startTime)})` : ""}
          </li>
        ))}
      </ul>

      {statusError && <Alert variant="error">{statusError}</Alert>}
      {lockoutError && <Alert variant="error">{lockoutError}</Alert>}
      {addEventError && <Alert variant="error">{addEventError}</Alert>}

      <div className="field">
        <label htmlFor={`status-${gp.id}`}>Cambiar estado</label>
        {allowed.length === 0 ? (
          <p className="muted">Estado terminal (no admite cambios).</p>
        ) : (
          <form onSubmit={onStatusSubmit} style={{ display: "inline" }}>
            <select
              id={`status-${gp.id}`}
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">— Transición —</option>
              {allowed.map((target) => (
                <option key={target} value={target}>
                  {GP_STATUS_LABELS[target]}
                </option>
              ))}
            </select>{" "}
            <Button type="submit" disabled={!status || updateStatus.isPending}>
              {updateStatus.isPending ? "Cambiando…" : "Cambiar"}
            </Button>
          </form>
        )}
      </div>

      <div className="field">
        <label htmlFor={`lockout-${gp.id}`}>Lockout</label>
        <input
          id={`lockout-${gp.id}`}
          type="datetime-local"
          value={lockoutAt}
          onChange={(event) => setLockoutAt(event.target.value)}
        />{" "}
        <Button
          type="button"
          disabled={!lockoutAt || updateLockout.isPending}
          onClick={() =>
            updateLockout.mutate({
              gpId: gp.id,
              lockoutAt: new Date(lockoutAt),
            })
          }
        >
          Fijar
        </Button>{" "}
        {gp.lockoutAt && (
          <Button
            type="button"
            disabled={updateLockout.isPending}
            onClick={() => updateLockout.mutate({ gpId: gp.id, lockoutAt: null })}
          >
            Borrar
          </Button>
        )}
      </div>

      {missingEvents.length > 0 && (
        <div className="field">
          <label htmlFor={`event-${gp.id}`}>Añadir evento que falta</label>
          <form onSubmit={onAddEventSubmit} style={{ display: "inline" }}>
            <select
              id={`event-${gp.id}`}
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
            >
              <option value="">— Evento —</option>
              {missingEvents.map((type) => (
                <option key={type} value={type}>
                  {EVENT_LABELS[type]}
                </option>
              ))}
            </select>{" "}
            <input
              type="datetime-local"
              aria-label="Hora de inicio del evento"
              value={eventTime}
              onChange={(event) => setEventTime(event.target.value)}
            />{" "}
            <Button type="submit" disabled={!eventType || addEvent.isPending}>
              {addEvent.isPending ? "Añadiendo…" : "Añadir"}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
