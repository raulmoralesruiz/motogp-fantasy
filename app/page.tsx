"use client";

import Link from "next/link";

import { trpc } from "@/trpc/client";

export default function HomePage() {
  const health = trpc.health.check.useQuery();
  const me = trpc.auth.me.useQuery();

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
        <p>
          Sesión activa: <strong>{me.data.username}</strong> ({me.data.email})
          {me.data.roles.length > 0 && (
            <span className="muted"> — roles: {me.data.roles.join(", ")}</span>
          )}
        </p>
      )}
    </main>
  );
}
