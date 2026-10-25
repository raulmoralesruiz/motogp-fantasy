"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";

/**
 * Ligas (US-23, leagues.md §3): crear una liga privada con código y ver
 * las ligas del usuario.
 *
 * El cliente solo envía los campos del formulario: validación, límites de
 * miembros, código de alta entropía y auditoría los hace el servidor
 * (AGENTS.md §8). El código se muestra solo al admin (leagues.md §5).
 */

/** Borrador del formulario de creación (US-23). */
interface LeagueForm {
  name: string;
  description: string;
  type: "private" | "public";
  visibility: "public" | "unlisted" | "private";
  minMembers: string;
  maxMembers: string;
  entryMode: "code" | "invite" | "mixed";
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: LeagueForm = {
  name: "",
  description: "",
  type: "private",
  visibility: "private",
  minMembers: "2",
  maxMembers: "50",
  entryMode: "code",
  startDate: "",
  endDate: "",
};

export default function LigasPage() {
  const queryClient = useQueryClient();
  const myLeagues = trpc.leagues.myLeagues.useQuery();

  const [form, setForm] = useState<LeagueForm>(EMPTY_FORM);
  /** Liga recién creada (para mostrar su código al creador/admin). */
  const [created, setCreated] = useState<{ name: string; code: string | null } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.leagues.create.useMutation({
    onSuccess: (league) => {
      setCreated({ name: league.name, code: league.code });
      setSuccess(`Liga «${league.name}» creada.`);
      setError(null);
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.leagues.myLeagues),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo crear la liga.");
      setSuccess(null);
    },
  });

  const rotate = trpc.leagues.rotateCode.useMutation({
    onSuccess: (newCode) => {
      setCreated(null);
      setSuccess(`Código rotado. El código anterior quedó revocado. Nuevo código: ${newCode}`);
      setError(null);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.leagues.myLeagues),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo rotar el código.");
      setSuccess(null);
    },
  });

  function set<K extends keyof LeagueForm>(key: K, value: LeagueForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate({
      name: form.name,
      description: form.description || null,
      type: form.type,
      visibility: form.visibility,
      minMembers: Number(form.minMembers),
      maxMembers: Number(form.maxMembers),
      entryMode: form.entryMode,
      startDate: form.startDate ? new Date(form.startDate) : undefined,
      endDate: form.endDate ? new Date(form.endDate) : undefined,
    });
  }

  const canSubmit =
    form.name.trim() !== "" &&
    Number(form.minMembers) >= 1 &&
    Number(form.maxMembers) >= Number(form.minMembers) &&
    !create.isPending;

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {created && (
        <div>
          <h2>Liga creada</h2>
          <p>
            <strong>{created.name}</strong>
          </p>
          {created.code ? (
            <Alert variant="info">
              Código de invitación: <strong>{created.code}</strong>
            </Alert>
          ) : (
            <Alert variant="info">
              Esta liga no usa código de invitación (modo «solo invitación»).
            </Alert>
          )}
        </div>
      )}

      <h2>Mis ligas</h2>
      {myLeagues.isPending && <p className="muted">Consultando…</p>}
      {myLeagues.isError && (
        <Alert variant="error">No se pudo cargar tu lista de ligas.</Alert>
      )}
      {myLeagues.data && myLeagues.data.length === 0 && (
        <p className="muted">Todavía no estás en ninguna liga. Crea una abajo.</p>
      )}
      {myLeagues.data && myLeagues.data.length > 0 && (
        <ul>
          {myLeagues.data.map((league) => (
            <li key={league.id}>
              <strong>{league.name}</strong>{" "}
              <span className="muted">
                ({league.type === "private" ? "privada" : "pública"} ·{" "}
                {league.activeMembers}
                {league.activeMembers === 1 ? " miembro" : " miembros"})
              </span>
              {league.isAdmin && (
                <span className="muted"> · admin</span>
              )}
              {league.code && (
                <>
                  {" "}
                  · código: <strong>{league.code}</strong>{" "}
                  <Button
                    type="button"
                    onClick={() => rotate.mutate({ leagueId: league.id })}
                    disabled={rotate.isPending}
                  >
                    {rotate.isPending ? "Rotando…" : "Rotar código"}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2>Crear una liga</h2>
      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Nombre"
          name="name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Liga de los amigos"
          maxLength={80}
        />
        <Field
          label="Descripción (opcional)"
          name="description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Solo para la familia, sin presión"
          maxLength={500}
        />
        <div className="field">
          <label htmlFor="type">Tipo</label>
          <select
            id="type"
            name="type"
            value={form.type}
            onChange={(e) =>
              set("type", e.target.value as LeagueForm["type"])
            }
          >
            <option value="private">Privada</option>
            <option value="public">Pública</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="visibility">Visibilidad</label>
          <select
            id="visibility"
            name="visibility"
            value={form.visibility}
            onChange={(e) =>
              set("visibility", e.target.value as LeagueForm["visibility"])
            }
          >
            <option value="private">Privada (oculta)</option>
            <option value="unlisted">Sin listar</option>
            <option value="public">Pública (directorio)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="minMembers">Miembros mínimos</label>
          <input
            id="minMembers"
            name="minMembers"
            type="number"
            min={1}
            max={100}
            value={form.minMembers}
            onChange={(e) => set("minMembers", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="maxMembers">Miembros máximos</label>
          <input
            id="maxMembers"
            name="maxMembers"
            type="number"
            min={1}
            max={100}
            value={form.maxMembers}
            onChange={(e) => set("maxMembers", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="entryMode">Modo de entrada</label>
          <select
            id="entryMode"
            name="entryMode"
            value={form.entryMode}
            onChange={(e) => set("entryMode", e.target.value as LeagueForm["entryMode"])}
          >
            <option value="code">Por código</option>
            <option value="invite">Solo invitación</option>
            <option value="mixed">Código o invitación</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="startDate">Inicio (opcional)</label>
          <input
            id="startDate"
            name="startDate"
            type="date"
            value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="endDate">Fin (opcional)</label>
          <input
            id="endDate"
            name="endDate"
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
          />
        </div>
        <Button type="submit" disabled={!canSubmit}>
          {create.isPending ? "Creando…" : "Crear liga"}
        </Button>
      </form>
    </div>
  );
}
