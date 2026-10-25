/**
 * Tests del código de invitación de liga — núcleo puro (US-23, leagues.md §4).
 *
 * CA: "el código generado tiene ≥8 caracteres de alta entropía (sin 0/O/1/I)
 * y es revocable (generar uno nuevo invalida el anterior, test)".
 *
 * Aquí se cubre la parte pura (generación): longitud, alfabeto sin
 * ambigüedades, rechazo de longitudes inválidas y determinismo con fuente
 * inyectada. La revocabilidad (rotación) se cubre en integración.
 */
import { describe, expect, it } from "vitest";

import {
  generateLeagueCode,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_DEFAULT_LENGTH,
  INVITE_CODE_MIN_LENGTH,
} from "../invite-code.js";

describe("generateLeagueCode (leagues.md §4)", () => {
  it("genera 10 caracteres por defecto", () => {
    const code = generateLeagueCode();
    expect(code).toHaveLength(INVITE_CODE_DEFAULT_LENGTH);
  });

  it("genera la longitud pedida (≥8)", () => {
    expect(generateLeagueCode(8)).toHaveLength(8);
    expect(generateLeagueCode(16)).toHaveLength(16);
  });

  it("usa solo el alfabeto sin ambigüedades (sin 0/O/1/I)", () => {
    // El alfabeto tiene 32 caracteres (24 letras sin I/O + 8 dígitos sin 0/1).
    expect(INVITE_CODE_ALPHABET).toHaveLength(32);
    for (const ambiguous of ["0", "O", "1", "I"]) {
      expect(INVITE_CODE_ALPHABET).not.toContain(ambiguous);
    }
    // Sin caracteres duplicados (32 posiciones distintas).
    expect(new Set(INVITE_CODE_ALPHABET.split("")).size).toBe(32);
    // 200 códigos generados: todos los caracteres del alfabeto permitido.
    const allowed = new Set(INVITE_CODE_ALPHABET.split(""));
    for (let i = 0; i < 200; i++) {
      const code = generateLeagueCode();
      for (const ch of code) {
        expect(allowed.has(ch)).toBe(true);
      }
    }
  });

  it("rechaza longitudes por debajo del mínimo (7)", () => {
    expect(() => generateLeagueCode(7)).toThrow(RangeError);
    expect(() => generateLeagueCode(0)).toThrow(RangeError);
  });

  it("rechaza longitudes no enteras", () => {
    expect(() => generateLeagueCode(8.5)).toThrow(RangeError);
  });

  it("es determinista con una fuente de aleatoriedad inyectada", () => {
    // Fuente fija: siempre el índice 5 (el carácter "F").
    const fixed = () => 5;
    expect(generateLeagueCode(8, fixed)).toBe("FFFFFFFF");
  });

  it("respeta la secuencia de la fuente inyectada", () => {
    // Índices: A(0), 9(31), 8(30), B(1), C(2), D(3), E(4), F(5), G(6), H(7).
    const seq = [0, 31, 30, 1, 2, 3, 4, 5, 6, 7];
    let i = 0;
    const source = () => seq[i++ % seq.length] ?? 0;
    expect(generateLeagueCode(10, source)).toBe("A98BCDEFGH");
  });

  it("usa el CSPRNG por defecto (códigos distintos entre sí)", () => {
    // Probabilidad de colisión de dos códigos de 10 chars ≈ 1/34^10 ≈ 5e-16.
    const codes = new Set(Array.from({ length: 50 }, () => generateLeagueCode()));
    expect(codes.size).toBe(50);
  });

  it("exponen los límites documentados (mínimo 8, por defecto 10)", () => {
    expect(INVITE_CODE_MIN_LENGTH).toBe(8);
    expect(INVITE_CODE_DEFAULT_LENGTH).toBe(10);
  });
});
