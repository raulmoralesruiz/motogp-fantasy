import { describe, expect, it } from "vitest";

import { loginInputSchema, registerInputSchema } from "../auth";

describe("auth · validación (US-01)", () => {
  it("acepta un registro válido y normaliza el email", () => {
    const r = registerInputSchema.safeParse({
      email: "Ana@Example.com ",
      username: "ana_1",
      password: "supersecreta",
      termsAccepted: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("ana@example.com");
      expect(r.data.username).toBe("ana_1");
    }
  });

  it("rechaza username corto o con caracteres inválidos", () => {
    const base = { email: "a@b.co", password: "12345678", termsAccepted: true };
    expect(registerInputSchema.safeParse({ ...base, username: "ab" }).success).toBe(
      false,
    );
    expect(registerInputSchema.safeParse({ ...base, username: "ana-1" }).success).toBe(
      false,
    );
    expect(registerInputSchema.safeParse({ ...base, username: "ana 1" }).success).toBe(
      false,
    );
  });

  it("rechaza contraseña corta", () => {
    const r = registerInputSchema.safeParse({
      email: "a@b.co",
      username: "ana_1",
      password: "corta",
      termsAccepted: true,
    });
    expect(r.success).toBe(false);
  });

  it("exige aceptar los términos", () => {
    const r = registerInputSchema.safeParse({
      email: "a@b.co",
      username: "ana_1",
      password: "12345678",
      termsAccepted: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe(
        "Debes aceptar los términos y la política de privacidad",
      );
    }
  });

  it("login: exige email + contraseña no vacía (sin longitud mínima)", () => {
    expect(loginInputSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(
      false,
    );
    expect(loginInputSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(
      true,
    );
    expect(loginInputSchema.safeParse({ email: "no-email", password: "x" }).success).toBe(
      false,
    );
  });
});
