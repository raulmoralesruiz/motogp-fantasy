import { describe, expect, it } from "vitest";

import {
  deleteAccountInputSchema,
  updateProfileInputSchema,
} from "../profile";

describe("profile · validación (US-03)", () => {
  describe("updateProfileInputSchema", () => {
    it("acepta un nombre visible válido y lo trimea", () => {
      const r = updateProfileInputSchema.safeParse({ displayName: "  Ana GP  " });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.displayName).toBe("Ana GP");
      }
    });

    it("rechaza nombre visible corto o largo", () => {
      expect(
        updateProfileInputSchema.safeParse({ displayName: "ab" }).success,
      ).toBe(false);
      expect(
        updateProfileInputSchema.safeParse({
          displayName: "x".repeat(41),
        }).success,
      ).toBe(false);
    });

    it("rechaza nombre visible vacío tras el trim", () => {
      expect(updateProfileInputSchema.safeParse({ displayName: "   " }).success).toBe(
        false,
      );
    });
  });

  describe("deleteAccountInputSchema", () => {
    it("acepta una contraseña no vacía", () => {
      expect(
        deleteAccountInputSchema.safeParse({ password: "cualquier-cosa" }).success,
      ).toBe(true);
    });

    it("rechaza contraseña vacía", () => {
      expect(deleteAccountInputSchema.safeParse({ password: "" }).success).toBe(false);
    });

    it("rechaza contraseña demasiado larga", () => {
      expect(
        deleteAccountInputSchema.safeParse({ password: "x".repeat(129) }).success,
      ).toBe(false);
    });
  });
});
