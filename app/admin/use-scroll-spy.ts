"use client";

import { useEffect, useState } from "react";

/**
 * Scroll-spy de la navegación ancla del panel (impeccable P1-2): devuelve
 * el id de la sección en vista para que su chip pinte
 * `aria-current="location"`.
 *
 * `IntersectionObserver` con `rootMargin` superior de 80 px (el
 * `scroll-margin-top: 5rem` de `globals.css`): una sección cuenta como
 * «en vista» solo cuando su borde pasa por debajo de la barra sticky. De
 * las que se ven, la activa es la más alta (la que se está leyendo), no
 * la última que entró. Sin `IntersectionObserver` (jsdom, navegadores
 * antiguos) el hook no hace nada: la navegación sigue funcionando por
 * anclas, sin `aria-current`.
 */
export function useScrollSpy(sectionIds: readonly string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    // Secciones en vista y su borde superior (px): la activa es la más alta.
    const inView = new Map<string, number>();
    const recompute = () => {
      let best: string | null = null;
      let bestTop = Number.POSITIVE_INFINITY;
      for (const [id, top] of inView) {
        if (top < bestTop) {
          bestTop = top;
          best = id;
        }
      }
      setActiveId(best);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (!id) continue;
          if (entry.isIntersecting) {
            inView.set(id, entry.boundingClientRect.top);
          } else {
            inView.delete(id);
          }
        }
        recompute();
      },
      { rootMargin: "-80px 0px 0px 0px", threshold: [0, 1] },
    );

    const elements: Element[] = [];
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) {
        elements.push(el);
        observer.observe(el);
      }
    }

    return () => {
      observer.disconnect();
      elements.length = 0;
    };
  }, [sectionIds]);

  return activeId;
}
