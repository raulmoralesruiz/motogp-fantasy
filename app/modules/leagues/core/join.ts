/**
 * Regla de unión a una liga — FÓRMULA PURA (sin I/O).
 *
 * US-25 (leagues.md §2/§4/§6/§10, ADR-0025):
 * - **Pública:** entrada abierta (ADR-0024) — se une por `leagueId`.
 * - **Privada:** solo por código activo (entryMode `code`/`mixed`) — el
 *   código resuelve la liga. `entryMode=invite` (solo invitación directa)
 *   no admite uniones en este US (la invitación directa se difiere, US-26).
 * - **Anti-abuso (leagues.md §4/§10):** un usuario no puede unirse dos
 *   veces a la misma liga; la unión por código tiene rate-limit por IP y
 *   bloqueo temporal tras N intentos fallidos (fuerza bruta).
 *
 * La función es pura: el servicio (I/O) resuelve el estado de la BD
 * (estado de la liga, código activo, membresía, plazas) y del store de
 * rate-limit (ventana/bloqueo por IP) y consume esta regla; el router no la
 * duplica (T-08: una sola fuente). Mismo contrato que
 * `evaluateLoginAttempt` (US-01) y `canViewLeague` (US-24).
 *
 * Los tipos se definen localmente (sin I/O, check de pureza T-03):
 * reflejan los enums de la BD, compatibles por estructura. `LeagueType` se
 * reutiliza de `visibility.ts` (módulo puro, sin I/O).
 */
import type { LeagueType } from "./visibility";

/** Estado de la liga (reflejo del enum `LeagueStatus` de la BD). */
export type LeagueStatus = "planned" | "active" | "finished" | "archived";

/** Modo de entrada (reflejo del enum `LeagueEntryMode` de la BD). */
export type LeagueEntryMode = "code" | "invite" | "mixed";

/** Motivo de la decisión de unión. */
export type LeagueJoinReason =
  | "ok"
  | "rate_limited"
  | "locked"
  | "not_accepting_entries"
  | "invalid_code"
  | "already_member"
  | "league_full";

export interface LeagueJoinDecision {
  allowed: boolean;
  reason: LeagueJoinReason;
  /** Segundos que hay que esperar para reintentar (0 si está permitido). */
  retryAfterSec: number;
}

/**
 * Estado resuelto por el servicio para decidir la unión (US-25).
 *
 * - `ipWindowCount` INCLUYE el intento que se está evaluando (el store
 *   incrementa antes de decidir, como en el login US-01).
 * - `codeValid` es `true` solo si el código introducido es una invitación
 *   ACTIVA de ESTA liga.
 */
export interface LeagueJoinState {
  /** Intentos de unión registrados en la ventana actual (por IP). */
  ipWindowCount: number;
  /** Segundos restantes de la ventana actual (0 si ya expiró). */
  ipWindowRemainingSec: number;
  /** Segundos restantes del bloqueo por fallos de la IP (0 si no bloqueada). */
  ipLockRemainingSec: number;
  status: LeagueStatus;
  type: LeagueType;
  entryMode: LeagueEntryMode;
  /** La liga tiene al menos un código de invitación activo. */
  hasActiveCode: boolean;
  /** El actor introdujo un código. */
  codeProvided: boolean;
  /** El código introducido es una invitación activa de esta liga. */
  codeValid: boolean;
  /** El actor ya es miembro activo de la liga. */
  isActiveMember: boolean;
  /** Miembros activos actuales (status = active). */
  activeMembers: number;
  /** Máximo de miembros de la liga. */
  maxMembers: number;
}

/**
 * Decide si se permite unirse a la liga (US-25, ADR-0025).
 *
 * Orden de prioridad (lo operativo antes que lo de negocio; el fallo de
 * código antes que "ya eres miembro", para que un código erróneo se
 * diagnostique como tal y cuente para el anti fuerza bruta):
 *
 * 1. `locked` — la IP está bloqueada por fallos previos (prioridad total,
 *    como el bloqueo de cuenta del login US-01).
 * 2. `rate_limited` — se superó la ventana por IP.
 * 3. `not_accepting_entries` — liga no operativa (status ≠ active); privada
 *    "solo invitación" (entryMode=invite — la invitación directa se difiere);
 *    privada sin código activo (el admin revocó todos los códigos).
 * 4. `invalid_code` — privada (code/mixed) sin código introducido o con un
 *    código que no es una invitación activa de la liga.
 * 5. `already_member` — el actor ya es miembro activo (leagues.md §4: no se
 *    puede unirse dos veces a la misma liga).
 * 6. `league_full` — miembros activos ≥ máximo (leagues.md §2: "abierta con
 *    límite").
 * 7. `ok`.
 *
 * La PÚBLICA (cualquier entryMode) entra abierta si es `active` y tiene
 * plaza (ADR-0024: la entrada pública no requiere código).
 */
export function evaluateLeagueJoin(
  state: LeagueJoinState,
  cfg: { maxPerWindow: number },
): LeagueJoinDecision {
  // 1) El bloqueo por fallos tiene prioridad sobre todo (US-01, patrón
  //    `evaluateLoginAttempt`).
  if (state.ipLockRemainingSec > 0) {
    return {
      allowed: false,
      reason: "locked",
      retryAfterSec: Math.ceil(state.ipLockRemainingSec),
    };
  }
  // 2) `maxPerWindow` intentos se permiten por ventana: se rechaza el (max+1)º.
  if (
    state.ipWindowCount > cfg.maxPerWindow &&
    state.ipWindowRemainingSec > 0
  ) {
    return {
      allowed: false,
      reason: "rate_limited",
      retryAfterSec: Math.ceil(state.ipWindowRemainingSec),
    };
  }
  // 3) La liga debe aceptar entradas (leagues.md §6: "si hay plaza y la liga
  //    acepta entradas").
  if (state.status !== "active") {
    return { allowed: false, reason: "not_accepting_entries", retryAfterSec: 0 };
  }
  if (state.type === "private") {
    // "Solo invitación directa" (entryMode=invite): no admite uniones en
    // este US (la invitación directa a usuario concreto se difiere, US-26).
    if (state.entryMode === "invite") {
      return {
        allowed: false,
        reason: "not_accepting_entries",
        retryAfterSec: 0,
      };
    }
    // Privada por código (code/mixed): necesita un código activo…
    if (!state.hasActiveCode) {
      return {
        allowed: false,
        reason: "not_accepting_entries",
        retryAfterSec: 0,
      };
    }
    // …y el introducido debe ser una invitación activa de ESTA liga.
    if (!state.codeProvided || !state.codeValid) {
      return { allowed: false, reason: "invalid_code", retryAfterSec: 0 };
    }
  }
  // 4) Anti-abuso (leagues.md §4): no se puede unirse dos veces a la misma
  //    liga.
  if (state.isActiveMember) {
    return { allowed: false, reason: "already_member", retryAfterSec: 0 };
  }
  // 5) "Abierta (con límite)" (leagues.md §2): la última plaza es para uno.
  if (state.activeMembers >= state.maxMembers) {
    return { allowed: false, reason: "league_full", retryAfterSec: 0 };
  }
  return { allowed: true, reason: "ok", retryAfterSec: 0 };
}

/**
 * PURA: decide si un fallo de código debe bloquear la IP (US-25, espejo de
 * `shouldLockAccount` del login US-01).
 */
export function shouldLockLeagueJoin(
  failureCount: number,
  cfg: { lockoutThreshold: number },
): boolean {
  return failureCount >= cfg.lockoutThreshold;
}
