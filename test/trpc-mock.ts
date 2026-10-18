/**
 * Mock de `@/trpc/client` para los tests de UI (T-24, fase C).
 *
 * `trpc` es un proxy recursivo: cualquier acceso a un hook (`useQuery`,
 * `useMutation`, `useUtils`, …) devuelve un `vi.fn()` cacheado por ruta
 * completa (p. ej. `auth.me.useQuery`), y los routers/procedimientos son
 * sub-proxies. Los valores por defecto simulan el estado inicial de
 * TanStack (queries pendientes, mutations en reposo) y `useUtils` devuelve
 * un proxy invocable donde cada hoja llamada es también un `vi.fn()`
 * (p. ej. `seasons.calendar.fetch.fetch`).
 *
 * Uso en cada test de UI:
 *
 * ```ts
 * vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
 *
 * import { trpc } from "@/trpc/client";
 * import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
 *
 * beforeEach(() => resetTrpcMocks());
 *
 * it("muestra la sesión activa", () => {
 *   mockResult(trpc.auth.me.useQuery, {
 *     data: { username: "piloto1", email: "piloto@liga.com", roles: [] },
 *     isPending: false,
 *     isError: false,
 *   });
 *   render(<MiComponente />);
 * });
 * ```
 *
 * El proveedor real (`TRPCReactProvider`) se cubre en
 * `app/trpc/__tests__/client.test.tsx`; aquí se sustituye por uno que
 * renderiza los hijos directamente.
 */
import { vi } from "vitest";

/** `vi.fn()` tipado de forma laxa (los resultados de los hooks son opacos). */
export type MockFn = ReturnType<typeof vi.fn>;

const HOOK_NAMES = new Set([
  "useQuery",
  "useMutation",
  "useInfiniteQuery",
  "useSuspenseQuery",
  "useSuspenseInfiniteQuery",
  "useUtils",
]);

interface HookEntry {
  fn: MockFn;
  defaultImpl: () => unknown;
}

const hooks = new Map<string, HookEntry>();
const utilsFns = new Map<string, MockFn>();

/** Estado inicial de una query (TanStack: pendiente, sin datos). */
function defaultQueryResult(): Record<string, unknown> {
  return {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
  };
}

/** Estado inicial de una mutation (en reposo). */
function defaultMutationResult(): Record<string, unknown> {
  return {
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
  };
}

/**
 * Proxy recursivo para `trpc.useUtils()`: cada acceso a una propiedad
 * desciende y cada invocación devuelve el `vi.fn()` cacheado por ruta
 * completa (p. ej. `seasons.calendar.fetch.fetch`).
 */
function makeUtilsProxy(path: string[]): unknown {
  const key = path.join(".");
  return new Proxy(function utilsNode() {}, {
    get(_target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return makeUtilsProxy([...path, prop]);
    },
    apply(_target, _thisArg, args) {
      let fn = utilsFns.get(key);
      if (!fn) {
        fn = vi.fn();
        utilsFns.set(key, fn);
      }
      return fn(...(args as unknown[]));
    },
  });
}

/** Devuelve el `vi.fn()` del hook en `path` (creado con su default si no existe). */
function hookFor(path: string): MockFn {
  let entry = hooks.get(path);
  if (!entry) {
    const name = path.split(".").pop() ?? "";
    const defaultImpl =
      name === "useQuery"
        ? () => defaultQueryResult()
        : name === "useUtils"
          ? () => makeUtilsProxy([])
          : () => defaultMutationResult();
    entry = { fn: vi.fn(defaultImpl), defaultImpl };
    hooks.set(path, entry);
  }
  return entry.fn;
}

/**
 * Proxy recursivo de `trpc`: routers/procedimientos son sub-proxies y los
 * hooks son `vi.fn()`. Soporta `_def()` (devuelve `{ path }`) para que
 * `getQueryKey`/`getMutationKey` de `@trpc/react-query` funcionen sobre el
 * mock (p. ej. `getQueryKey(trpc.auth.me)` en la home).
 */
function makeTrpcProxy(): unknown {
  const level = (path: string[]): unknown =>
    new Proxy(function trpcNode() {}, {
      get(_target, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        if (prop === "_def") return () => ({ path });
        if (HOOK_NAMES.has(prop)) return hookFor([...path, prop].join("."));
        return level([...path, prop]);
      },
    });
  return level([]);
}

/**
 * `trpc` mockeado (proxy recursivo).
 *
 * Tipado `any` a propósito (solo en este mock de tests): los tests acceden
 * a cadenas arbitrarias `trpc.router.proc.useQuery` / `useMutation` sin
 * conocer los tipos reales de tRPC (son responsabilidad del cliente real,
 * cubierto en `app/trpc`). Un tipo recursivo con index signature choca con
 * `noUncheckedIndexedAccess` (añade `| undefined` a cada acceso) y una
 * unión con `MockFn` impide las cadenas; `any` es la única forma de no
 * reescribir los tests con un API de acceso explícito.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const trpc: any = makeTrpcProxy();

/**
 * `TRPCReactProvider` para tests: renderiza los hijos directamente.
 * (El proveedor real se cubre en `app/trpc/__tests__/client.test.tsx`.)
 */
export function TRPCReactProvider({ children }: { children: unknown }) {
  return children as never;
}

/** Configura el valor devuelto de un hook mockeado (query o mutation). */
export function mockResult(hookFn: unknown, result: unknown): void {
  (hookFn as MockFn).mockReturnValue(result);
}

/** Devuelve el `vi.fn()` de una hoja de `useUtils` (p. ej. `seasons.calendar.fetch.fetch`). */
export function utilsMock(path: string): MockFn {
  let fn = utilsFns.get(path);
  if (!fn) {
    fn = vi.fn();
    utilsFns.set(path, fn);
  }
  return fn;
}

/** Convierte un hook obtenido del `trpc` mockeado en su `vi.fn()` subyacente. */
export function asMockFn(hookFn: unknown): MockFn {
  return hookFn as MockFn;
}

/** Restaura todos los hooks a sus valores por defecto (llamar en `beforeEach`). */
export function resetTrpcMocks(): void {
  for (const { fn, defaultImpl } of hooks.values()) {
    fn.mockReset();
    fn.mockImplementation(defaultImpl);
  }
  for (const fn of utilsFns.values()) {
    fn.mockReset();
  }
}
