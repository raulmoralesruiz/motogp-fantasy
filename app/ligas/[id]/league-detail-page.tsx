"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";

/**
 * Detalle de una liga (US-24, leagues.md §8/§9; US-25, leagues.md §6;
 * US-26, leagues.md §5; pantalla 10 de user-flows): info de la liga,
 * miembros (seudónimos, admin marcado), ranking general, panel de
 * administración si el actor es admin, y botón de unión a la liga
 * **pública** (entrada abierta, ADR-0024/ADR-0025) si el actor está
 * autenticado y no es miembro.
 *
 * **Panel de administración (US-26, leagues.md §5):** solo el admin gestiona
 * la liga — código de invitación (ver/rotar), habilitar que los miembros
 * vean el código, cambiar configuración (nombre/descripción/visibilidad),
 * transferir el rol, expulsar miembros y cerrar la liga. Un miembro solo
 * juega (ver ranking/miembros, colocar/cambiar lineup); el servidor revalida
 * cada acción (AGENTS.md §8) y devuelve 403 a un miembro.
 *
 * Visibilidad (ADR-0024): pública ⇒ cualquiera la ve; privada ⇒ solo miembros
 * activos (un extraño recibe NOT_FOUND → "La liga no existe."). El código lo
 * ve el admin siempre y el miembro solo si el admin lo habilita (US-26).
 *
 * El ranking es la última versión publicada (US-21/ADR-0022); se lee, no se
 * recalcula en la vista. Vacío elegante si aún no hay filas.
 */

/** Etiqueta legible del modo de entrada (leagues.md §3). */
function entryModeLabel(mode: "code" | "invite" | "mixed"): string {
  if (mode === "code") return "por código";
  if (mode === "invite") return "solo invitación";
  return "código o invitación";
}

export default function LeagueDetailPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params.id;
  const queryClient = useQueryClient();
  const router = useRouter();

  const league = trpc.leagues.get.useQuery({ leagueId });
  const ranking = trpc.leagues.ranking.useQuery({ leagueId });
  const me = trpc.auth.me.useQuery();

  const [rotated, setRotated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Formulario de configuración (US-26): se inicializa cuando carga la liga.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("");
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    if (league.data && !configReady) {
      setName(league.data.name);
      setDescription(league.data.description ?? "");
      setVisibility(league.data.visibility);
      setConfigReady(true);
    }
  }, [league.data, configReady]);

  /** Refresca la vista de la liga tras una acción de gestión. */
  function invalidateLeague() {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.leagues.get) });
  }

  function clearFeedback() {
    setError(null);
    setSuccess(null);
    setRotated(null);
  }

  const rotate = trpc.leagues.rotateCode.useMutation({
    onSuccess: (newCode) => {
      clearFeedback();
      setRotated(newCode);
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setRotated(null);
      setError(err instanceof Error ? err.message : "No se pudo rotar el código.");
    },
  });

  const update = trpc.leagues.update.useMutation({
    onSuccess: () => {
      clearFeedback();
      setSuccess("Configuración guardada.");
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    },
  });

  const transferAdmin = trpc.leagues.transferAdmin.useMutation({
    onSuccess: () => {
      clearFeedback();
      setSuccess("Rol de admin transferido.");
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "No se pudo transferir el rol.");
    },
  });

  const kick = trpc.leagues.kick.useMutation({
    onSuccess: () => {
      clearFeedback();
      setSuccess("Miembro expulsado.");
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "No se pudo expulsar al miembro.");
    },
  });

  const close = trpc.leagues.close.useMutation({
    onSuccess: () => {
      clearFeedback();
      setSuccess("Liga cerrada.");
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "No se pudo cerrar la liga.");
    },
  });

  const setMemberInvites = trpc.leagues.setMemberInvites.useMutation({
    onSuccess: () => {
      clearFeedback();
      setSuccess("Ajuste de invitaciones guardado.");
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "No se pudo guardar el ajuste.");
    },
  });

  // Unión a la liga pública (US-25, entrada abierta ADR-0024): solo si el
  // actor está autenticado y no es miembro. El servidor revalida todo.
  const join = trpc.leagues.join.useMutation({
    onSuccess: () => {
      setError(null);
      invalidateLeague();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo unirse a la liga.");
    },
  });

  // Salida de la liga (US-27, ADR-0027): solo un miembro activo no admin.
  // Tras salir de una **privada** ya no es visible (NOT_FOUND) → volver al
  // directorio; tras salir de una **pública** la vista se refresca (ya no
  // es miembro, el botón de unión reaparece).
  const leave = trpc.leagues.leave.useMutation({
    onSuccess: (view) => {
      clearFeedback();
      if (view.type === "private") {
        router.push("/ligas");
        return;
      }
      setSuccess("Has salido de la liga. El histórico de puntos se conserva.");
      invalidateLeague();
    },
    onError: (err) => {
      setSuccess(null);
      setError(err instanceof Error ? err.message : "No se pudo salir de la liga.");
    },
  });

  if (league.isPending) {
    return <p className="muted">Consultando…</p>;
  }

  if (league.isError) {
    // NOT_FOUND (liga inexistente o privada a un extraño): mismo mensaje, no
    // se revela la existencia (leagues.md §9, US-24 CA).
    return (
      <Alert variant="error">
        {league.error instanceof Error && league.error.message
          ? league.error.message
          : "La liga no existe."}{" "}
        <Link href="/ligas">Volver al directorio</Link>
      </Alert>
    );
  }

  const l = league.data;
  const meId = me.data?.id;

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}
      {rotated && (
        <Alert variant="success">
          Código rotado. El código anterior quedó revocado. Nuevo código:{" "}
          <strong>{rotated}</strong>
        </Alert>
      )}

      <h2>{l.name}</h2>
      {l.description && <p>{l.description}</p>}
      <p className="muted">
        {l.type === "private" ? "Privada" : "Pública"} ·{" "}
        {l.activeMembers}/{l.maxMembers} miembros · entrada {entryModeLabel(l.entryMode)}
        {l.startDate && <> · inicio {l.startDate.toISOString().slice(0, 10)}</>}
        {l.endDate && <> · fin {l.endDate.toISOString().slice(0, 10)}</>}
      </p>

      <h3>
        Miembros ({l.activeMembers}
        {l.activeMembers === 1 ? "" : "s"})
      </h3>
      {l.members.length === 0 ? (
        <p className="muted">Todavía no hay miembros.</p>
      ) : (
        <ul>
          {l.members.map((m) => {
            const isSelf = meId !== undefined && m.userId === meId;
            return (
              <li key={m.userId}>
                {m.username}
                {m.role === "admin" && <span className="muted"> · admin</span>}
                {l.isAdmin && !isSelf && (
                  <span>
                    {m.role !== "admin" && (
                      <Button
                        type="button"
                        onClick={() =>
                          transferAdmin.mutate({
                            leagueId: l.id,
                            targetUserId: m.userId,
                          })
                        }
                        disabled={transferAdmin.isPending}
                      >
                        Hacer admin
                      </Button>
                    )}
                    <Button
                      type="button"
                      onClick={() =>
                        kick.mutate({ leagueId: l.id, targetUserId: m.userId })
                      }
                      disabled={kick.isPending}
                    >
                      Expulsar
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {l.formerMembers.length > 0 && (
        <>
          <h3>
            Miembros que salieron ({l.formerMembers.length}
            {l.formerMembers.length === 1 ? "" : "s"})
          </h3>
          <ul>
            {l.formerMembers.map((m) => (
              <li key={m.userId}>
                {m.username}{" "}
                <span className="muted">
                  · {m.status === "kicked" ? "expulsado" : "retirado"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {l.isMember && !l.isAdmin && (
        <div>
          <h3>Salir de la liga</h3>
          <p className="muted">
            Al salir dejas de participar en esta liga. Tu histórico de puntos
            se conserva; puedes volver a unirte si la liga sigue abierta.
          </p>
          <Button
            type="button"
            onClick={() => {
              const ok = window.confirm(
                "¿Seguro que quieres salir de esta liga? Tu histórico de puntos se conserva.",
              );
              if (!ok) return;
              leave.mutate({ leagueId: l.id });
            }}
            disabled={leave.isPending}
          >
            {leave.isPending ? "Saliendo…" : "Salir de la liga"}
          </Button>
        </div>
      )}

      {l.isAdmin && (
        <div>
          <h3>Salir de la liga</h3>
          <p className="muted">
            Eres el admin de la liga: para salir, transfiere primero el rol a
            otro miembro.
          </p>
        </div>
      )}

      {l.type === "public" && !l.isMember && (
        <div>
          <h3>Unirse</h3>
          {me.isPending ? (
            <p className="muted">Consultando…</p>
          ) : me.isError ? (
            <Alert variant="info">
              Para unirte a la liga necesitas una cuenta.{" "}
              <Link href="/login">Inicia sesión</Link> o{" "}
              <Link href="/registro">crea una cuenta</Link>.
            </Alert>
          ) : (
            <Button
              type="button"
              onClick={() => join.mutate({ leagueId: l.id })}
              disabled={join.isPending}
            >
              {join.isPending ? "Uniéndose…" : "Unirme a la liga"}
            </Button>
          )}
        </div>
      )}

      <h3>Ranking general</h3>
      {ranking.isPending && <p className="muted">Consultando…</p>}
      {ranking.isError && (
        <Alert variant="error">No se pudo cargar el ranking.</Alert>
      )}
      {ranking.data && ranking.data.entries.length === 0 && (
        <p className="muted">
          Aún no hay ranking publicado (se calcula al publicarse resultados
          definitivos).
        </p>
      )}
      {ranking.data && ranking.data.entries.length > 0 && (
        <ol>
          {ranking.data.entries.map((e) => (
            <li key={e.position}>
              {e.username} <span className="muted">— {e.points} pts</span>
            </li>
          ))}
        </ol>
      )}

      {l.isAdmin && (
        <div>
          <h3>Administración</h3>

          <h4>Código de invitación</h4>
          {l.code ? (
            <Alert variant="info">
              Código de invitación: <strong>{l.code}</strong>{" "}
              <Button
                type="button"
                onClick={() => rotate.mutate({ leagueId: l.id })}
                disabled={rotate.isPending}
              >
                {rotate.isPending ? "Rotando…" : "Rotar código"}
              </Button>
            </Alert>
          ) : (
            <Alert variant="info">
              Esta liga no usa código de invitación (modo «solo invitación»).
            </Alert>
          )}
          <div className="field">
            <label>
              <input
                type="checkbox"
                checked={l.allowMemberInvites}
                onChange={(e) =>
                  setMemberInvites.mutate({
                    leagueId: l.id,
                    enabled: e.target.checked,
                  })
                }
                disabled={setMemberInvites.isPending}
              />{" "}
              Permitir que los miembros vean y compartan el código de invitación
            </label>
          </div>

          <h4>Configuración</h4>
          <div>
            <Field
              label="Nombre"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="Descripción"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="field">
              <label htmlFor="visibility">Visibilidad</label>
              <select
                id="visibility"
                name="visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="public">Pública</option>
                <option value="unlisted">No listada</option>
                <option value="private">Privada</option>
              </select>
            </div>
            <Button
              type="button"
              onClick={() =>
                update.mutate({
                  leagueId: l.id,
                  name,
                  description,
                  visibility: visibility as "public" | "unlisted" | "private",
                })
              }
              disabled={update.isPending}
            >
              {update.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>

          <h4>Cerrar liga</h4>
          <p className="muted">
            Al cerrar la liga pasa a «finalizada» y deja de aceptar cambios.
            El histórico de puntos se conserva.
          </p>
          <Button
            type="button"
            onClick={() => close.mutate({ leagueId: l.id })}
            disabled={close.isPending}
          >
            {close.isPending ? "Cerrando…" : "Cerrar la liga"}
          </Button>
        </div>
      )}
    </div>
  );
}
