"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Alert, Button } from "@/shared/components";
import { trpc } from "@/trpc/client";

/**
 * Detalle de una liga (US-24, leagues.md §8/§9; US-25, leagues.md §6;
 * pantalla 10 de user-flows): info de la liga, miembros (seudónimos, admin
 * marcado), ranking general, panel de admin (código + rotación) si el actor
 * es admin, y botón de unión a la liga **pública** (entrada abierta,
 * ADR-0024/ADR-0025) si el actor está autenticado y no es miembro.
 *
 * Visibilidad (ADR-0024): pública ⇒ cualquiera la ve; privada ⇒ solo miembros
 * activos (un extraño recibe NOT_FOUND → "La liga no existe."). El código solo
 * lo ve el admin (leagues.md §5; US-24: secreto también en ligas públicas).
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

  const league = trpc.leagues.get.useQuery({ leagueId });
  const ranking = trpc.leagues.ranking.useQuery({ leagueId });
  const me = trpc.auth.me.useQuery();

  const [rotated, setRotated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rotate = trpc.leagues.rotateCode.useMutation({
    onSuccess: (newCode) => {
      setRotated(newCode);
      setError(null);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.leagues.get),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo rotar el código.");
      setRotated(null);
    },
  });

  // Unión a la liga pública (US-25, entrada abierta ADR-0024): solo si el
  // actor está autenticado y no es miembro. El servidor revalida todo.
  const join = trpc.leagues.join.useMutation({
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.leagues.get),
      });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo unirse a la liga.");
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

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}
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
          {l.members.map((m, i) => (
            <li key={i}>
              {m.username}
              {m.role === "admin" && <span className="muted"> · admin</span>}
            </li>
          ))}
        </ul>
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
        </div>
      )}
    </div>
  );
}
