import { describe, expect, it } from "vitest";

import {
  ANONYMIZED_PASSWORD_SENTINEL,
  anonymizedEmail,
  anonymizedUsername,
} from "../account-service";

const USER_ID = "09a60526-8e6c-4acd-861d-880141a5278a";

describe("account-service · helpers puros (US-03, ADR-0016)", () => {
  describe("anonymizedEmail", () => {
    it("genera un placeholder determinista con el userId", () => {
      expect(anonymizedEmail(USER_ID)).toBe(
        "anonimizado.09a60526-8e6c-4acd-861d-880141a5278a@invalido.local",
      );
    });

    it("es determinista: mismo id → mismo placeholder", () => {
      expect(anonymizedEmail(USER_ID)).toBe(anonymizedEmail(USER_ID));
    });

    it("diferentes ids → placeholders distintos", () => {
      expect(anonymizedEmail(USER_ID)).not.toBe(anonymizedEmail("otro-id"));
    });
  });

  describe("anonymizedUsername", () => {
    it("genera un placeholder legible con los 8 primeros chars del id", () => {
      expect(anonymizedUsername(USER_ID)).toBe("usuario-eliminado-09a60526");
    });

    it("es determinista: mismo id → mismo placeholder", () => {
      expect(anonymizedUsername(USER_ID)).toBe(anonymizedUsername(USER_ID));
    });
  });

  describe("ANONYMIZED_PASSWORD_SENTINEL", () => {
    it("no es un hash argon2 válido (verifyPassword devuelve false)", async () => {
      const { verifyPassword } = await import("../password");
      expect(await verifyPassword("cualquier-contraseña", ANONYMIZED_PASSWORD_SENTINEL)).toBe(
        false,
      );
    });
  });
});
