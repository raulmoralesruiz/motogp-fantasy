/**
 * Tests del gate de vulnerabilidades de dependencias (T-21, ADR-0038).
 *
 * La lógica es pura: recibe el JSON de `npm audit --json` y el baseline
 * (o su parseo) y devuelve fallos. Aquí se usan fixtures en línea (sin
 * disco ni npm), igual que el scanner de pureza (T-03).
 */
import { describe, expect, it } from "vitest";

import {
  evaluateAudit,
  parseAuditBaseline,
  type AuditBaseline,
  type AuditReport,
  type AuditSeverity,
} from "../lib.js";

const BASELINE: AuditBaseline = {
  version: 1,
  threshold: ["high", "critical"],
  known: [
    {
      package: "next",
      severity: "critical",
      reason: "no usamos next/image ni server actions",
      closure: "T-23 (next 16)",
    },
    { package: "zod", severity: "high", reason: "inputs acotados" },
  ],
};

const reportWith = (
  ...vulns: Array<[name: string, severity: AuditSeverity, fixAvailable?: boolean]>
): AuditReport => ({
  vulnerabilities: Object.fromEntries(
    vulns.map(([name, severity, fixAvailable = true]) => [
      name,
      { severity, fixAvailable },
    ]),
  ),
});

describe("parseAuditBaseline", () => {
  it("acepta un baseline válido", () => {
    const parsed = parseAuditBaseline(BASELINE);
    expect(parsed.ok).toBe(true);
    expect(parsed.baseline).toEqual(BASELINE);
    expect(parsed.failures).toEqual([]);
  });

  it("rechaza un baseline que no es un objeto", () => {
    for (const raw of [null, "texto", 42, ["known"]]) {
      const parsed = parseAuditBaseline(raw);
      expect(parsed.ok).toBe(false);
      expect(parsed.baseline).toBeNull();
      expect(parsed.failures[0]?.kind).toBe("invalid-baseline");
    }
  });

  it("rechaza version inválido", () => {
    for (const version of ["1", 0, 1.5, undefined]) {
      const parsed = parseAuditBaseline({ ...BASELINE, version });
      expect(parsed.ok).toBe(false);
      expect(parsed.failures.some((f) => f.message.includes("version"))).toBe(true);
    }
  });

  it("rechaza threshold vacío o con severidades fuera del umbral", () => {
    for (const threshold of [[], ["low"], ["moderate", "high"], "high"]) {
      const parsed = parseAuditBaseline({ ...BASELINE, threshold });
      expect(parsed.ok).toBe(false);
      expect(parsed.failures.some((f) => f.message.includes("threshold"))).toBe(true);
    }
  });

  it("rechaza known no array", () => {
    const parsed = parseAuditBaseline({ ...BASELINE, known: "known" });
    expect(parsed.ok).toBe(false);
  });

  it("rechaza entradas incompletas o inválidas", () => {
    const badEntries = [
      "no-objeto",
      { package: "", severity: "high", reason: "x" },
      { package: "zod", severity: "low", reason: "x" },
      { package: "zod", severity: "high", reason: "  " },
      { package: "zod", severity: "high", reason: "x", closure: 42 },
    ];
    for (const bad of badEntries) {
      const parsed = parseAuditBaseline({ ...BASELINE, known: [bad] });
      expect(parsed.ok, JSON.stringify(bad)).toBe(false);
      expect(parsed.failures.every((f) => f.kind === "invalid-baseline")).toBe(true);
    }
  });

  it("rechaza paquetes duplicados en known", () => {
    const parsed = parseAuditBaseline({
      ...BASELINE,
      known: [
        { package: "zod", severity: "high", reason: "a" },
        { package: "zod", severity: "critical", reason: "b" },
      ],
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.failures.some((f) => f.message.includes("duplicado"))).toBe(true);
  });
});

describe("evaluateAudit — estado aceptado", () => {
  it("pasa si todos los hallazgos high/critical están en el baseline", () => {
    const result = evaluateAudit(
      reportWith(["next", "critical", false], ["zod", "high", false]),
      BASELINE,
    );
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.counts).toEqual({
      inThreshold: 2,
      allowed: 2,
      newVulnerabilities: 0,
      staleEntries: 0,
    });
    expect(result.allowed.map((a) => a.package).sort()).toEqual(["next", "zod"]);
    expect(result.allowed[0]?.reason).toBe(BASELINE.known[0]?.reason);
  });

  it("ignora severidades fuera del umbral (low/moderate)", () => {
    const result = evaluateAudit(
      reportWith(
        ["next", "critical", false],
        ["zod", "high", false],
        ["lodash", "moderate", true],
        ["some-lib", "low", false],
        ["other-lib", "info", true],
      ),
      BASELINE,
    );
    expect(result.ok).toBe(true);
    expect(result.counts.inThreshold).toBe(2);
  });

  it("pasa con un informe sin vulnerabilidades y baseline vacío", () => {
    const result = evaluateAudit(
      { vulnerabilities: {} },
      { version: 1, threshold: ["high", "critical"], known: [] },
    );
    expect(result.ok).toBe(true);
    expect(result.counts.inThreshold).toBe(0);
  });
});

describe("evaluateAudit — hallazgos nuevos (fallo)", () => {
  it("falla con una high nueva no cubierta por el baseline", () => {
    const result = evaluateAudit(reportWith(["zod", "high"], ["axios", "high"]), BASELINE);
    expect(result.ok).toBe(false);
    expect(result.counts.newVulnerabilities).toBe(1);
    const failure = result.failures.find((f) => f.kind === "new-vulnerability")!;
    expect(failure.package).toBe("axios");
    expect(failure.severity).toBe("high");
    expect(failure.message).toContain("axios");
    expect(failure.message).toContain("audit-baseline.json");
    expect(failure.message).toContain("npm audit fix");
  });

  it("falla con una critical nueva y sin fix disponible indica T-23/revisión", () => {
    const result = evaluateAudit(
      reportWith(["next", "critical", false], ["ioredis", "critical", false]),
      BASELINE,
    );
    expect(result.ok).toBe(false);
    const failure = result.failures.find((f) => f.package === "ioredis")!;
    expect(failure.kind).toBe("new-vulnerability");
    expect(failure.severity).toBe("critical");
    expect(failure.message).toContain("cambiar de versión mayor");
    expect(failure.message).not.toContain("npm audit fix");
  });

  it("falla si la severidad empeora respecto al baseline (high → critical)", () => {
    const result = evaluateAudit(
      reportWith(["zod", "critical"], ["next", "critical"]),
      BASELINE,
    );
    expect(result.ok).toBe(false);
    const kinds = result.failures.map((f) => f.kind).sort();
    expect(kinds).toEqual(["new-vulnerability", "stale-baseline-entry"]);
  });
});

describe("evaluateAudit — baseline obsoleto (fallo)", () => {
  it("falla si una entrada del baseline ya no aparece en el informe", () => {
    const result = evaluateAudit(reportWith(["next", "critical"]), BASELINE);
    expect(result.ok).toBe(false);
    expect(result.counts.staleEntries).toBe(1);
    const failure = result.failures.find((f) => f.kind === "stale-baseline-entry")!;
    expect(failure.package).toBe("zod");
    expect(failure.message).toContain("eliminar la entrada");
  });

  it("menciona la tarea de cierre si la entrada la llevaba", () => {
    const result = evaluateAudit(reportWith(["zod", "high"]), BASELINE);
    expect(result.ok).toBe(false);
    const failure = result.failures.find((f) => f.package === "next")!;
    expect(failure.message).toContain("T-23 (next 16)");
  });
});

describe("evaluateAudit — informe con la forma real de npm audit", () => {
  it("resuelve el estado actual del repo (11 hallazgos cubiertos por el baseline)", () => {
    // Espejo del resultado de `npm audit` en la fecha de creación (ADR-0038):
    // 4 critical + 7 high; low/moderate presentes pero fuera del umbral.
    const real = reportWith(
      ["@vitest/coverage-v8", "critical", false],
      ["next", "critical", false],
      ["tinypool", "critical", false],
      ["vitest", "critical", false],
      ["@prisma/config", "high", true],
      ["deepmerge-ts", "high", true],
      ["postcss", "high", true],
      ["prisma", "high", true],
      ["undici", "high", true],
      ["vite", "high", false],
      ["zod", "high", false],
      ["braces", "moderate", true],
      ["semver", "low", true],
    );
    const baseline: AuditBaseline = {
      version: 1,
      threshold: ["high", "critical"],
      known: Object.entries(real.vulnerabilities!)
        .filter(([, v]) => v.severity === "high" || v.severity === "critical")
        .map(([name, v]) => ({
          package: name,
          severity: v.severity as "high" | "critical",
          reason: "motivo",
        })),
    };
    const result = evaluateAudit(real, baseline);
    expect(result.ok).toBe(true);
    expect(result.counts.inThreshold).toBe(11);
    expect(result.counts.allowed).toBe(11);
    expect(result.counts.newVulnerabilities).toBe(0);
  });
});
