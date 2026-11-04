/**
 * Tests del núcleo TOTP (D-07, ADR-0039): `core/totp.ts` es puro (sin I/O
 * ni reloj real) y se testea contra los vectores oficiales:
 * - RFC 4226 (HOTP, SHA-1, 6 dígitos, secreto "12345678901234567890").
 * - RFC 6238 (TOTP, SHA-1, 8 dígitos, paso 30 s, mismo secreto).
 * - RFC 4648 (base32).
 *
 * El reloj llega inyectado en ms (no hay `Date.now()` en el módulo).
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  computeTotp,
  verifyTotpCode,
} from "../totp";

/** Secreto de los vectores del RFC: "12345678901234567890" en base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32 (RFC 4648)", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];

  it("codifica los vectores del RFC 4648", () => {
    for (const [text, encoded] of vectors) {
      expect(base32Encode(new Uint8Array(Buffer.from(text, "utf8")))).toBe(encoded);
    }
  });

  it("decodifica los vectores del RFC 4648", () => {
    for (const [text, encoded] of vectors) {
      if (encoded === "") continue;
      const decoded = Buffer.from(base32Decode(encoded)).toString("utf8");
      expect(decoded).toBe(text);
    }
  });

  it("es tolerante con minúsculas, espacios y guiones", () => {
    const bytes = new Uint8Array(Buffer.from("secret", "utf8"));
    const encoded = base32Encode(bytes);
    const sloppy = encoded.toLowerCase().replace(/(.{4})(?!$)/g, "$1 ");
    expect(base32Decode(sloppy)).toEqual(bytes);
  });

  it("rechaza caracteres fuera del alfabeto (0, 1, 8, 9, símbolos)", () => {
    for (const bad of ["0", "1", "8", "9", "!", "?"]) {
      expect(() => base32Decode(`MAAAA${bad}`)).toThrow(/inválido|vacío/);
    }
  });

  it("acepta I y O (están en el alfabeto base32 del RFC 4648)", () => {
    const bytes = base32Decode("MAAAAI");
    expect(bytes.length).toBe(3);
    expect(() => base32Decode("O")).not.toThrow();
  });

  it("rechaza el texto vacío", () => {
    expect(() => base32Decode("   ")).toThrow(/vacío/);
  });
});

describe("computeTotp — RFC 4226 (HOTP) y RFC 6238 (TOTP)", () => {
  it("reproduce los 10 vectores del RFC 4226 (SHA-1, 6 dígitos)", () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    // HOTP(counter) = TOTP(t = counter * 30 s) con paso 30 s.
    expected.forEach((code, counter) => {
      const timeMs = counter * 30_000;
      expect(computeTotp(RFC_SECRET, timeMs, { periodSec: 30, digits: 6 })).toBe(
        code,
      );
    });
  });

  it("reproduce los 6 vectores del RFC 6238 (SHA-1, 8 dígitos, paso 30 s)", () => {
    const vectors: [number, string][] = [
      [59, "94287082"],
      [1111111109, "07081804"],
      [1111111111, "14050471"],
      [1234567890, "89005924"],
      [2000000000, "69279037"],
      [20000000000, "65353130"],
    ];
    for (const [tSec, code] of vectors) {
      expect(computeTotp(RFC_SECRET, tSec * 1000, { periodSec: 30, digits: 8 })).toBe(
        code,
      );
    }
  });

  it("usa los defaults RFC 6238 (6 dígitos, paso 30 s)", () => {
    const withDefaults = computeTotp(RFC_SECRET, 59_000);
    const explicit = computeTotp(RFC_SECRET, 59_000, { periodSec: 30, digits: 6 });
    expect(withDefaults).toBe(explicit);
    expect(withDefaults).toMatch(/^\d{6}$/);
  });

  it("rechaza fuera de rango el número de dígitos (4–8)", () => {
    expect(() => computeTotp(RFC_SECRET, 0, { digits: 3 })).toThrow(/dígitos/);
    expect(() => computeTotp(RFC_SECRET, 0, { digits: 9 })).toThrow(/dígitos/);
  });
});

describe("verifyTotpCode — ventana de tolerancia", () => {
  const t = 59_000; // el vector 94287082 del RFC 6238 (8 dígitos)
  const code = computeTotp(RFC_SECRET, t, { digits: 8 });
  const periodMs = 30_000;

  it("acepta el código del instante actual", () => {
    expect(verifyTotpCode(RFC_SECRET, code, t, { digits: 8 })).toBe(true);
  });

  it("acepta el código visto desde ±1 paso (desfase de reloj)", () => {
    // Verificando 30 s después, el código del paso anterior sigue válido.
    expect(verifyTotpCode(RFC_SECRET, code, t + periodMs, { digits: 8 })).toBe(
      true,
    );
    // Y viceversa.
    const next = computeTotp(RFC_SECRET, t + periodMs, { digits: 8 });
    expect(verifyTotpCode(RFC_SECRET, next, t, { digits: 8 })).toBe(true);
  });

  it("rechaza a 2 pasos de distancia (fuera de la ventana)", () => {
    const far = computeTotp(RFC_SECRET, t + 2 * periodMs, { digits: 8 });
    expect(verifyTotpCode(RFC_SECRET, far, t, { digits: 8 })).toBe(false);
  });

  it("es tolerante con espacios y mayúsculas del input", () => {
    expect(verifyTotpCode(RFC_SECRET, ` ${code} `, t, { digits: 8 })).toBe(true);
  });

  it("rechaza códigos con formato inválido sin lanzar", () => {
    for (const bad of ["", "12345", "12a456", "123456789", "  "]) {
      expect(verifyTotpCode(RFC_SECRET, bad, t, { digits: 8 })).toBe(false);
    }
  });

  it("rechaza un secreto no decodificable sin lanzar", () => {
    expect(verifyTotpCode("NO-ES-BASE32-!?", "123456", t)).toBe(false);
    expect(verifyTotpCode("AAAA", "12345", t)).toBe(false); // 5 dígitos
  });
});

describe("buildOtpAuthUri (provisioning)", () => {
  it("monta una URI otpauth:// con el secreto, issuer y parámetros", () => {
    const uri = buildOtpAuthUri({
      issuer: "FantasyMotoGP",
      account: "admin@liga.com",
      secretBase32: RFC_SECRET,
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain("issuer=FantasyMotoGP");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });

  it("codifica el label `issuer:account` (URL-encoded)", () => {
    const uri = buildOtpAuthUri({
      issuer: "Mi Liga & Co",
      account: "a@b.com",
      secretBase32: RFC_SECRET,
    });
    // El label es el primer path segment, antes del "?".
    const label = uri.slice("otpauth://totp/".length, uri.indexOf("?"));
    expect(decodeURIComponent(label)).toBe("Mi Liga & Co:a@b.com");
  });
});
