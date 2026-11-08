"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import type { LeagueStatus, LeagueType } from "@/modules/leagues";
import { formatNumber } from "@/shared/format";
import {
  Alert,
  Button,
  ConfirmDialog,
  Field,
  RowAction,
  type ConfirmRequest,
} from "@/shared/components";
import { trpc } from "@/trpc/client";
import { isUnauthorized } from "@/trpc/errors";

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
 * vean el código, cambiar configuración (nombre/descripción), transferir el
 * rol, expulsar miembros y cerrar la liga. Un miembro solo juega (ver
 * ranking/miembros, colocar/cambiar lineup); el servidor revalida cada acción
 * (AGENTS.md §8) y devuelve 403 a un miembro.
 *
 * **F3 (impeccable):** las acciones destructivas («Hacer admin», «Expulsar»,
 * «Cerrar liga», «Salir») piden confirmación con impacto escrito
 * (`ConfirmDialog` — patrón del sistema, sustituye a `window.confirm`); el
 * feedback de cada mutación vive junto a su control (no en un bloque
 * compartido arriba); la visibilidad se muestra de solo-lectura derivada del
 * tipo (el servidor la exige acoplada — un select libre era una trampa); el
 * estado de la liga se marca en la cabecera y condiciona la unión; las listas
 * usan `ul.status`, el formulario `form`+`.stack` y las fechas se formatean
 * en es-ES local.
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

/**
 * Etiqueta legible del estado de la liga (F3 P1: marcar la no activa — una
 * `finished`/`archived` no es idéntica a una activa). Tipada con la unión de
 * dominio `LeagueStatus`: un estado nuevo es error de compilación, no una
 * etiqueta «activa» silenciosa.
 */
function leagueStatusLabel(status: LeagueStatus): string {
  if (status === "finished") return "finalizada";
  if (status === "archived") return "archivada";
  if (status === "planned") return "planificada";
  return "activa";
}

/**
 * Visibilidad derivada del tipo (F3 P1: el servidor la exige acoplada —
 * `public` ⇒ `public`, `private` ⇒ no `public` — y `canViewLeague` solo mira
 * el tipo), así que no es un control: un select libre era una trampa que
 * enviaba al servidor un valor rechazado de forma garantizada.
 */
const VISIBILITY_BY_TYPE: Record<LeagueType, string> = {
  private: "Privada (oculta)",
  public: "Pública (directorio)",
};

/** Fecha local es-ES (F3 P3: no UTC — el usuario ve su zona horaria). */
function formatDate(value: Date): string {
  return value.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}


export default function LeagueDetailPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params.id;
  const queryClient = useQueryClient();
  const router = useRouter();

  const league = trpc.leagues.get.useQuery({ leagueId });
  const ranking = trpc.leagues.ranking.useQuery({ leagueId });
  const me = trpc.auth.me.useQuery();

  // Confirmación con impacto (patrón del sistema, F3 P0/P1) para las acciones
  // que reescriben datos o son irreversibles: «Hacer admin», «Expulsar»,
  // «Cerrar liga» y «Salir». Un solo diálogo a la vez (el último pedido gana).
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);

  // Feedback acotado por acción/sección (F3 P1): cada mutación muestra su
  // resultado junto a su control, no en un bloque compartido arriba. En móvil,
  // tras la acción el usuario está junto al control, no en la cabecera.
  const [rotated, setRotated] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersSuccess, setMembersSuccess] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeSuccess, setCloseSuccess] = useState<string | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [invitesSuccess, setInvitesSuccess] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaveSuccess, setLeaveSuccess] = useState<string | null>(null);

  // Formulario de configuración (US-26): se inicializa cuando carga la liga.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [adjustedRankingEnabled, setAdjustedRankingEnabled] = useState(false);
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    if (league.data && !configReady) {
      setName(league.data.name);
      setDescription(league.data.description ?? "");
      setAdjustedRankingEnabled(Boolean(league.data.adjustedRankingEnabled));
      setConfigReady(true);
    }
  }, [league.data, configReady]);

  /** Refresca la vista de la liga tras una acción de gestión. */
  function invalidateLeague() {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.leagues.get) });
  }

  const rotate = trpc.leagues.rotateCode.useMutation({
    onSuccess: (newCode) => {
      setRotateError(null);
      setRotated(newCode);
      invalidateLeague();
    },
    onError: (err) => {
      setRotated(null);
      setRotateError(err instanceof Error ? err.message : "No se pudo rotar el código.");
    },
  });

  const update = trpc.leagues.update.useMutation({
    onSuccess: () => {
      setUpdateError(null);
      setUpdateSuccess("Configuración guardada.");
      invalidateLeague();
    },
    onError: (err) => {
      setUpdateSuccess(null);
      setUpdateError(
        err instanceof Error ? err.message : "No se pudo guardar la configuración.",
      );
    },
  });

  const transferAdmin = trpc.leagues.transferAdmin.useMutation({
    onSuccess: () => {
      setMembersError(null);
      setMembersSuccess("Rol de admin transferido.");
      invalidateLeague();
    },
    onError: (err) => {
      setMembersSuccess(null);
      setMembersError(
        err instanceof Error ? err.message : "No se pudo transferir el rol.",
      );
    },
  });

  const kick = trpc.leagues.kick.useMutation({
    onSuccess: () => {
      setMembersError(null);
      setMembersSuccess("Miembro expulsado.");
      invalidateLeague();
    },
    onError: (err) => {
      setMembersSuccess(null);
      setMembersError(
        err instanceof Error ? err.message : "No se pudo expulsar al miembro.",
      );
    },
  });

  const close = trpc.leagues.close.useMutation({
    onSuccess: () => {
      setCloseError(null);
      setCloseSuccess("Liga cerrada.");
      invalidateLeague();
    },
    onError: (err) => {
      setCloseSuccess(null);
      setCloseError(err instanceof Error ? err.message : "No se pudo cerrar la liga.");
    },
  });

  const setMemberInvites = trpc.leagues.setMemberInvites.useMutation({
    onSuccess: () => {
      setInvitesError(null);
      setInvitesSuccess("Ajuste de invitaciones guardado.");
      invalidateLeague();
    },
    onError: (err) => {
      setInvitesSuccess(null);
      setInvitesError(
        err instanceof Error ? err.message : "No se pudo guardar el ajuste.",
      );
    },
  });

  // Unión a la liga pública (US-25, entrada abierta ADR-0024): solo si el
  // actor está autenticado y no es miembro. El servidor revalida todo.
  const join = trpc.leagues.join.useMutation({
    onSuccess: () => {
      setJoinError(null);
      invalidateLeague();
    },
    onError: (err) => {
      setJoinError(err instanceof Error ? err.message : "No se pudo unirse a la liga.");
    },
  });

  // Salida de la liga (US-27, ADR-0027): solo un miembro activo no admin.
  // Tras salir de una **privada** ya no es visible (NOT_FOUND) → volver al
  // directorio; tras salir de una **pública** la vista se refresca (ya no
  // es miembro, el botón de unión reaparece).
  const leave = trpc.leagues.leave.useMutation({
    onSuccess: (view) => {
      setLeaveError(null);
      if (view.type === "private") {
        router.push("/ligas");
        return;
      }
      setLeaveSuccess("Has salido de la liga. El histórico de puntos se conserva.");
      invalidateLeague();
    },
    onError: (err) => {
      setLeaveSuccess(null);
      setLeaveError(err instanceof Error ? err.message : "No se pudo salir de la liga.");
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

  // F3 P2: guard server-side de la UX — un nombre vacío llega rechazado al
  // servidor; mejor no enviarlo y escribir el motivo junto al botón.
  function submitBlockReason(): string | null {
    if (update.isPending) return null;
    if (name.trim() === "") return "Escribe un nombre para la liga.";
    return null;
  }

  function handleConfigSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending) return;
    if (submitBlockReason() !== null) return;
    update.mutate({
      leagueId: l.id,
      name,
      description,
      adjustedRankingEnabled,
    });
  }

  const configBlockReason = submitBlockReason();

  return (
    <div className="stack">
      {/* Cabecera */}
      <div>
        <h2>{l.name}</h2>
        {l.description && <p>{l.description}</p>}
        <p className="muted">
          {l.type === "private" ? "Privada" : "Pública"} · {l.activeMembers}/
          {l.maxMembers} miembros · entrada {entryModeLabel(l.entryMode)}
          {l.status !== "active" && (
            <>
              {" "}
              · <strong>{leagueStatusLabel(l.status)}</strong>
            </>
          )}
          {l.startDate && <> · inicio {formatDate(l.startDate)}</>}
          {l.endDate && <> · fin {formatDate(l.endDate)}</>}
        </p>
      </div>

      {/* Feedback de salida de la liga (US-27). F3 P2: vive a nivel de página,
          NO dentro del bloque de miembro: al salir de una liga pública el
          refetch vuelve `isMember: false` y ese bloque desaparece, perdiendo
          el aviso. Aquí sobrevive al cambio de estado. */}
      {leaveError && <Alert variant="error">{leaveError}</Alert>}
      {leaveSuccess && <Alert variant="success">{leaveSuccess}</Alert>}

      {/* Miembros (US-24, leagues.md §9) */}
      <div>
        <h3>
          Miembros ({l.activeMembers}
          {l.activeMembers === 1 ? "" : "s"})
        </h3>
        {l.members.length === 0 ? (
          <p className="muted">Todavía no hay miembros.</p>
        ) : (
          <ul className="status">
            {l.members.map((m) => {
              const isSelf = meId !== undefined && m.userId === meId;
              return (
                <li key={m.userId}>
                  {m.username}
                  {m.role === "admin" && <span className="muted"> · admin</span>}
                  {l.isAdmin && !isSelf && (
                    <span className="spaced">
                      {m.role !== "admin" && (
                        <RowAction
                          aria-label={`Hacer admin a ${m.username}`}
                          onClick={() =>
                            setConfirmRequest({
                              title: `Hacer admin a ${m.username}`,
                              impact: (
                                <>
                                  <strong>{m.username}</strong> pasará a ser admin de la
                                  liga y tú dejarás de serlo.
                                </>
                              ),
                              confirmLabel: "Sí, hacer admin",
                              onConfirm: () =>
                                transferAdmin.mutate({
                                  leagueId: l.id,
                                  targetUserId: m.userId,
                                }),
                            })
                          }
                        >
                          Hacer admin
                        </RowAction>
                      )}{" "}
                      <RowAction
                        aria-label={`Expulsar a ${m.username}`}
                        onClick={() =>
                          setConfirmRequest({
                            title: `Expulsar a ${m.username}`,
                            impact: (
                              <>
                                <strong>{m.username}</strong> saldrá de la liga y no podrá
                                volver a entrar. Su histórico de puntos se conserva.
                              </>
                            ),
                            irreversible: true,
                            confirmLabel: "Sí, expulsar",
                            onConfirm: () =>
                              kick.mutate({
                                leagueId: l.id,
                                targetUserId: m.userId,
                              }),
                          })
                        }
                      >
                        Expulsar
                      </RowAction>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {membersError && <Alert variant="error">{membersError}</Alert>}
        {membersSuccess && <Alert variant="success">{membersSuccess}</Alert>}
      </div>

      {/* Miembros que salieron (US-27, ADR-0027) */}
      {l.formerMembers.length > 0 && (
        <div>
          <h3>
            Miembros que salieron ({l.formerMembers.length}
            {l.formerMembers.length === 1 ? "" : "s"})
          </h3>
          <ul className="status">
            {l.formerMembers.map((m) => (
              <li key={m.userId}>
                {m.username}{" "}
                <span className="muted">
                  · {m.status === "kicked" ? "expulsado" : "retirado"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Código de invitación para el miembro (US-26, leagues.md §5): el admin
          lo habilita con `allowMemberInvites` y el servidor lo entrega al
          miembro (toLeagueView); el miembro lo ve de solo-lectura para
          compartirlo. F3 P1: la función no puede ser muerta para su público —
          antes solo el panel de admin la mostraba. */}
      {l.isMember && !l.isAdmin && l.code && (
        <div>
          <h3>Invitar a amigos</h3>
          <p className="muted">
            El admin de la liga ha habilitado las invitaciones. Comparte este código para
            que otros se unan:
          </p>
          <Alert variant="info">
            Código de invitación: <strong>{l.code}</strong>
          </Alert>
        </div>
      )}

      {/* Salir de la liga (US-27, ADR-0027): miembro activo no admin */}
      {l.isMember && !l.isAdmin && (
        <div>
          <h3>Salir de la liga</h3>
          <p className="muted">
            Al salir dejas de participar en esta liga. Tu histórico de puntos se conserva;
            puedes volver a unirte si la liga sigue abierta.
          </p>
          <Button
            type="button"
            onClick={() =>
              setConfirmRequest({
                title: "Salir de la liga",
                impact: (
                  <>
                    Dejarás de participar en esta liga. Tu histórico de puntos se
                    conserva.
                  </>
                ),
                confirmLabel: "Sí, salir",
                onConfirm: () => leave.mutate({ leagueId: l.id }),
              })
            }
            disabled={leave.isPending}
          >
            {leave.isPending ? "Saliendo…" : "Salir de la liga"}
          </Button>
        </div>
      )}

      {/* Salir de la liga: el admin debe transferir primero el rol (US-27).
          F3 P3: con un solo miembro no hay a quién transferirle — la única
          salida es cerrar la liga. */}
      {l.isAdmin && (
        <div>
          <h3>Salir de la liga</h3>
          {l.activeMembers === 1 ? (
            <p className="muted">
              Eres el único miembro de la liga: no hay a quién transferir el rol. Si
              quieres salir, cierra la liga desde el panel de administración.
            </p>
          ) : (
            <p className="muted">
              Eres el admin de la liga: para salir, transfiere primero el rol a otro
              miembro con «Hacer admin» en la lista de miembros.
            </p>
          )}
        </div>
      )}

      {/* Unión a la liga pública (US-25, entrada abierta ADR-0024) */}
      {l.type === "public" && !l.isMember && (
        <div>
          <h3>Unirse</h3>
          {l.status !== "active" ? (
            // F3 P1: una liga cerrada rechaza la unión (not_accepting_entries);
            // mejor un aviso neutro con salida al directorio que un botón muerto.
            <Alert variant="info">
              Esta liga está {leagueStatusLabel(l.status)} y no admite nuevas entradas.{" "}
              <Link href="/ligas">Ver otras ligas</Link>.
            </Alert>
          ) : me.isPending ? (
            <p className="muted">Consultando…</p>
          ) : me.isError && isUnauthorized(me.error) ? (
            <Alert variant="info">
              Para unirte a la liga necesitas una cuenta.{" "}
              <Link href="/login">Iniciar sesión</Link> o{" "}
              <Link href="/registro">crea una cuenta</Link>.
            </Alert>
          ) : me.isError ? (
            // F3 P3: un fallo real de auth.me no debe leerse como "sin cuenta".
            <Alert variant="error">
              No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.
            </Alert>
          ) : (
            <>
              <Button
                type="button"
                onClick={() => join.mutate({ leagueId: l.id })}
                disabled={join.isPending}
              >
                {join.isPending ? "Uniéndose…" : "Unirme a la liga"}
              </Button>
              {joinError && <Alert variant="error">{joinError}</Alert>}
            </>
          )}
        </div>
      )}

      {/* Ranking general (US-21/ADR-0022) */}
      <div>
        <h3>Ranking general</h3>
        <p className="muted">
          {l.adjustedRankingEnabled
            ? "Ranking ajustado activo: el general cuenta los GPs desde la entrada del último miembro."
            : "Ranking ajustado desactivado: cada miembro suma los GPs desde su propia entrada."}{" "}
          Los cambios de esta opción se aplican en la siguiente publicación.
        </p>
        {ranking.isPending && <p className="muted">Consultando…</p>}
        {ranking.isError && <Alert variant="error">No se pudo cargar el ranking.</Alert>}
        {ranking.data && ranking.data.entries.length === 0 && (
          <p className="muted">
            Aún no hay ranking publicado (se calcula al publicarse resultados
            definitivos).
          </p>
        )}
        {ranking.data && ranking.data.entries.length > 0 && (
          <ol className="status">
            {ranking.data.entries.map((e) => (
              <li key={e.position}>
                {e.username}{" "}
                <span className="muted">— {formatNumber(e.points)} pts</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Panel de administración (US-26, leagues.md §5) */}
      {l.isAdmin && (
        <div className="stack">
          <h3>Administración</h3>

          {/* Código de invitación (leagues.md §4) */}
          <div>
            <h4>Código de invitación</h4>
            {l.code ? (
              <>
                <Alert variant="info">
                  Código de invitación: <strong>{l.code}</strong>{" "}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      // F3 P2: rotar revoca el código vigente (afecta a
                      // terceros que lo tengan) — pide confirmación con el
                      // impacto escrito, como el resto de acciones que
                      // reescriben datos.
                      setConfirmRequest({
                        title: "Rotar el código de invitación",
                        impact: (
                          <>
                            El código actual quedará <strong>revocado</strong>: quien lo
                            tenga ya no podrá unirse con él.
                          </>
                        ),
                        confirmLabel: "Sí, rotar",
                        onConfirm: () => rotate.mutate({ leagueId: l.id }),
                      })
                    }
                    disabled={rotate.isPending}
                  >
                    {rotate.isPending ? "Rotando…" : "Rotar código"}
                  </Button>
                </Alert>
                {rotated && (
                  <Alert variant="success">
                    Código rotado. El código anterior quedó revocado. Nuevo código:{" "}
                    <strong>{rotated}</strong>
                  </Alert>
                )}
                {rotateError && <Alert variant="error">{rotateError}</Alert>}
              </>
            ) : (
              <Alert variant="info">
                Esta liga no usa código de invitación (modo «solo invitación»).
              </Alert>
            )}
          </div>

          {/* Invitaciones de miembros (US-26) */}
          <div>
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
            {invitesError && <Alert variant="error">{invitesError}</Alert>}
            {invitesSuccess && <Alert variant="success">{invitesSuccess}</Alert>}
          </div>

          {/* Configuración (US-26) */}
          <div>
            <h4>Configuración</h4>
            <form className="form" onSubmit={handleConfigSubmit} noValidate>
              <div className="stack">
                <Field
                  label="Nombre"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
                <Field
                  label="Descripción (opcional)"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                />
              </div>
              {/* F3 P1: la visibilidad está derivada del tipo (el servidor la
                  exige acoplada), así que no es un control — lectura de solo
                  lectura, como en la creación. */}
              <p className="muted">Visibilidad: {VISIBILITY_BY_TYPE[l.type]}</p>
              <div className="field">
                <label>
                  <input
                    type="checkbox"
                    checked={adjustedRankingEnabled}
                    onChange={(e) => setAdjustedRankingEnabled(e.target.checked)}
                  />{" "}
                  Ranking ajustado
                </label>
                <p className="muted">
                  Cuenta el general solo desde la entrada del último miembro. Se aplica en
                  la siguiente publicación del ranking.
                </p>
              </div>
              {updateError && <Alert variant="error">{updateError}</Alert>}
              {updateSuccess && <Alert variant="success">{updateSuccess}</Alert>}
              <Button
                type="submit"
                disabled={configBlockReason !== null || update.isPending}
                disabledReason={configBlockReason ?? undefined}
              >
                {update.isPending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </form>
          </div>

          {/* Cerrar liga (US-26). F3 P2: en una liga no activa el clic está
              garantizado a rechazo ("La liga ya no está activa.") — un control
              muerto; solo tiene sentido mientras la liga está activa. */}
          {l.status === "active" && (
            <div>
              <h4>Cerrar liga</h4>
              <p className="muted">
                Al cerrar la liga pasa a «finalizada» y deja de aceptar cambios o nuevas
                entradas. El histórico de puntos se conserva.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setConfirmRequest({
                    title: "Cerrar la liga",
                    impact: (
                      <>
                        La liga pasará a <strong>finalizada</strong> y dejará de aceptar
                        cambios o nuevas entradas. Esta acción no tiene vuelta atrás.
                      </>
                    ),
                    irreversible: true,
                    confirmLabel: "Sí, cerrar la liga",
                    onConfirm: () => close.mutate({ leagueId: l.id }),
                  })
                }
                disabled={close.isPending}
              >
                {close.isPending ? "Cerrando…" : "Cerrar la liga"}
              </Button>
              {closeError && <Alert variant="error">{closeError}</Alert>}
              {closeSuccess && <Alert variant="success">{closeSuccess}</Alert>}
            </div>
          )}
        </div>
      )}

      {/* Confirmación con impacto (patrón del sistema) */}
      {confirmRequest ? (
        <ConfirmDialog
          {...confirmRequest}
          onClose={() => setConfirmRequest(null)}
          onConfirm={() => {
            const run = confirmRequest.onConfirm;
            setConfirmRequest(null);
            run();
          }}
        />
      ) : null}
    </div>
  );
}
