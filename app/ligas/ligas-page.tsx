"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";

/**
 * Ligas (US-23, leagues.md §3; US-24, leagues.md §2; US-25, leagues.md §6):
 * mis ligas, directorio de ligas públicas, enlace a la unión por código
 * (`/unirse`) y creación de una liga.
 *
 * El cliente solo envía los campos del formulario: validación, límites de
 * miembros, código de alta entropía y auditoría los hace el servidor
 * (AGENTS.md §8). El código se muestra solo al admin en el detalle
 * (leagues.md §5; US-24: sigue siendo secreto también en ligas públicas).
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

/** Etiqueta legible del modo de entrada (leagues.md §3). */
function entryModeLabel(mode: "code" | "invite" | "mixed"): string {
  if (mode === "code") return "por código";
  if (mode === "invite") return "solo invitación";
  return "código o invitación";
}

export default function LigasPage() {
  const queryClient = useQueryClient();
  const myLeagues = trpc.leagues.myLeagues.useQuery();
  const publicLeagues = trpc.leagues.listPublic.useQuery();

  const [form, setForm] = useState<LeagueForm>(EMPTY_FORM);
  /** Liga recién creada (para enlazar a su detalle). */
  const [created, setCreated] = useState<{ name: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.leagues.create.useMutation({
    onSuccess: (league) => {
      setCreated({ name: league.name, id: league.id });
      setError(null);
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.leagues.myLeagues),
      });
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.leagues.listPublic),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo crear la liga.");
      setCreated(null);
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

      {created && (
        <Alert variant="success">
          Liga «{created.name}» creada.{" "}
          <Link href={`/ligas/${created.id}`}>Ver detalle</Link>
        </Alert>
      )}

      <h2>Mis ligas</h2>
      {myLeagues.isPending && <p className="muted">Consultando…</p>}
      {myLeagues.isError && (
        <Alert variant="error">No se pudo cargar tu lista de ligas.</Alert>
      )}
      {myLeagues.data && myLeagues.data.length === 0 && (
        <p className="muted">
          Todavía no estás en ninguna liga. Crea una abajo o únete a una del
          directorio.
        </p>
      )}
      {myLeagues.data && myLeagues.data.length > 0 && (
        <ul>
          {myLeagues.data.map((league) => (
            <li key={league.id}>
              <Link href={`/ligas/${league.id}`}>
                <strong>{league.name}</strong>
              </Link>{" "}
              <span className="muted">
                ({league.type === "private" ? "privada" : "pública"} ·{" "}
                {league.activeMembers}
                {league.activeMembers === 1 ? " miembro" : " miembros"})
              </span>
              {league.isAdmin && <span className="muted"> · admin</span>}
            </li>
          ))}
        </ul>
      )}

      <h2>Directorio de ligas públicas</h2>
      <p className="muted">
        ¿Tienes un código de invitación? <Link href="/unirse">Únete a una liga</Link>.
      </p>
      {publicLeagues.isPending && <p className="muted">Consultando…</p>}
      {publicLeagues.isError && (
        <Alert variant="error">No se pudo cargar el directorio de ligas.</Alert>
      )}
      {publicLeagues.data && publicLeagues.data.length === 0 && (
        <p className="muted">
          Todavía no hay ligas públicas. Crea la primera abajo.
        </p>
      )}
      {publicLeagues.data && publicLeagues.data.length > 0 && (
        <ul>
          {publicLeagues.data.map((league) => (
            <li key={league.id}>
              <Link href={`/ligas/${league.id}`}>
                <strong>{league.name}</strong>
              </Link>
              {league.description && (
                <span className="muted"> — {league.description}</span>
              )}{" "}
              <span className="muted">
                ({league.activeMembers}/{league.maxMembers} miembros ·{" "}
                {entryModeLabel(league.entryMode)})
              </span>
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
            onChange={(e) => set("type", e.target.value as LeagueForm["type"])}
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
