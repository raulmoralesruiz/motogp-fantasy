"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/shared/components";
import { trpc } from "@/trpc/client";

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const health = trpc.health.check.useQuery();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Al cerrar sesión se limpia el caché cliente de `me` (staleTime de
      // TanStack) para que la UI no siga mostrando la sesión anterior.
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
      router.refresh();
    },
  });

  return (
    <main>
      <h1>
        Fantasy MotoGP <span>Independiente</span>
      </h1>
      <p className="muted">
        Fantasy de MotoGP propio y multi-liga, con una economía diseñada para ser justa y
        transparente: base fija + carry limitado, sin ratchet.
      </p>
      <h2>Estado del sistema</h2>
      {health.isPending ? (
        <p className="muted">Consultando…</p>
      ) : health.isError ? (
        <p className="bad">No se pudo consultar el estado: {health.error.message}</p>
      ) : (
        <ul className="status">
          <li>
            Aplicación: <strong>{health.data.app.name}</strong> v{health.data.app.version}{" "}
            —{" "}
            <span className={health.data.status === "ok" ? "ok" : "bad"}>
              {health.data.status === "ok" ? "operativa" : "degradada"}
            </span>
          </li>
          <li>
            Base de datos:{" "}
            <span className={health.data.database.ok ? "ok" : "bad"}>
              {health.data.database.ok ? "conectada" : "sin conexión"}
            </span>
          </li>
          <li>
            Redis:{" "}
            <span className={health.data.redis.ok ? "ok" : "bad"}>
              {health.data.redis.ok ? "conectado" : "sin conexión"}
            </span>
          </li>
        </ul>
      )}
      <h2>Sesión</h2>
      {me.isPending ? (
        <p className="muted">Consultando…</p>
      ) : me.isError ? (
        <p className="muted">
          No has iniciado sesión. <Link href="/login">Inicia sesión</Link> o{" "}
          <Link href="/registro">crea una cuenta</Link>.
        </p>
      ) : (
        <div>
          <p>
            Sesión activa: <strong>{me.data.username}</strong> ({me.data.email})
            {me.data.roles.length > 0 && (
              <span className="muted"> — roles: {me.data.roles.join(", ")}</span>
            )}
          </p>
          {me.data.roles.includes("global_admin") && (
            <p>
              <Link href="/admin">Panel de administración</Link>
            </p>
          )}
          <Button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Cerrando sesión…" : "Cerrar sesión"}
          </Button>
        </div>
      )}
    </main>
  );
}
