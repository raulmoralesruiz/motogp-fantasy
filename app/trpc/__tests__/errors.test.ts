/**
 * Normalización de issues de Zod del error tRPC (T-24): la UI muestra los
 * mensajes por campo; aquí se cubren los formatos que viajan en
 * `error.data.zod` (array directo u objeto con `issues`).
 */
import { describe, expect, it } from "vitest";

import { zodIssues } from "../errors";

describe("zodIssues", () => {
  it("extrae los issues cuando `data.zod` es un array", () => {
    const issues = zodIssues({
      data: { zod: [{ path: ["email"], message: "Email no válido" }] },
    });
    expect(issues).toEqual([{ path: ["email"], message: "Email no válido" }]);
  });

  it("extrae los issues cuando `data.zod` es { issues: [...] }", () => {
    const issues = zodIssues({
      data: { zod: { issues: [{ path: ["password"], message: "Contraseña corta" }] } },
    });
    expect(issues).toEqual([{ path: ["password"], message: "Contraseña corta" }]);
  });

  it("devuelve [] si el error no trae data", () => {
    expect(zodIssues(null)).toEqual([]);
    expect(zodIssues(undefined)).toEqual([]);
    expect(zodIssues({})).toEqual([]);
    expect(zodIssues(new Error("boom"))).toEqual([]);
  });

  it("devuelve [] si `data.zod` no tiene la forma esperada", () => {
    expect(zodIssues({ data: { zod: "no" } })).toEqual([]);
    expect(zodIssues({ data: { zod: { issues: "no" } } })).toEqual([]);
    expect(zodIssues({ data: {} })).toEqual([]);
  });
});
