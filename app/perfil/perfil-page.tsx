"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Alert, Button, Field, RowAction } from "@/shared/components";
import { trpc } from "@/trpc/client";
import { zodIssues } from "@/trpc/errors";

import { TotpSection } from "./totp-section";

/**
 * F3 P2: `profile.me` falla con UNAUTHORIZED cuando no hay sesión (estado
 * normal), pero también puede fallar por un error real (500, red). Solo el
 * UNAUTHORIZED significa "sin sesión"; el resto es un fallo que hay que
 * mostrar, no enmascarar como "no has iniciado sesión" (mismo criterio que
 * la home, F3 P3-1).
 */
function isUnauthorized(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === "UNAUTHORIZED";
}

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
  const settings = trpc.notifications.settings.useQuery();
  const [exportMessage, setExportMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = trpc.profile.update.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.profile.me) });
    },
  });

  const updateSettings = trpc.notifications.updateSettings.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getQueryKey(trpc.notifications.settings),
      });
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
    return <p className="pending">Consultando…</p>;
  }
  if (me.isError || !me.data) {
    if (isUnauthorized(me.error)) {
      return (
        <p className="muted">
          No has iniciado sesión. <a href="/login">Inicia sesión</a>
        </p>
      );
    }
    // F3 P2: fallo real (500, red): el usuario puede estar logueado — se
    // muestra el error y se ofrece reintentar, no el camino de login.
    return (
      <>
        <Alert variant="error">
          No se pudieron cargar tus datos:{" "}
          {me.error instanceof Error ? me.error.message : "Error desconocido."}
        </Alert>
        <Button type="button" onClick={() => me.refetch()}>
          Reintentar
        </Button>
      </>
    );
  }
  // Captura tras la guarda: el narrowing de `me.data` no atraviesa closures.
  const meData = me.data;

  function onUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    update.mutate({ displayName: String(data.get("displayName") ?? "") });
  }

  function onSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    updateSettings.mutate({
      emailEnabled: data.get("emailEnabled") === "on",
    });
  }

  async function onExport() {
    setExportMessage(null);
    try {
      const result = await exportQuery.refetch();
      downloadJson(result.data, `fantasy-motogp-datos-${meData.username}.json`);
      setExportMessage({
        kind: "success",
        text: "Datos exportados. Revisa la carpeta de descargas.",
      });
    } catch (error) {
      setExportMessage({
        kind: "error",
        text:
          error instanceof Error
            ? `No se pudo exportar: ${error.message}`
            : "No se pudo exportar.",
      });
    }
  }

  function onDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Puerta doble: el botón (`aria-disabled` + guarda de `RowAction`) y
    // esta — el submit del formulario (p. ej. por Enter en la contraseña)
    // no lo frena el estado del botón, así que el handler revalida la
    // confirmación antes de enviar.
    if (!confirmDelete) return;
    const data = new FormData(event.currentTarget);
    deleteAccount.mutate({ password: String(data.get("password") ?? "") });
  }

  const updateIssues = update.isError ? zodIssues(update.error) : [];
  const updateFieldError = (name: string) =>
    updateIssues.find((issue) => issue.path?.[0] === name)?.message;
  const updateGeneralError =
    update.isError && updateIssues.length === 0 ? update.error.message : null;

  const settingsGeneralError = updateSettings.isError
    ? updateSettings.error.message
    : null;

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

      <h2>Notificaciones</h2>
      <p className="muted">
        Recibe un email cuando se publiquen los resultados definitivos de un GP o
        se aplique un recálculo.
      </p>
      {settings.isPending ? (
        <p className="pending">Consultando…</p>
      ) : settings.isError ? (
        // F3 P2: si no se pueden cargar los ajustes, NO se muestra el
        // formulario con un valor por defecto adivinado (el usuario podría
        // guardar y volcar su preferencia real): se anuncia el fallo y se
        // ofrece reintentar.
        <>
          <Alert variant="error">
            No se pudieron cargar tus ajustes de notificación:{" "}
            {settings.error.message}
          </Alert>
          <Button type="button" onClick={() => settings.refetch()}>
            Reintentar
          </Button>
        </>
      ) : (
        <form className="form" onSubmit={onSettings} noValidate>
          <label className="check">
            <input
              type="checkbox"
              name="emailEnabled"
              defaultChecked={settings.data?.emailEnabled ?? true}
            />
            Recibir notificaciones por email
          </label>
          {settingsGeneralError && (
            <Alert variant="error">{settingsGeneralError}</Alert>
          )}
          {updateSettings.isSuccess && (
            <Alert variant="success">Ajustes de notificación guardados.</Alert>
          )}
          <Button type="submit" disabled={updateSettings.isPending}>
            {updateSettings.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      )}

      <h2>Seguridad (autenticación en dos pasos)</h2>
      <TotpSection enabled={meData.totpEnabled} enrolled={meData.totpEnrolled} />

      <h2>Privacidad (RGPD)</h2>
      <p className="muted">
        Puedes descargar todos tus datos en un archivo JSON (derecho de acceso) o
        eliminar tu cuenta (derecho de supresión).
      </p>
      <Button type="button" onClick={onExport} disabled={exportQuery.isFetching}>
        {exportQuery.isFetching ? "Preparando exportación…" : "Exportar mis datos (JSON)"}
      </Button>
      {exportMessage && (
        <Alert variant={exportMessage.kind === "success" ? "success" : "error"}>
          {exportMessage.text}
        </Alert>
      )}

      <h2>Eliminar mi cuenta</h2>
      <Alert variant="warning">
        Al eliminar tu cuenta se anonimizan tus datos personales, quedas deslogueado y
        sales de todas las ligas. Tu histórico de juego se conserva sin identidad para
        mantener los rankings. Esta acción es irreversible.
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
        <label className="check">
          <input
            type="checkbox"
            checked={confirmDelete}
            onChange={(e) => setConfirmDelete(e.target.checked)}
          />
          Entiendo que esta acción es irreversible y que mi email quedará libre para
          re-registrarse como cuenta nueva.
        </label>
        {deleteGeneralError && <Alert variant="error">{deleteGeneralError}</Alert>}
        {/* F3 P1: la única acción irreversible usa el tratamiento destructivo
            (filete rojo, `RowAction`) — distinto del relleno rojo de las
            acciones rutinarias (Guardar/Exportar). F3 P3: con motivo de
            bloqueo (`aria-disabled` + explicación, convención del sistema de
            diseño); `RowAction` intercepta el clic mientras no se confirma.
            Transitorio (`isPending`) → `disabled` nativo, sin motivo. */}
        <RowAction
          type="submit"
          disabled={deleteAccount.isPending || !confirmDelete}
          disabledReason={
            deleteAccount.isPending
              ? undefined
              : "Marca la casilla para habilitar la eliminación"
          }
        >
          {deleteAccount.isPending ? "Eliminando cuenta…" : "Eliminar mi cuenta"}
        </RowAction>
      </form>
    </div>
  );
}
