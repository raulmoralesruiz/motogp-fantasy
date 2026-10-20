"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

/** Descarga un objeto como archivo JSON en el navegador (US-03). */
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PerfilPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = trpc.profile.me.useQuery();
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = trpc.profile.update.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.profile.me) });
    },
  });

  const exportQuery = trpc.profile.export.useQuery(undefined, { enabled: false });

  const deleteAccount = trpc.profile.delete.useMutation({
    onSuccess: () => {
      // La sesión quedó revocada en el servidor: limpiar el caché de la
      // sesión y volver a la home (patrón del logout de la home).
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.profile.me) });
      router.refresh();
      router.push("/");
    },
  });

  if (me.isPending) {
    return <p className="muted">Consultando…</p>;
  }
  if (me.isError || !me.data) {
    return (
      <p className="muted">
        No has iniciado sesión. <a href="/login">Inicia sesión</a>
      </p>
    );
  }
  // Captura tras la guarda: el narrowing de `me.data` no atraviesa closures.
  const meData = me.data;

  function onUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update.mutate({ displayName: String(data.get("displayName") ?? "") });
  }

  async function onExport() {
    setExportMessage(null);
    try {
      const result = await exportQuery.refetch();
      downloadJson(result.data, `fantasy-motogp-datos-${meData.username}.json`);
      setExportMessage("Datos exportados. Revisa la carpeta de descargas.");
    } catch (error) {
      setExportMessage(
        error instanceof Error ? `No se pudo exportar: ${error.message}` : "No se pudo exportar.",
      );
    }
  }

  function onDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    deleteAccount.mutate({ password: String(data.get("password") ?? "") });
  }

  const updateIssues = update.isError ? zodIssues(update.error) : [];
  const updateFieldError = (name: string) =>
    updateIssues.find((issue) => issue.path?.[0] === name)?.message;
  const updateGeneralError =
    update.isError && updateIssues.length === 0 ? update.error.message : null;

  const deleteIssues = deleteAccount.isError ? zodIssues(deleteAccount.error) : [];
  const deleteFieldError = (name: string) =>
    deleteIssues.find((issue) => issue.path?.[0] === name)?.message;
  const deleteGeneralError =
    deleteAccount.isError && deleteIssues.length === 0
      ? deleteAccount.error.message
      : null;

  return (
    <div>
      <h2>Mis datos</h2>
      <ul className="status">
        <li>
          Email: <strong>{me.data.email}</strong>
        </li>
        <li>
          Nombre de usuario: <strong>{me.data.username}</strong>
        </li>
        <li>
          Nombre visible: <strong>{me.data.displayName ?? "—"}</strong>
        </li>
        <li>
          Miembro desde: <strong>{me.data.createdAt.toLocaleDateString("es-ES")}</strong>
        </li>
      </ul>

      <h2>Nombre visible</h2>
      <form className="form" onSubmit={onUpdate} noValidate>
        <Field
          label="Nombre visible"
          name="displayName"
          defaultValue={me.data.displayName ?? me.data.username}
          minLength={3}
          maxLength={40}
          required
          error={updateFieldError("displayName")}
        />
        {updateGeneralError && <Alert variant="error">{updateGeneralError}</Alert>}
        {update.isSuccess && <Alert variant="success">Nombre visible actualizado.</Alert>}
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? "Guardando…" : "Guardar"}
        </Button>
      </form>

      <h2>Privacidad (RGPD)</h2>
      <p className="muted">
        Puedes descargar todos tus datos en un archivo JSON (derecho de acceso) o
        eliminar tu cuenta (derecho de supresión).
      </p>
      <Button type="button" onClick={onExport} disabled={exportQuery.isFetching}>
        {exportQuery.isFetching ? "Preparando exportación…" : "Exportar mis datos (JSON)"}
      </Button>
      {exportMessage && <p className="muted">{exportMessage}</p>}

      <h2>Eliminar mi cuenta</h2>
      <Alert variant="error">
        Al eliminar tu cuenta se anonimizan tus datos personales, quedas deslogueado y
        sales de todas las ligas. Tu histórico de juego se conserva sin identidad para
        mantener los rankings (ADR-0016). Esta acción es irreversible.
      </Alert>
      <form className="form" onSubmit={onDelete} noValidate>
        <Field
          label="Contraseña (confirmación)"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={deleteFieldError("password")}
        />
        <label className="muted">
          <input
            type="checkbox"
            checked={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.checked)}
          />{" "}
          Entiendo que esta acción es irreversible y que mi email quedará libre para
          re-registrarse como cuenta nueva.
        </label>
        {deleteGeneralError && <Alert variant="error">{deleteGeneralError}</Alert>}
        <Button
          type="submit"
          disabled={deleteAccount.isPending || !confirmDelete}
        >
          {deleteAccount.isPending ? "Eliminando cuenta…" : "Eliminar mi cuenta"}
        </Button>
      </form>
    </div>
  );
}
