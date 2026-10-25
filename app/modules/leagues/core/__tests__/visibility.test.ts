/**
 * Tests de la regla de visibilidad de ligas — núcleo puro (US-24,
 * leagues.md §9, ADR-0024).
 *
 * CA: "la liga pública es visible en el directorio con ranking público; la
 * privada no aparece (test: un usuario no autenticado/miembro no la ve ni
 * puede acceder por ID)".
 *
 * Aquí se cubre la parte pura (regla de acceso): pública ⇒ cualquiera;
 * privada ⇒ solo miembro activo. La resolución de la membresía (I/O) y el
 * NOT_FOUND anti-revelación se cubren en integración.
 */
import { describe, expect, it } from "vitest";

import { canViewLeague } from "../visibility.js";

describe("canViewLeague (leagues.md §9)", () => {
  it("liga pública: la ve cualquiera (sin sesión)", () => {
    expect(canViewLeague({ type: "public" }, { isActiveMember: false })).toBe(true);
  });

  it("liga pública: la ve también un miembro activo", () => {
    expect(canViewLeague({ type: "public" }, { isActiveMember: true })).toBe(true);
  });

  it("liga privada: solo la ve un miembro activo", () => {
    expect(canViewLeague({ type: "private" }, { isActiveMember: true })).toBe(true);
  });

  it("liga privada: un extraño (sin sesión) no la ve", () => {
    expect(canViewLeague({ type: "private" }, { isActiveMember: false })).toBe(false);
  });

  it("liga privada: un autenticado que NO es miembro no la ve", () => {
    // Un usuario logueado que no es miembro activo de la liga privada.
    expect(canViewLeague({ type: "private" }, { isActiveMember: false })).toBe(false);
  });
});
