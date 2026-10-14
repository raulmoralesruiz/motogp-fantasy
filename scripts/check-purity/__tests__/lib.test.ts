/**
 * Tests del scanner de pureza (T-03).
 *
 * El scanner es una función pura: recibe archivos (ruta + contenido) y
 * devuelve violaciones. Aquí se usan fixtures en línea (sin disco).
 */
import { describe, expect, it } from "vitest";

import { findPurityViolations, type ScannedFile } from "../lib.js";

const CONFIG = {
  moduleRoots: ["app/modules/economy", "app/modules/scoring"],
  allowedExternalDirs: ["app/shared/types"],
};

const file = (path: string, content: string): ScannedFile => ({ path, content });

const rules = (files: ScannedFile[]): string[] =>
  findPurityViolations(files, CONFIG)
    .map((v) => v.rule)
    .sort();

describe("findPurityViolations — archivos limpios", () => {
  it("no viola con imports internos y shared/types", () => {
    const src = [
      'import type { Lineup } from "../../shared/types/index.js";',
      'import { computeNextPrice } from "./pricing.js";',
      'export * from "./budget.js";',
      "export const x = 1;",
    ].join("\n");
    expect(rules([file("app/modules/economy/budget.ts", src)])).toEqual([]);
  });

  it("permite el alias @/shared/types", () => {
    const src = 'import type { Lineup } from "@/shared/types/index.js";';
    expect(rules([file("app/modules/scoring/engine.ts", src)])).toEqual([]);
  });

  it("permite librerías puras (p. ej. zod)", () => {
    const src = 'import { z } from "zod";';
    expect(rules([file("app/modules/economy/budget.ts", src)])).toEqual([]);
  });

  it("ignora archivos fuera de las raíces de módulo", () => {
    const src = 'import { readFileSync } from "node:fs";';
    expect(rules([file("app/modules/lineups/validate.ts", src)])).toEqual([]);
  });
});

describe("findPurityViolations — io-import", () => {
  it("detecta node:fs", () => {
    expect(
      rules([file("app/modules/economy/a.ts", 'import fs from "node:fs";')]),
    ).toEqual(["io-import"]);
  });

  it("detecta fs/promises", () => {
    expect(
      rules([
        file("app/modules/economy/a.ts", 'import { readFileSync } from "fs/promises";'),
      ]),
    ).toEqual(["io-import"]);
  });

  it("detecta imports de efecto secundario", () => {
    expect(rules([file("app/modules/economy/a.ts", 'import "node:net";')])).toEqual([
      "io-import",
    ]);
  });

  it("detecta import dinámico", () => {
    const src = 'const m = await import("node:http");';
    expect(rules([file("app/modules/economy/a.ts", src)])).toEqual(["io-import"]);
  });

  it("detecta imports multilinea", () => {
    const src = 'import {\n  readFileSync,\n  writeFileSync,\n} from "node:fs";';
    expect(rules([file("app/modules/scoring/a.ts", src)])).toEqual(["io-import"]);
  });
});

describe("findPurityViolations — infra-import", () => {
  const cases: [string, string][] = [
    ["@prisma/client", 'import { PrismaClient } from "@prisma/client";'],
    ["ioredis", 'import { Redis } from "ioredis";'],
    ["bullmq", 'import { Queue } from "bullmq";'],
    ["next", 'import next from "next";'],
    ["@trpc/server", 'import { initTRPC } from "@trpc/server";'],
    ["@trpc/client", 'import { createTRPCClient } from "@trpc/client";'],
    ["react", 'import React from "react";'],
  ];

  it.each(cases)("%s", (pkg, src) => {
    const violations = findPurityViolations(
      [file("app/modules/economy/a.ts", src)],
      CONFIG,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("infra-import");
    expect(violations[0]?.reason).toContain(pkg);
  });
});

describe("findPurityViolations — external-import", () => {
  it("detecta imports relativos fuera del módulo", () => {
    const src = 'import { prisma } from "../../server/prisma.js";';
    expect(rules([file("app/modules/economy/budget.ts", src)])).toEqual([
      "external-import",
    ]);
  });

  it("detecta imports de otro módulo", () => {
    const src = 'import { lineupPoints } from "../scoring/engine.js";';
    expect(rules([file("app/modules/economy/budget.ts", src)])).toEqual([
      "external-import",
    ]);
  });

  it("detecta imports por alias @/ fuera del módulo", () => {
    const src = 'import { lineupPoints } from "@/modules/scoring/engine.js";';
    expect(rules([file("app/modules/economy/budget.ts", src)])).toEqual([
      "external-import",
    ]);
  });

  it("detecta imports @/server", () => {
    const src = 'import { prisma } from "@/server/prisma.js";';
    expect(rules([file("app/modules/scoring/engine.ts", src)])).toEqual([
      "external-import",
    ]);
  });
});

describe("findPurityViolations — clock", () => {
  it("detecta Date.now()", () => {
    expect(rules([file("app/modules/economy/a.ts", "const t = Date.now();")])).toEqual([
      "clock",
    ]);
  });

  it("detecta new Date()", () => {
    expect(rules([file("app/modules/scoring/a.ts", "const d = new Date();")])).toEqual([
      "clock",
    ]);
  });

  it("no detecta Date en comentarios ni cadenas", () => {
    const src = [
      "// el reloj está prohibido: Date.now() y new Date()",
      'const msg = "no uses Date.now() nunca";',
      "const ok = 1;",
    ].join("\n");
    expect(rules([file("app/modules/economy/a.ts", src)])).toEqual([]);
  });

  it("informa la línea de la violación", () => {
    const src = "const a = 1;\nconst t = Date.now();";
    const violations = findPurityViolations(
      [file("app/modules/economy/a.ts", src)],
      CONFIG,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(2);
  });
});
