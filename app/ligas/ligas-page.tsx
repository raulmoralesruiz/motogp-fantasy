"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import type { LeagueStatus } from "@/modules/leagues";
import { PROVISIONAL_SEASON_RULES } from "@/shared/config";
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
 *
 * F3 (impeccable, 2026-11-07): listas de datos en `.status` con columnas
 * unificadas, clusters de formulario en `.stack`, capa de ayuda de
 * vocabulario antes de la primera lista, tipo/visibilidad acoplados con
 * ayuda (el servidor exige `pública ⇒ visibilidad pública` y
 * `privada ⇒ no pública`), límites de miembros alineados al dominio
 * PROVISIONAL 2–50 (D-05), motivo de bloqueo escrito junto al botón y el
 * resultado de la creación junto a la acción (no arriba de la página).
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
  adjustedRankingEnabled: boolean;
  startDate: string;
  endDate: string;
}

/**
 * Límites PROVISIONAL de miembros por liga (leagues.md §3, D-05: 2–50).
 * F3 P3: se derivan de `PROVISIONAL_SEASON_RULES.league` (fuente de verdad,
 * AGENTS.md §1.3 — no constantes mágicas). El servidor los revalida
 * (AGENTS.md §8); la UI solo deja de ofrecer valores que el servidor
 * rechazaría de forma garantizada (F3 P1: antes 1–100).
 */
const MIN_MEMBERS = PROVISIONAL_SEASON_RULES.league.minMembers;
const MAX_MEMBERS = PROVISIONAL_SEASON_RULES.league.maxMembers;

const EMPTY_FORM: LeagueForm = {
  name: "",
  description: "",
  type: "private",
  visibility: "private",
  // F3 P3: el borrador nace dentro del dominio (derivado del config, no
  // "2"/"50" duros) — si D-05 calibra los límites, el formulario no arranca
  // bloqueado.
  minMembers: String(MIN_MEMBERS),
  maxMembers: String(MAX_MEMBERS),
  entryMode: "code",
  adjustedRankingEnabled: false,
  startDate: "",
  endDate: "",
};

/** Etiqueta legible del modo de entrada (leagues.md §3). */
function entryModeLabel(mode: "code" | "invite" | "mixed"): string {
  if (mode === "code") return "por código";
  if (mode === "invite") return "solo invitación";
  return "código o invitación";
}

/**
 * Etiqueta legible del estado de la liga (F3 P2: marcar la no activa).
 * F3 P3: tipada con la unión de dominio `LeagueStatus` — un estado nuevo es
 * error de compilación, no una etiqueta «activa» silenciosa.
 */
function leagueStatusLabel(status: LeagueStatus): string {
  if (status === "finished") return "finalizada";
  if (status === "archived") return "archivada";
  if (status === "planned") return "planificada";
  return "activa";
}

/**
 * F3 P1: el tipo determina la visibilidad efectiva — el servidor exige
 * `public ⇒ visibilidad pública` y `privada ⇒ no pública` (y el directorio
 * solo lista `type = public`). F3 P3: como `canViewLeague` solo inspecciona
 * `type` (para una privada, "privada" y "sin listar" son idénticas), la
 * visibilidad queda TOTALMENTE derivada del tipo — la UI no la ofrece como
 * control (un select de una opción es un instrumento muerto), sino como
 * lectura de solo lectura bajo el tipo.
 */
const VISIBILITY_BY_TYPE: Record<
  LeagueForm["type"],
  { value: LeagueForm["visibility"]; label: string }
> = {
  private: { value: "private", label: "Privada (oculta)" },
  public: { value: "public", label: "Pública (directorio)" },
};

export default function LigasPage() {
  const queryClient = useQueryClient();
  const me = trpc.auth.me.useQuery();
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
    // F3 P3: el banner de éxito describe la ÚLTIMA creación; al empezar un
    // borrador nuevo deja de ser el resultado de la última acción.
    setCreated(null);
  }

  /** F3 P1: el tipo arrastra la visibilidad (ver `VISIBILITY_BY_TYPE`). */
  function setType(type: LeagueForm["type"]) {
    setForm((f) => ({
      ...f,
      type,
      visibility: VISIBILITY_BY_TYPE[type].value,
    }));
    setCreated(null);
  }

  /** F3 P3: con 10 campos, vaciar el formulario a mano es fricción —
      "Limpiar" devuelve el borrador inicial y limpia el resultado. */
  function handleReset() {
    setForm(EMPTY_FORM);
    setCreated(null);
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Defensa en profundidad (F3 P2): nunca re-disparar una creación
    // no idempotente mientras otra está en vuelo (doble clic en móvil con
    // red lenta). El botón ya va `disabled` nativo en ese estado.
    if (create.isPending) return;
    // Guard server-side de la UX: un Enter en un input dispara `submit`
    // aunque el botón esté `aria-disabled`; no enviar un payload que el
    // servidor rechazaría de forma garantizada (F3 P1/P2).
    if (submitBlockReason() !== null) return;
    create.mutate({
      name: form.name,
      description: form.description || null,
      type: form.type,
      visibility: form.visibility,
      minMembers: Number(form.minMembers),
      maxMembers: Number(form.maxMembers),
      entryMode: form.entryMode,
      adjustedRankingEnabled: form.adjustedRankingEnabled,
      startDate: form.startDate ? new Date(form.startDate) : undefined,
      endDate: form.endDate ? new Date(form.endDate) : undefined,
    });
  }

  /**
   * F3 P2: el motivo de bloqueo SIEMPRE se escribe junto al botón
   * (compromiso de marca: "nunca un control bloqueado sin explicación").
   * `null` = se puede enviar; el estado transitorio (envío en curso) no
   * lleva motivo (el botón ya dice "Creando…").
   */
  function submitBlockReason(): string | null {
    if (create.isPending) return null;
    if (form.name.trim() === "") return "Escribe un nombre para la liga.";
    // F3 P3: no depender del saneo del navegador en `type="number"` —
    // `Number("abc")` = NaN pasaría todas las comparaciones (todo con NaN
    // es `false`) y se enviaría al servidor. `Number.isInteger` caza NaN y
    // no enteros; 0 pasa aquí pero lo caza el mínimo.
    const minMembers = Number(form.minMembers);
    const maxMembers = Number(form.maxMembers);
    if (!Number.isInteger(minMembers) || !Number.isInteger(maxMembers))
      return "Los miembros deben ser números enteros.";
    if (minMembers < MIN_MEMBERS)
      return `El mínimo de miembros es ${MIN_MEMBERS}.`;
    if (maxMembers > MAX_MEMBERS)
      return `El máximo de miembros es ${MAX_MEMBERS}.`;
    if (maxMembers < minMembers)
      return "El máximo de miembros no puede ser menor que el mínimo.";
    // Fechas `YYYY-MM-DD`: la comparación lexicográfica vale (mismo formato).
    if (
      form.startDate !== "" &&
      form.endDate !== "" &&
      form.endDate < form.startDate
    )
      return "La fecha de fin no puede ser anterior a la de inicio.";
    return null;
  }

  const blockReason = submitBlockReason();
  const canSubmit = blockReason === null;

  /** Fila de liga (mis ligas + directorio): columnas unificadas (F3 P1/P2). */
  function leagueMeta(league: {
    type: "private" | "public";
    activeMembers: number;
    maxMembers: number;
    entryMode: "code" | "invite" | "mixed";
    /** F3 P2: solo `LeagueView` la expone; el directorio (solo `active`) no. */
    status?: LeagueStatus;
  }): string {
    const base = `${league.type === "private" ? "privada" : "pública"} · ${league.activeMembers}/${league.maxMembers} miembros · ${entryModeLabel(league.entryMode)}`;
    // F3 P2: una liga no activa no es idéntica a una activa (el directorio ya
    // filtra a `active`; "mis ligas" la marca en lugar de ocultarla).
    if (league.status && league.status !== "active") {
      return `${base} · ${leagueStatusLabel(league.status)}`;
    }
    return base;
  }

  if (me.isPending) {
    return <p className="muted">Consultando…</p>;
  }

  if (me.isError) {
    // F3 P2: sin sesión no es un fallo — es un estado neutro con salida
    // (patrón de `/unirse`, US-25): ni error en rojo ni formulario que
    // fallaría al enviar.
    return (
      <Alert variant="info">
        Para ver tus ligas o crear una necesitas una cuenta.{" "}
        <Link href="/login">Iniciar sesión</Link> o{" "}
        <Link href="/registro">crea una cuenta</Link>.
      </Alert>
    );
  }

  return (
    <div>
      <h2>Mis ligas</h2>
      {/* F3 P2: capa de vocabulario antes de la primera lista. */}
      <p className="muted">
        Miembros: participantes activos (actual/máximo). Admin: tú gestionas
        esa liga (invitar, expulsar, cerrarla). Tipo: privada (oculta, solo
        por código o invitación) o pública (visible en el directorio).
      </p>
      {myLeagues.isPending && <p className="muted">Consultando…</p>}
      {myLeagues.isError && (
        <Alert variant="error">No se pudo cargar tu lista de ligas.</Alert>
      )}
      {myLeagues.data && myLeagues.data.length === 0 && (
        <p className="muted">
          Todavía no estás en ninguna liga.{" "}
          <Link href="#crear-liga">Crea una abajo</Link> o{" "}
          <Link href="#directorio">únete a una del directorio</Link>.
        </p>
      )}
      {myLeagues.data && myLeagues.data.length > 0 && (
        <ul className="status">
          {myLeagues.data.map((league) => (
            <li key={league.id}>
              <Link href={`/ligas/${league.id}`}>
                <strong>{league.name}</strong>
              </Link>
              {league.description ? (
                <p className="muted">{league.description}</p>
              ) : null}
              <span className="muted">{leagueMeta(league)}</span>
              {league.isAdmin && <span className="muted"> · admin</span>}
            </li>
          ))}
        </ul>
      )}

      <h2 id="directorio">Directorio de ligas públicas</h2>
      {/* F3 P3: la intro describe el DIRECTORIO (ligas públicas, entrada
          abierta); el flujo de código es secundario, no la puerta de entrada. */}
      <p className="muted">
        Ligas públicas con entrada abierta: cualquiera puede unirse mientras
        haya plaza. ¿Tienes un código de invitación?{" "}
        <Link href="/unirse">Únete a una liga</Link>.
      </p>
      {publicLeagues.isPending && <p className="muted">Consultando…</p>}
      {publicLeagues.isError && (
        <Alert variant="error">No se pudo cargar el directorio de ligas.</Alert>
      )}
      {publicLeagues.data && publicLeagues.data.length === 0 && (
        <p className="muted">
          Todavía no hay ligas públicas.{" "}
          <Link href="#crear-liga">Crea la primera abajo</Link>.
        </p>
      )}
      {publicLeagues.data && publicLeagues.data.length > 0 && (
        <ul className="status">
          {publicLeagues.data.map((league) => (
            <li key={league.id}>
              <Link href={`/ligas/${league.id}`}>
                <strong>{league.name}</strong>
              </Link>
              {league.description ? (
                <p className="muted">{league.description}</p>
              ) : null}
              <span className="muted">{leagueMeta(league)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 id="crear-liga">Crear una liga</h2>
      {/* F3 P1: la trampa del formulario es el acople tipo/visibilidad —
          la ayuda la explica ANTES del primer select. */}
      <p className="muted">
        Una liga pública aparece en el directorio y cualquiera puede unirse
        mientras haya plaza. Una liga privada es oculta: solo quien tiene el
        código de invitación puede entrar. Límites de miembros PROVISIONAL:
        de {MIN_MEMBERS} a {MAX_MEMBERS}; los revalida el servidor.
      </p>
      <form className="form" onSubmit={handleSubmit} noValidate>
        {/* F3 P1: clusters en .stack — cada bloque comparte el gap del
            sistema en lugar de 10 campos sueltos. */}
        <div className="stack">
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
        </div>
        <div className="stack">
          <div className="field">
            <label htmlFor="type">Tipo</label>
            <select
              id="type"
              name="type"
              value={form.type}
              onChange={(e) => setType(e.target.value as LeagueForm["type"])}
            >
              <option value="private">Privada</option>
              <option value="public">Pública</option>
            </select>
          </div>
          {/* F3 P3: la visibilidad está TOTALMENTE derivada del tipo (el
              servidor la exige acoplada y `canViewLeague` solo mira el tipo),
              así que no es un control — un select de una opción sería un
              instrumento muerto. Se muestra como lectura de solo lectura. */}
          <p className="muted">
            Visibilidad: {VISIBILITY_BY_TYPE[form.type].label}
          </p>
          <div className="field">
            <label htmlFor="entryMode">Modo de entrada</label>
            <select
              id="entryMode"
              name="entryMode"
              value={form.entryMode}
              onChange={(e) =>
                set("entryMode", e.target.value as LeagueForm["entryMode"])
              }
            >
              <option value="code">Por código</option>
              {/* F3 P2: "solo invitación" es hoy una trampa — sin invitación
                  directa (diferida), una liga así no genera código y no
                  admite uniones (ADR-0025), y el modo no es modificable tras
                  la creación. Mejor no ofrecerla que crear una liga muerta. */}
              <option value="invite" disabled>
                Solo invitación (aún no disponible)
              </option>
              <option value="mixed">Código o invitación</option>
            </select>
            <p className="muted">
              «Solo invitación» no está disponible todavía: una liga así no
              generaría código y nadie podría unirse. Usa «Por código» o
              «Código o invitación». En una liga pública la entrada es
              abierta (cualquiera puede unirse mientras haya plaza); el modo
              solo decide si se genera un código para compartir.
            </p>
          </div>
        </div>
        <div className="stack">
          <div className="field">
            <label htmlFor="minMembers">
              Miembros mínimos ({MIN_MEMBERS}–{MAX_MEMBERS})
            </label>
            <input
              id="minMembers"
              name="minMembers"
              type="number"
              min={MIN_MEMBERS}
              max={MAX_MEMBERS}
              value={form.minMembers}
              onChange={(e) => set("minMembers", e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="maxMembers">
              Miembros máximos ({MIN_MEMBERS}–{MAX_MEMBERS})
            </label>
            <input
              id="maxMembers"
              name="maxMembers"
              type="number"
              min={MIN_MEMBERS}
              max={MAX_MEMBERS}
              value={form.maxMembers}
              onChange={(e) => set("maxMembers", e.target.value)}
            />
          </div>
        </div>
        {/* Un solo campo: sin envoltorio `.stack` (F3 P3: un stack de un
            ítem es una rareza estructural; el resto de clusters tienen 2+). */}
        <div className="field">
          <label htmlFor="adjustedRankingEnabled">
            <input
              id="adjustedRankingEnabled"
              type="checkbox"
              name="adjustedRankingEnabled"
              checked={form.adjustedRankingEnabled}
              onChange={(e) => set("adjustedRankingEnabled", e.target.checked)}
            />{" "}
            Ranking ajustado
          </label>
          <p className="muted">
            El ranking general contará solo los GPs desde la entrada del
            último miembro. Se aplica en la siguiente publicación del
            ranking.
          </p>
        </div>
        <div className="stack">
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
          {/* F3 P3: los únicos campos sin guía — decir qué controlan (y qué
              NO controlan) en vez de dejar "Inicio/Fin" a la interpretación. */}
          <p className="muted">
            Periodo de la liga (leagues.md §2: tipo «Temporal»). Hoy es
            informativo: la elegibilidad por GP depende de la entrada de cada
            miembro y de la fecha del GP, no de estas fechas.
          </p>
        </div>
        {/* F3 P1: el resultado de la creación vive CON la acción — en
            móvil, tras el submit el usuario está aquí, no arriba. */}
        {error && <Alert variant="error">{error}</Alert>}
        {created && (
          <Alert variant="success">
            Liga «{created.name}» creada.{" "}
            <Link href={`/ligas/${created.id}`}>Ver detalle</Link>
          </Alert>
        )}
        <div className="action-row">
          {/* F3 P3: no resetear el borrador en medio de un envío en vuelo. */}
          <Button variant="secondary" disabled={create.isPending} onClick={handleReset}>
            Limpiar
          </Button>
          {/* F3 P2: en estado transitorio (envío en curso) el botón va
              `disabled` NATIVO (patrón de `Button`), no `aria-disabled` —
              así un doble clic no re-dispara la creación no idempotente. */}
          <Button
            type="submit"
            disabled={create.isPending || !canSubmit}
            disabledReason={blockReason ?? undefined}
          >
            {create.isPending ? "Creando…" : "Crear liga"}
          </Button>
        </div>
      </form>
    </div>
  );
}
