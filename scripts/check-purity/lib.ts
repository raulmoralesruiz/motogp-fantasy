/**
 * Scanner de pureza de los módulos puros (`economy`, `scoring`) — T-03.
 *
 * FUNCIÓN PURA (sin I/O): recibe archivos (ruta + contenido) y devuelve las
 * violaciones encontradas. La CLI (`cli.ts`) es la que lee de disco.
 *
 * Reglas (AGENTS.md §3, backlog T-03):
 * - `io-import`: import de un módulo de I/O de Node (fs, net, http,
 *   child_process…).
 * - `infra-import`: import de infraestructura de la aplicación
 *   (@prisma/client, ioredis, bullmq, next, @trpc/*, react…).
 * - `external-import`: import relativo o alias `@/` que resuelve fuera del
 *   módulo (solo se permite `app/shared/types`).
 * - `clock`: uso del reloj (`Date.now()`, `new Date()`).
 *
 * Usa la API del compilador TypeScript (librería pura) para parsear el
 * código: no hay falsos positivos por comentarios ni cadenas de texto.
 */

import ts from "typescript";

/** Archivo a auditar. */
export interface ScannedFile {
  /** Ruta relativa a la raíz del repo, p. ej. "app/modules/economy/budget.ts". */
  path: string;
  content: string;
}

/** Tipo de violación de pureza. */
export type PurityRule = "io-import" | "infra-import" | "external-import" | "clock";

/** Violación detectada. */
export interface PurityViolation {
  file: string;
  line: number;
  rule: PurityRule;
  /** Motivo legible (español). */
  reason: string;
}

/** Configuración de la auditoría. */
export interface PurityConfig {
  /** Raíces de los módulos a auditar (relativas a la raíz del repo). */
  moduleRoots: string[];
  /** Directorios permitidos fuera del módulo (relativos a la raíz del repo). */
  allowedExternalDirs: string[];
}

/** Módulos de Node con I/O (o acceso a entorno/reloj). */
const IO_MODULES = new Set([
  "async_hooks",
  "child_process",
  "cluster",
  "dgram",
  "diagnostics_channel",
  "dns",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "net",
  "os",
  "perf_hooks",
  "process",
  "readline",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/transform",
  "stream/web",
  "tls",
  "worker_threads",
]);

/** Paquetes de infraestructura de la aplicación (BD, cache, cola, framework, UI). */
const INFRA_PACKAGES = new Set([
  "@prisma/client",
  "@tanstack/react-query",
  "bullmq",
  "ioredis",
  "next",
  "react",
  "react-dom",
  "superjson",
]);

/** Prefijos de paquete considerados infraestructura. */
const INFRA_PREFIXES = ["@trpc/"];

interface ImportInfo {
  specifier: string;
  line: number;
}

/**
 * Audita la pureza de un conjunto de archivos y devuelve las violaciones.
 * Los archivos que no estén bajo alguna raíz de `config.moduleRoots` se
 * ignoran.
 */
export function findPurityViolations(
  files: ScannedFile[],
  config: PurityConfig,
): PurityViolation[] {
  const violations: PurityViolation[] = [];
  for (const file of files) {
    const moduleRoot = config.moduleRoots.find(
      (root) => file.path === root || file.path.startsWith(`${root}/`),
    );
    if (!moduleRoot) continue;
    violations.push(...checkFile(file, moduleRoot, config));
  }
  return violations;
}

function checkFile(
  file: ScannedFile,
  moduleRoot: string,
  config: PurityConfig,
): PurityViolation[] {
  const sf = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
  const violations: PurityViolation[] = [];

  for (const imp of extractImports(sf)) {
    const violation = classifyImport(file.path, moduleRoot, imp, config);
    if (violation) violations.push(violation);
  }

  for (const clock of findClockUses(sf)) {
    violations.push({
      file: file.path,
      line: clock.line,
      rule: "clock",
      reason: `uso del reloj (${clock.text}) — los módulos puros no tienen reloj`,
    });
  }

  return violations;
}

/** Extrae los specifiers de import/export estáticos y de import dinámico. */
function extractImports(sf: ts.SourceFile): ImportInfo[] {
  const out: ImportInfo[] = [];

  const push = (node: ts.Node, specifier: string): void => {
    out.push({
      specifier,
      line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      push(node.moduleSpecifier, node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        push(arg, arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/** Detecta usos de `Date.now()` y `new Date()` en el código. */
function findClockUses(sf: ts.SourceFile): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "now" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Date"
    ) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: "Date.now()",
      });
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      out.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: "new Date()",
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/** Clasifica un import y devuelve la violación si no está permitido. */
function classifyImport(
  filePath: string,
  moduleRoot: string,
  imp: ImportInfo,
  config: PurityConfig,
): PurityViolation | null {
  const spec = imp.specifier;
  const bare = spec.startsWith("node:") ? spec.slice("node:".length) : spec;

  if (IO_MODULES.has(bare)) {
    return {
      file: filePath,
      line: imp.line,
      rule: "io-import",
      reason: `import de un módulo de I/O de Node ("${spec}") — los módulos puros no tienen I/O`,
    };
  }

  if (INFRA_PACKAGES.has(bare) || INFRA_PREFIXES.some((p) => bare.startsWith(p))) {
    return {
      file: filePath,
      line: imp.line,
      rule: "infra-import",
      reason: `import de infraestructura de la aplicación ("${spec}") — no permitido en módulos puros`,
    };
  }

  let resolved: string | null = null;
  if (spec.startsWith("./") || spec.startsWith("../")) {
    resolved = resolveRelative(filePath, spec);
  } else if (spec.startsWith("@/")) {
    resolved = `app/${spec.slice("@/".length)}`;
  }

  if (resolved !== null && !isAllowedPath(resolved, moduleRoot, config)) {
    return {
      file: filePath,
      line: imp.line,
      rule: "external-import",
      reason: `import fuera del módulo ("${spec}" → ${resolved}) — solo se permite el propio módulo y app/shared/types`,
    };
  }

  // Otros imports bare (librerías puras, p. ej. "zod"): permitidos.
  return null;
}

/** Resuelve un specifier relativo contra el directorio del archivo. */
function resolveRelative(fromFile: string, specifier: string): string {
  const dir = fromFile.slice(0, fromFile.lastIndexOf("/"));
  const stack: string[] = [];
  for (const part of `${dir}/${specifier}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

/** Si una ruta resuelta está dentro del módulo o en un directorio permitido. */
function isAllowedPath(
  resolved: string,
  moduleRoot: string,
  config: PurityConfig,
): boolean {
  if (resolved === moduleRoot || resolved.startsWith(`${moduleRoot}/`)) return true;
  return config.allowedExternalDirs.some(
    (d) => resolved === d || resolved.startsWith(`${d}/`),
  );
}
