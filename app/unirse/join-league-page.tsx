"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { isUnauthorized } from "@/trpc/errors";

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
 *
 * F4 (impeccable, 2026-11-08):
 * - P1: el momento de éxito se marca antes de redirigir (peak-end: el
 *   usuario invitado ve "Te has unido a «…» — entrando…", no un salto en
 *   blanco).
 * - P2: CTA bloqueado con motivo escrito; el error del servidor vive junto
 *   a la acción (dentro del formulario); la rama sin sesión jerarquiza
 *   (CTA de login con `next`, "Crear cuenta" secundaria, salida al
 *   directorio).
 * - P3: el enlace sin sesión conserva el destino (`/login?next=/unirse`);
 *   un fallo real de `auth.me` no se lee como "sin cuenta"; el error
 *   anterior se limpia al nuevo intento; la intro ofrece la rama "no
 *   tienes código".
 */
export default function JoinLeaguePage() {
  const router = useRouter();
  const me = trpc.auth.me.useQuery();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const redirectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // La redirección de éxito es diferida (~1 s); si el usuario sale antes,
  // no se dispara un push "fantasma" sobre otra página.
  useEffect(
    () => () => {
      if (redirectRef.current !== null) clearTimeout(redirectRef.current);
    },
    [],
  );

  const join = trpc.leagues.join.useMutation({
    onSuccess: (league) => {
      setError(null);
      setCode("");
      setSuccess(league.name);
      redirectRef.current = setTimeout(
        () => router.push(`/ligas/${league.id}`),
        1000,
      );
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "No se pudo unirse a la liga.");
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed === "" || join.isPending) return;
    // P3: el residuo del intento anterior no debe seguir visible durante el
    // nuevo envío.
    setError(null);
    join.mutate({ code: trimmed });
  }

  if (me.isPending) {
    return <p className="muted">Consultando…</p>;
  }

  if (me.isError && isUnauthorized(me.error)) {
    // Sin sesión: unirse exige cuenta (protectedProcedure). P2: la acción
    // principal es un CTA con target ≥44 px que conserva la puerta tras el
    // login (`next=/unirse`); "Crear cuenta" es secundaria (Regla de la
    // Señal: un solo relleno rojo por región).
    return (
      <div>
        <Alert variant="info">
          Para unirte a una liga necesitas una cuenta.
        </Alert>
        <div className="form">
          <Link className="button" href="/login?next=/unirse">
            Iniciar sesión
          </Link>
          <Link className="button-secondary" href="/registro">
            Crear cuenta
          </Link>
          <p className="muted">
            ¿No tienes código? <Link href="/ligas">Ver las ligas</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (me.isError) {
    // P3: un fallo real de `auth.me` (500/red) no debe leerse como "sin
    // cuenta" (mismo patrón que el detalle de liga, F3 P3).
    return (
      <Alert variant="error">
        No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.
      </Alert>
    );
  }

  if (success !== null) {
    // P1: el pico del viaje de adquisición se marca antes del redirect;
    // P3: una línea sobre lo que viene (sin romper Regla Plana ni Señal).
    return (
      <Alert variant="success">
        Te has unido a «{success}» — entrando… Verás el ranking, el
        presupuesto y los próximos GPs en el detalle de la liga.
      </Alert>
    );
  }

  return (
    <div>
      <p className="muted">
        Introduce el código de invitación que te han dado para unirte a la
        liga. ¿No tienes código? <Link href="/ligas">Ver las ligas</Link>.
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
        {error && <Alert variant="error">{error}</Alert>}
        <Button
          type="submit"
          disabled={code.trim() === "" || join.isPending}
          disabledReason={
            code.trim() === "" ? "Escribe el código de invitación." : undefined
          }
        >
          {join.isPending ? "Uniéndose…" : "Unirme"}
        </Button>
      </form>
    </div>
  );
}
