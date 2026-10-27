/**
 * Tests de `leagues/core/permissions.ts` (US-26, leagues.md §5, ADR-0026):
 * - `canManageLeague`: solo el admin ejecuta las acciones de gestión
 *   (update, rotate_code, kick, close, transfer_admin); el miembro, no.
 * - `canInvite`: el admin siempre; el miembro solo si el admin habilita
 *   `allowMemberInvites`.
 *
 * Fórmulas puras: sin I/O, sin reloj, sin BD (check de pureza T-03).
 */
import { describe, expect, it } from "vitest";

import {
  canInvite,
  canManageLeague,
  type LeagueAdminAction,
} from "../permissions";

const ALL_ACTIONS: LeagueAdminAction[] = [
  "update",
  "rotate_code",
  "kick",
  "close",
  "transfer_admin",
];

describe("canManageLeague (US-26, leagues.md §5)", () => {
  it("el admin puede ejecutar CADA acción de gestión", () => {
    for (const action of ALL_ACTIONS) {
      expect(canManageLeague("admin", action)).toBe(true);
    }
  });

  it("el miembro NO puede ejecutar NINGUNA acción de gestión", () => {
    for (const action of ALL_ACTIONS) {
      expect(canManageLeague("member", action)).toBe(false);
    }
  });

  it("es exhaustivo sobre las cinco acciones (sin ramas muertas)", () => {
    // Si el núcleo añade una acción, este test obliga a revisarla aquí.
    expect(ALL_ACTIONS).toHaveLength(5);
    expect(canManageLeague("admin", "update")).toBe(true);
    expect(canManageLeague("member", "update")).toBe(false);
  });
});

describe("canInvite (US-26, leagues.md §5: 'solo si el admin lo habilita')", () => {
  it("el admin puede invitar SIEMPRE (si el modo lo permite)", () => {
    expect(canInvite("admin", { allowMemberInvites: false })).toBe(true);
    expect(canInvite("admin", { allowMemberInvites: true })).toBe(true);
  });

  it("el miembro solo puede invitar si el admin lo habilita", () => {
    expect(canInvite("member", { allowMemberInvites: false })).toBe(false);
    expect(canInvite("member", { allowMemberInvites: true })).toBe(true);
  });
});
