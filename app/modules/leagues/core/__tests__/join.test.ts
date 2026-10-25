/**
 * Tests de la regla de unión a una liga — núcleo puro (US-25,
 * leagues.md §2/§4/§6/§10, ADR-0025).
 *
 * CA: "validaciones server-side con motivo explícito: 'código no válido',
 * 'la liga está llena', 'ya eres miembro', 'la liga no acepta entradas';
 * rate-limiting por IP/usuario en el intento de unión (test de fuerza
 * bruta: N intentos fallidos → bloqueo temporal); unirse es transaccional
 * (plaza + membresía, test de concurrencia: dos usuarios por la última
 * plaza → solo uno entra)".
 *
 * Aquí se cubre la parte pura (decisión + motivo + orden de prioridad y
 * umbral de bloqueo). La resolución del estado (BD), el store de rate-limit
 * (I/O) y la concurrencia de la última plaza se cubren en integración.
 */
import { describe, expect, it } from "vitest";

import {
  evaluateLeagueJoin,
  shouldLockLeagueJoin,
  type LeagueJoinState,
} from "../join.js";

/** Estado base: liga PÚBLICA activa, plaza libre, sin rate-limit. */
function baseState(overrides: Partial<LeagueJoinState> = {}): LeagueJoinState {
  return {
    ipWindowCount: 1,
    ipWindowRemainingSec: 59,
    ipLockRemainingSec: 0,
    status: "active",
    type: "public",
    entryMode: "code",
    hasActiveCode: true,
    codeProvided: false,
    codeValid: false,
    isActiveMember: false,
    activeMembers: 1,
    maxMembers: 50,
    ...overrides,
  };
}

describe("evaluateLeagueJoin (leagues.md §6, ADR-0025)", () => {
  describe("permitir", () => {
    it("pública activa con plaza: se permite sin código (entrada abierta)", () => {
      const d = evaluateLeagueJoin(baseState(), { maxPerWindow: 10 });
      expect(d).toEqual({ allowed: true, reason: "ok", retryAfterSec: 0 });
    });

    it("privada con código activo válido: se permite", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", codeProvided: true, codeValid: true }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(true);
      expect(d.reason).toBe("ok");
    });

    it("privada `mixed` con código activo válido: se permite (código o invitación)", () => {
      const d = evaluateLeagueJoin(
        baseState({
          type: "private",
          entryMode: "mixed",
          codeProvided: true,
          codeValid: true,
        }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(true);
    });
  });

  describe("bloqueo y rate-limit (leagues.md §4/§10, prioridad total)", () => {
    it("IP bloqueada por fallos previos: se rechaza aunque todo lo demás esté bien", () => {
      const d = evaluateLeagueJoin(
        baseState({
          ipLockRemainingSec: 800,
          type: "private",
          codeProvided: true,
          codeValid: true,
        }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("locked");
      expect(d.retryAfterSec).toBe(800);
    });

    it("el bloqueo tiene prioridad sobre la ventana", () => {
      const d = evaluateLeagueJoin(
        baseState({ ipLockRemainingSec: 10, ipWindowCount: 99 }),
        { maxPerWindow: 10 },
      );
      expect(d.reason).toBe("locked");
    });

    it("ventana por IP superada: se rechaza con retryAfter", () => {
      const d = evaluateLeagueJoin(
        baseState({ ipWindowCount: 11, ipWindowRemainingSec: 42.4 }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("rate_limited");
      expect(d.retryAfterSec).toBe(43);
    });

    it("ventana expirada (remainingSec = 0): no bloquea aunque el contador sea alto", () => {
      const d = evaluateLeagueJoin(
        baseState({ ipWindowCount: 99, ipWindowRemainingSec: 0 }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(true);
    });

    it("el intento N+1 se rechaza y el N se permite", () => {
      expect(
        evaluateLeagueJoin(baseState({ ipWindowCount: 10 }), { maxPerWindow: 10 })
          .allowed,
      ).toBe(true);
      expect(
        evaluateLeagueJoin(baseState({ ipWindowCount: 11 }), { maxPerWindow: 10 })
          .allowed,
      ).toBe(false);
    });
  });

  describe("'la liga no acepta entradas' (leagues.md §6)", () => {
    it.each(["planned", "finished", "archived"] as const)(
      "status %s: se rechaza",
      (status) => {
        const d = evaluateLeagueJoin(baseState({ status }), { maxPerWindow: 10 });
        expect(d.allowed).toBe(false);
        expect(d.reason).toBe("not_accepting_entries");
        expect(d.retryAfterSec).toBe(0);
      },
    );

    it("privada `solo invitación` (entryMode=invite): no admite uniones (se difiere, US-26)", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", entryMode: "invite" }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("not_accepting_entries");
    });

    it("privada sin código activo (revocados todos): se rechaza", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", hasActiveCode: false, codeProvided: true, codeValid: true }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("not_accepting_entries");
    });

    it("el estado no operativo tiene prioridad sobre el código inválido", () => {
      const d = evaluateLeagueJoin(
        baseState({ status: "finished", type: "private", codeProvided: false }),
        { maxPerWindow: 10 },
      );
      expect(d.reason).toBe("not_accepting_entries");
    });
  });

  describe("'código no válido' (leagues.md §4)", () => {
    it("privada sin código introducido: se rechaza", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", codeProvided: false, codeValid: false }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("invalid_code");
    });

    it("privada con código que no es invitación activa de la liga: se rechaza", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", codeProvided: true, codeValid: false }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("invalid_code");
    });

    it("el código inválido se diagnostica ANTES que 'ya eres miembro'", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", codeProvided: true, codeValid: false, isActiveMember: true }),
        { maxPerWindow: 10 },
      );
      expect(d.reason).toBe("invalid_code");
    });
  });

  describe("'ya eres miembro' (leagues.md §4 anti-abuso)", () => {
    it("pública: miembro activo no se une de nuevo", () => {
      const d = evaluateLeagueJoin(
        baseState({ isActiveMember: true }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("already_member");
    });

    it("privada: miembro activo con código válido → 'ya eres miembro' (no 'ok')", () => {
      const d = evaluateLeagueJoin(
        baseState({ type: "private", codeProvided: true, codeValid: true, isActiveMember: true }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("already_member");
    });
  });

  describe("'la liga está llena' (leagues.md §2: abierta con límite)", () => {
    it("miembros activos = máximo: se rechaza", () => {
      const d = evaluateLeagueJoin(
        baseState({ activeMembers: 50, maxMembers: 50 }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("league_full");
    });

    it("miembros activos > máximo (defensivo): se rechaza", () => {
      const d = evaluateLeagueJoin(
        baseState({ activeMembers: 51, maxMembers: 50 }),
        { maxPerWindow: 10 },
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("league_full");
    });

    it("'ya eres miembro' tiene prioridad sobre 'llena' (un miembro de una liga llena se lo dice primero)", () => {
      const d = evaluateLeagueJoin(
        baseState({ activeMembers: 50, maxMembers: 50, isActiveMember: true }),
        { maxPerWindow: 10 },
      );
      expect(d.reason).toBe("already_member");
    });
  });
});

describe("shouldLockLeagueJoin (espejo de shouldLockAccount, US-01)", () => {
  it("fallos < umbral: no bloquea", () => {
    expect(shouldLockLeagueJoin(4, { lockoutThreshold: 5 })).toBe(false);
  });

  it("fallos = umbral: bloquea", () => {
    expect(shouldLockLeagueJoin(5, { lockoutThreshold: 5 })).toBe(true);
  });

  it("fallos > umbral: bloquea", () => {
    expect(shouldLockLeagueJoin(6, { lockoutThreshold: 5 })).toBe(true);
  });
});
