/**
 * Mocks compartidos de `next/navigation` y `next/link` para los tests de
 * UI (T-24, fase C): jsdom no tiene el contexto del app router de Next.
 *
 * Uso en cada test de UI:
 *
 * ```ts
 * vi.mock("next/navigation", () =>
 *   import("../../../test/ui-mocks").then((m) => m.navigationMock),
 * );
 * vi.mock("next/link", () =>
 *   import("../../../test/ui-mocks").then((m) => m.linkMock),
 * );
 *
 * import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";
 * beforeEach(() => resetNavigationMocks());
 * ```
 *
 * `navigation` es el estado controlable: se aserta `navigation.push`/
 * `refresh` tras interacciones y se fija `navigation.searchParams` para
 * probar rutas con query string (p. ej. `/reestablecer-contrasena?token=…`).
 */
import type { AnchorHTMLAttributes } from "react";
import { useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * Store reactivo del query string: imita la reactividad de
 * `useSearchParams` del router real — una «navegación» (p. ej. el click en
 * un `Link` de la consola del fin de semana) repinta el componente en vez
 * de exigir un render nuevo.
 */
let searchParamsValue = new URLSearchParams();
const searchParamsListeners = new Set<() => void>();

function subscribeToSearchParams(listener: () => void): () => void {
  searchParamsListeners.add(listener);
  return () => {
    searchParamsListeners.delete(listener);
  };
}

function publishSearchParams(params: URLSearchParams): void {
  searchParamsValue = params;
  searchParamsListeners.forEach((listener) => listener());
}

/**
 * Store reactivo del pathname (T-26): imita la reactividad de `usePathname`
 * del router real — una «navegación» (p. ej. fijar `navigation.pathname`)
 * repinta el componente en vez de exigir un render nuevo.
 */
let pathnameValue = "/";
const pathnameListeners = new Set<() => void>();

function subscribeToPathname(listener: () => void): () => void {
  pathnameListeners.add(listener);
  return () => {
    pathnameListeners.delete(listener);
  };
}

function publishPathname(value: string): void {
  pathnameValue = value;
  pathnameListeners.forEach((listener) => listener());
}

/** Estado de navegación controlable (router + query string + params). */
export const navigation = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  get searchParams() {
    return searchParamsValue;
  },
  set searchParams(value: URLSearchParams) {
    publishSearchParams(value);
  },
  /** Params de ruta (US-24: `/ligas/[id]`); se fija por test. */
  params: {} as Record<string, string>,
  /** Pathname actual (T-26: el header resalta la sección activa); se fija por test. */
  get pathname() {
    return pathnameValue;
  },
  set pathname(value: string) {
    publishPathname(value);
  },
};

/** Restaura el estado de navegación (llamar en `beforeEach`). */
export function resetNavigationMocks(): void {
  navigation.push.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  navigation.back.mockReset();
  navigation.searchParams = new URLSearchParams();
  navigation.params = {};
  navigation.pathname = "/";
}

/** Mock de `next/navigation`: `useRouter`/`useSearchParams`/`useParams` con estado controlable. */
export const navigationMock = {
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(subscribeToSearchParams, () => searchParamsValue),
  usePathname: () =>
    useSyncExternalStore(subscribeToPathname, () => pathnameValue),
  useParams: () => navigation.params,
};

/**
 * Mock de `next/link`: renderiza un ancla plana (sin contexto del app
 * router). Propaga el resto de props (`aria-current`, `className`, …) para
 * que los tests puedan asertar sobre ellas (T-26: sección activa).
 */
export const linkMock = {
  default: ({ children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...rest}>{children}</a>
  ),
};
