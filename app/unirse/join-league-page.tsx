"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";

/**
 * Unirse a una liga por código de invitación (US-25, leagues.md §4/§6,
 * ADR-0025): el código resuelve la liga (el extraño no conoce el `leagueId`
 * de una privada — US-24 —, así que esta página es su puerta de entrada).
 *
 * El servidor valida todo (AGENTS.md §8): código activo, estado de la liga,
 * modo de entrada, membresía previa, plaza, y el anti-fuerza-bruta
 * (ventana + bloqueo por IP). La UI solo muestra el motivo en español.
 *
 * Unirse exige sesión (protectedProcedure): sin ella, enlace a /login.
 */
export default function JoinLeaguePage() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const join = trpc.leagues.join.useMutation({
    onSuccess: (league) => {
      setError(null);
      setCode("");
      router.push(`/ligas/${league.id}`);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo unirse a la liga.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed === "" || join.isPending) return;
    join.mutate({ code: trimmed });
  }

  if (me.isPending) {
    return <p className="muted">Consultando…</p>;
  }

  if (me.isError) {
    // Sin sesión: unirse exige cuenta (protectedProcedure).
    return (
      <Alert variant="info">
        Para unirte a una liga necesitas una cuenta.{" "}
        <Link href="/login">Inicia sesión</Link> o{" "}
        <Link href="/registro">crea una cuenta</Link>.
      </Alert>
    );
  }

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}

      <p className="muted">
        ¿Tienes un código de invitación? Introdúcelo para unirte a la liga.{" "}
        <Link href="/ligas">Volver a ligas</Link>
      </p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Código de invitación"
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABC123XYZ9"
          maxLength={64}
          autoComplete="off"
        />
        <Button type="submit" disabled={code.trim() === "" || join.isPending}>
          {join.isPending ? "Uniéndose…" : "Unirme"}
        </Button>
      </form>
    </div>
  );
}
