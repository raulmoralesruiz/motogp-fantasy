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
import type { ReactNode } from "react";
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
};

/** Restaura el estado de navegación (llamar en `beforeEach`). */
export function resetNavigationMocks(): void {
  navigation.push.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  navigation.back.mockReset();
  navigation.searchParams = new URLSearchParams();
  navigation.params = {};
}

/** Mock de `next/navigation`: `useRouter`/`useSearchParams`/`useParams` con estado controlable. */
export const navigationMock = {
  useRouter: () => navigation,
  useSearchParams: () =>
    useSyncExternalStore(subscribeToSearchParams, () => searchParamsValue),
  usePathname: () => "/",
  useParams: () => navigation.params,
};

/** Mock de `next/link`: renderiza un ancla plana (sin contexto del app router). */
export const linkMock = {
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
};
