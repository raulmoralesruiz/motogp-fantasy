import { describe, expect, it } from "vitest";

import { evaluateCors } from "../cors";

const DOMINIO = "motogp.raulmorales.eu";

describe("evaluateCors (T-20)", () => {
  describe("sin cabecera Origin", () => {
    it("deja pasar GET (páginas, health-check, curl)", () => {
      expect(evaluateCors({ method: "GET", origin: null, host: DOMINIO })).toEqual({
        kind: "pass",
      });
    });

    it("deja pasar POST sin Origin (llamadas de infraestructura)", () => {
      expect(evaluateCors({ method: "POST", origin: null, host: DOMINIO })).toEqual({
        kind: "pass",
      });
    });
  });

  describe("con Origin permitido (reflejo de host)", () => {
    it("POST same-origin: pasa y devuelve el origen a añadir como ACAO", () => {
      expect(
        evaluateCors({ method: "POST", origin: `https://${DOMINIO}`, host: DOMINIO }),
      ).toEqual({ kind: "pass", allowOrigin: `https://${DOMINIO}` });
    });

    it("acceso LAN con puerto: http://192.168.1.3:22020 coincide con Host", () => {
      expect(
        evaluateCors({
          method: "POST",
          origin: "http://192.168.1.3:22020",
          host: "192.168.1.3:22020",
        }),
      ).toEqual({ kind: "pass", allowOrigin: "http://192.168.1.3:22020" });
    });

    it("es insensible a mayúsculas/minúsculas del Host", () => {
      expect(
        evaluateCors({
          method: "POST",
          origin: `https://${DOMINIO}`,
          host: DOMINIO.toUpperCase(),
        }),
      ).toEqual({ kind: "pass", allowOrigin: `https://${DOMINIO}` });
    });

    it("preflight OPTIONS: 204 con cabeceras CORS", () => {
      const outcome = evaluateCors({
        method: "OPTIONS",
        origin: `https://${DOMINIO}`,
        host: DOMINIO,
      });
      expect(outcome.kind).toBe("preflight");
      if (outcome.kind === "preflight") {
        expect(outcome.headers).toEqual({
          "access-control-allow-origin": `https://${DOMINIO}`,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
          vary: "Origin",
        });
      }
    });
  });

  describe("con Origin denegado", () => {
    it("origen distinto → reject (POST)", () => {
      expect(
        evaluateCors({ method: "POST", origin: "https://evil.example", host: DOMINIO }),
      ).toEqual({ kind: "reject" });
    });

    it("subdominio de ataque (prefijo distinto) → reject", () => {
      expect(
        evaluateCors({
          method: "POST",
          origin: `https://evil-${DOMINIO}`,
          host: DOMINIO,
        }),
      ).toEqual({ kind: "reject" });
    });

    it("puerto distinto → reject", () => {
      expect(
        evaluateCors({
          method: "POST",
          origin: "http://192.168.1.3:22021",
          host: "192.168.1.3:22020",
        }),
      ).toEqual({ kind: "reject" });
    });

    it("preflight OPTIONS de origen distinto → reject", () => {
      expect(
        evaluateCors({ method: "OPTIONS", origin: "https://evil.example", host: DOMINIO }),
      ).toEqual({ kind: "reject" });
    });

    it("origin malformado → reject", () => {
      expect(
        evaluateCors({ method: "POST", origin: "no-es-una-url", host: DOMINIO }),
      ).toEqual({ kind: "reject" });
    });

    it("origin opaco (literal 'null') → reject", () => {
      expect(
        evaluateCors({ method: "POST", origin: "null", host: DOMINIO }),
      ).toEqual({ kind: "reject" });
    });

    it("sin cabecera Host → reject", () => {
      expect(
        evaluateCors({ method: "POST", origin: `https://${DOMINIO}`, host: null }),
      ).toEqual({ kind: "reject" });
    });
  });
});
