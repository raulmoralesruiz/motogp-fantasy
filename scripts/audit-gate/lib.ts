/**
 * Gate de vulnerabilidades de dependencias (T-21, ADR-0038) — lógica PURA.
 *
 * Recibe el JSON de `npm audit --json` y el baseline de excepciones
 * conocidas (`audit-baseline.json` en la raíz del repo) y decide si el
 * estado de vulnerabilidades altas/críticas es aceptable:
 *
 * - Cualquier hallazgo high/critical **no** cubierto por el baseline →
 *   fallo: no se admiten vulnerabilidades nuevas sin revisión explícita.
 * - Cualquier entrada del baseline que **ya no** aparece → fallo: el
 *   baseline debe mantenerse limpio; si el hallazgo se resolvió, se
 *   elimina la entrada (en el mismo commit que la solución).
 *
 * La CLI (`cli.ts`) es la que ejecuta `npm audit` y lee el baseline de
 * disco; este módulo no hace I/O (patrón de `check-purity`, T-03).
 */

/** Severidades que emite `npm audit`. */
export type AuditSeverity = "info" | "low" | "moderate" | "high" | "critical";

/** Severidades que el gate vigila (las que bloquean). */
export type BaselineSeverity = "high" | "critical";

/** Campo relevante de cada entrada del mapa `vulnerabilities` de `npm audit --json`. */
export interface AuditVulnerability {
  severity: AuditSeverity;
  fixAvailable?: boolean;
}

/** Forma (parcial) del JSON de `npm audit --json` que usa el gate. */
export interface AuditReport {
  vulnerabilities?: Record<string, AuditVulnerability>;
}

/** Una excepción justificada y conocida (una por paquete). */
export interface AuditBaselineEntry {
  package: string;
  severity: BaselineSeverity;
  /** Justificación en español: por qué se acepta temporalmente. */
  reason: string;
  /** Tarea que cierra el hallazgo (p. ej. "T-23 (zod 4)"). */
  closure?: string;
}

/** `audit-baseline.json` (raíz del repo). */
export interface AuditBaseline {
  version: number;
  threshold: BaselineSeverity[];
  known: AuditBaselineEntry[];
}

/** Clase de fallo del gate. */
export type AuditGateFailureKind =
  | "invalid-baseline"
  | "new-vulnerability"
  | "stale-baseline-entry";

export interface AuditGateFailure {
  kind: AuditGateFailureKind;
  package?: string;
  severity?: BaselineSeverity;
  /** Motivo legible (español). */
  message: string;
}

/** Hallazgo cubierto por el baseline (con su justificación). */
export interface AuditAllowedEntry {
  package: string;
  severity: BaselineSeverity;
  reason: string;
  closure?: string;
}

export interface AuditGateResult {
  ok: boolean;
  failures: AuditGateFailure[];
  /** Hallazgos dentro del umbral cubiertos por el baseline. */
  allowed: AuditAllowedEntry[];
  counts: {
    /** Hallazgos actuales dentro del umbral (high/critical). */
    inThreshold: number;
    allowed: number;
    newVulnerabilities: number;
    staleEntries: number;
  };
}

export interface BaselineParseResult {
  ok: boolean;
  baseline: AuditBaseline | null;
  failures: AuditGateFailure[];
}

function isBaselineSeverity(v: unknown): v is BaselineSeverity {
  return v === "high" || v === "critical";
}

function fail(
  kind: AuditGateFailureKind,
  message: string,
  pkg?: string,
  severity?: BaselineSeverity,
): AuditGateFailure {
  return { kind, message, ...(pkg !== undefined ? { package: pkg } : {}), ...(severity !== undefined ? { severity } : {}) };
}

/**
 * Valida la estructura de `audit-baseline.json`. No se valida en
 * `evaluateAudit` (que recibe un baseline ya parseado): separar ambas
 * responsabilidades mantiene `evaluateAudit` pura y testable.
 */
export function parseAuditBaseline(raw: unknown): BaselineParseResult {
  const failures: AuditGateFailure[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      baseline: null,
      failures: [fail("invalid-baseline", "audit-baseline.json debe ser un objeto JSON")],
    };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.version !== "number" || !Number.isInteger(obj.version) || obj.version < 1) {
    failures.push(
      fail("invalid-baseline", `el campo "version" debe ser un entero ≥ 1 (ahora: ${JSON.stringify(obj.version)})`),
    );
  }

  if (!Array.isArray(obj.threshold) || obj.threshold.length === 0 || !obj.threshold.every(isBaselineSeverity)) {
    failures.push(
      fail("invalid-baseline", `el campo "threshold" debe ser un array no vacío con severidades "high"/"critical" (ahora: ${JSON.stringify(obj.threshold)})`),
    );
  }

  if (!Array.isArray(obj.known)) {
    failures.push(fail("invalid-baseline", `el campo "known" debe ser un array (ahora: ${JSON.stringify(typeof obj.known)})`));
    return { ok: false, baseline: null, failures };
  }

  const known: AuditBaselineEntry[] = [];
  const seen = new Set<string>();
  for (const [i, entryRaw] of (obj.known as unknown[]).entries()) {
    if (typeof entryRaw !== "object" || entryRaw === null || Array.isArray(entryRaw)) {
      failures.push(fail("invalid-baseline", `known[${i}] debe ser un objeto`));
      continue;
    }
    const entry = entryRaw as Record<string, unknown>;
    if (typeof entry.package !== "string" || entry.package.trim() === "") {
      failures.push(fail("invalid-baseline", `known[${i}].package debe ser un string no vacío`));
      continue;
    }
    if (!isBaselineSeverity(entry.severity)) {
      failures.push(
        fail("invalid-baseline", `known[${i}].severity debe ser "high" o "critical" (ahora: ${JSON.stringify(entry.severity)})`),
      );
      continue;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      failures.push(fail("invalid-baseline", `known[${i}].reason: cada excepción exige una justificación`));
      continue;
    }
    if (entry.closure !== undefined && (typeof entry.closure !== "string" || entry.closure.trim() === "")) {
      failures.push(fail("invalid-baseline", `known[${i}].closure debe ser un string no vacío (o omitirse)`));
      continue;
    }
    if (seen.has(entry.package)) {
      failures.push(fail("invalid-baseline", `known: paquete duplicado "${entry.package}" (uno por paquete — npm reporta una severidad máxima por paquete)`));
      continue;
    }
    seen.add(entry.package);
    known.push({
      package: entry.package,
      severity: entry.severity,
      reason: entry.reason,
      ...(entry.closure !== undefined ? { closure: entry.closure as string } : {}),
    });
  }

  if (failures.length > 0) return { ok: false, baseline: null, failures };
  return {
    ok: true,
    baseline: {
      version: obj.version as number,
      threshold: obj.threshold as BaselineSeverity[],
      known,
    },
    failures: [],
  };
}

/**
 * Decide si el estado de vulnerabilidades del informe de `npm audit` es
 * aceptable según el baseline (T-21, ADR-0038):
 *
 * - hallazgo high/critical **nuevo** (no en el baseline) → fallo;
 * - entrada del baseline **obsoleta** (ya no aparece, o con otra
 *   severidad) → fallo: actualizar el baseline en el mismo commit.
 *
 * Devuelve `allowed` (hallazgos cubiertos, con su justificación) para que
 * la CLI/CI los muestren: la excepción visible es la excepción auditada.
 */
export function evaluateAudit(report: AuditReport, baseline: AuditBaseline): AuditGateResult {
  const threshold = new Set<BaselineSeverity>(baseline.threshold);
  const vulnerabilities = report?.vulnerabilities ?? {};

  const current: { package: string; severity: BaselineSeverity; fixAvailable: boolean }[] = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (entry && isBaselineSeverity(entry.severity) && threshold.has(entry.severity)) {
      current.push({ package: name, severity: entry.severity, fixAvailable: entry.fixAvailable === true });
    }
  }

  const covered = new Map<string, BaselineSeverity>();
  for (const entry of baseline.known) covered.set(entry.package, entry.severity);

  const failures: AuditGateFailure[] = [];
  const allowed: AuditAllowedEntry[] = [];
  const stale = new Set<string>();

  for (const v of current) {
    if (covered.get(v.package) === v.severity) {
      const entry = baseline.known.find((e) => e.package === v.package)!;
      allowed.push({ package: entry.package, severity: entry.severity, reason: entry.reason, closure: entry.closure });
    } else {
      failures.push(
        fail(
          "new-vulnerability",
          `vulnerabilidad ${v.severity} en "${v.package}" no está en audit-baseline.json — no se admiten hallazgos nuevos sin revisión explícita (ADR-0038).` +
            (v.fixAvailable
              ? " npm informa de arreglo disponible: `npm audit fix` (o actualizar la dependencia)."
              : " Sin arreglo sin cambiar de versión mayor (cierra T-23); si se acepta temporalmente, añadir entrada justificada (motivo + cierre) a audit-baseline.json en el mismo commit."),
          v.package,
          v.severity,
        ),
      );
    }
  }

  for (const entry of baseline.known) {
    if (!current.some((v) => v.package === entry.package && v.severity === entry.severity)) {
      stale.add(entry.package);
      failures.push(
        fail(
          "stale-baseline-entry",
          `"${entry.package}" (${entry.severity}) ya no aparece en npm audit — eliminar la entrada de audit-baseline.json en el mismo commit (el baseline solo cubre hallazgos presentes).` +
            (entry.closure ? ` Cierre previsto: ${entry.closure}.` : ""),
          entry.package,
          entry.severity,
        ),
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    allowed,
    counts: {
      inThreshold: current.length,
      allowed: allowed.length,
      newVulnerabilities: current.length - allowed.length,
      staleEntries: stale.size,
    },
  };
}
