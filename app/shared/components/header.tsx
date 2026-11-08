"use client";

import { getQueryKey } from "@trpc/react-query";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { trpc } from "@/trpc/client";
import { friendlyMessage, isUnauthorized } from "@/trpc/errors";

import { Button } from "./button";

/** Secciones de la navegación global (T-26): orden de uso del producto. */
const SECTIONS = [
  { href: "/lineups", label: "Lineups" },
  { href: "/mercado", label: "Mercado" },
  { href: "/puntuacion", label: "Puntuación" },
  { href: "/resultados", label: "Resultados" },
  { href: "/ligas", label: "Ligas" },
  { href: "/perfil", label: "Perfil" },
] as const;

/**
 * Cabecera global persistente (T-26): brand + secciones + sesión, en todas
 * las páginas. Sustituye la nav «Secciones» de la home y su sección «Sesión»
 * (la sesión —login/registro, username, logout— vive aquí, una sola vez).
 *
 * Estados de sesión (mismo criterio que la home, F3 P3-1):
 * - pendiente → la zona de sesión queda vacía (no adivinar);
 * - UNAUTHORIZED (anónimo) → «Iniciar sesión» + «Crear cuenta»;
 * - fallo real (500, red) → aviso + «Reintentar»: NO se enmascara como
 *   anónimo (la cookie, si existe, sigue siendo válida; la nav sigue
 *   sirviendo);
 * - logueado → username + «Cerrar sesión» (y «Admin» en la nav, solo
 *   `global_admin`); si el logout falla, aviso inline y botón reintentable.
 *
 * Móvil (≤768 px): menú hamburguesa (target ≥44 px, T-16) con las mismas
 * secciones + sesión; cierra al navegar, con Escape o al cerrar sesión.
 */
export function Header() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  // Toggle del menú móvil (a11y: al cerrar, el foco vuelve a este botón).
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  // Si el menú estaba abierto al cambiar de ruta: el foco solo vuelve al
  // toggle si estaba abierto (patrón disclosure — el foco nunca se pierde)
  // y no se roba el foco en la carga inicial.
  const menuWasOpenRef = useRef(false);

  // Sin sesión `auth.me` lanza UNAUTHORIZED (estado normal de una página
  // pública); no tiene sentido reintentarlo (mismo criterio que la home).
  const me = trpc.auth.me.useQuery(undefined, {
    retry: (count, error) => (isUnauthorized(error) ? false : count < 2),
  });

  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Al cerrar sesión se limpia el caché cliente de `me` (staleTime de
      // TanStack) para que la UI no siga mostrando la sesión anterior.
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
      setLogoutError(null);
      setMenuOpen(false);
      // El menú (si estaba abierto) se cierra: el foco vuelve al toggle.
      menuButtonRef.current?.focus();
    },
    // Si el logout falla (red/500) la sesión sigue viva: se avisa y el botón
    // queda reintentable (mismo criterio que la home, F3 P2).
    onError: (error) => setLogoutError(friendlyMessage(error)),
  });

  // Sincroniza el estado del menú para el cierre al navegar (abajo).
  useEffect(() => {
    menuWasOpenRef.current = menuOpen;
  }, [menuOpen]);

  // El menú móvil se cierra al navegar (cambio de ruta); el foco vuelve al
  // toggle (a11y: patrón disclosure — el foco nunca se pierde en <body>).
  useEffect(() => {
    setMenuOpen(false);
    if (menuWasOpenRef.current) menuButtonRef.current?.focus();
  }, [pathname]);

  // Escape cierra el menú móvil (a11y: salida de foco predecible; el foco
  // vuelve al toggle).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const loggedIn = me.data !== undefined;
  const anonymous = me.isError && isUnauthorized(me.error);
  // F3 P3-1 (ahora en el header, la superficie de sesión): fallo REAL
  // (500, red) — no se enmascara como anónimo: se avisa y se ofrece
  // reintentar (la cookie, si existe, sigue siendo válida).
  const sessionError = me.isError && !isUnauthorized(me.error);
  const isAdmin = me.data?.roles.includes("global_admin") ?? false;

  /** Sección activa (a11y: `aria-current="page"` + acento visual). */
  const activeFor = (href: string) => (pathname === href ? "page" : undefined);

  const links = (
    <ul className="site-header-links">
      {SECTIONS.map((section) => (
        <li key={section.href}>
          <Link href={section.href} aria-current={activeFor(section.href)}>
            {section.label}
          </Link>
        </li>
      ))}
      {isAdmin && (
        <li>
          <Link href="/admin" aria-current={activeFor("/admin")}>
            Admin
          </Link>
        </li>
      )}
    </ul>
  );

  const session = (
    <div className="site-header-session">
      {anonymous && (
        <>
          <Link className="button-secondary" href="/login">
            Iniciar sesión
          </Link>
          <Link className="button" href="/registro">
            Crear cuenta
          </Link>
        </>
      )}
      {loggedIn && (
        <>
          <span className="site-header-user">{me.data.username}</span>
          <Button
            type="button"
            variant="secondary"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {logout.isPending ? "Cerrando…" : "Cerrar sesión"}
          </Button>
        </>
      )}
      {sessionError && (
        <>
          <span className="bad" role="alert">
            No se pudo verificar la sesión
          </span>
          <Button
            type="button"
            variant="secondary"
            // Busy durante el refetch: evita dobles clics y da feedback.
            disabled={me.isRefetching}
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: getQueryKey(trpc.auth.me),
              })
            }
          >
            Reintentar
          </Button>
        </>
      )}
      {logoutError && (
        <span className="bad site-header-logout-error" role="alert">
          No se pudo cerrar sesión: {logoutError}
        </span>
      )}
    </div>
  );

  return (
    <header className={menuOpen ? "site-header site-header-open" : "site-header"}>
      <div className="site-header-bar">
        {/* La brand lleva a home, pero no es un ítem de nav: sin
            `aria-current` (la señal de «página actual» es solo de la nav). */}
        <Link href="/" className="site-header-brand">
          Fantasy MotoGP <span>Independiente</span>
        </Link>
        <nav
          id="site-header-menu"
          aria-label="Secciones"
          className="site-header-nav"
        >
          {links}
        </nav>
        {session}
        <button
          ref={menuButtonRef}
          type="button"
          className="site-header-menu-button"
          aria-expanded={menuOpen}
          aria-controls="site-header-menu"
          aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
