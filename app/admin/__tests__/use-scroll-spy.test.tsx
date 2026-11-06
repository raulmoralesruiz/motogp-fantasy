// @vitest-environment jsdom
/**
 * Tests del scroll-spy de la navegación ancla del panel (impeccable P1-2):
 * la sección en vista marca su chip con `aria-current="location"`.
 *
 * `IntersectionObserver` no existe en jsdom: se sustituye por un falso que
 * registra instancias y permite disparar entradas. Se prueban la selección
 * de «la más alta en vista», la holgura de 80 px (el `scroll-margin-top`
 * de los destinos) y el fallback sin `IntersectionObserver` (hook inerte).
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollSpy } from "../use-scroll-spy";

/** Falso de `IntersectionObserver`: controla instancias y entradas. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  static reset() {
    MockIntersectionObserver.instances = [];
  }

  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  observed: Element[] = [];
  disconnected = false;

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(el: Element) {
    this.observed.push(el);
  }

  unobserve(el: Element) {
    this.observed = this.observed.filter((e) => e !== el);
  }

  disconnect() {
    this.disconnected = true;
    this.observed = [];
  }

  /** Dispara un lote de entradas de intersección. */
  trigger(
    entries: Array<{ id: string | null; isIntersecting: boolean; top: number }>,
  ) {
    this.callback(
      entries.map((e) => ({
        target:
          e.id && document.getElementById(e.id)
            ? document.getElementById(e.id)
            : document.createElement("div"),
        isIntersecting: e.isIntersecting,
        boundingClientRect: { top: e.top },
      })) as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

function makeSections(ids: string[]) {
  const els: Element[] = [];
  for (const id of ids) {
    const el = document.createElement("section");
    el.id = id;
    document.body.appendChild(el);
    els.push(el);
  }
  return els;
}

describe("useScrollSpy (impeccable P1-2)", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  });

  afterEach(() => {
    cleanup();
    MockIntersectionObserver.reset();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("empieza sin sección activa y observa todas las secciones conocidas", () => {
    const els = makeSections(["a", "b", "c"]);
    const { result } = renderHook(() => useScrollSpy(["a", "b", "c"]));
    expect(result.current).toBeNull();
    const observer = MockIntersectionObserver.instances.at(-1);
    expect(observer?.observed).toEqual(els);
  });

  it("marca la sección que entra en vista", () => {
    makeSections(["a", "b"]);
    const { result } = renderHook(() => useScrollSpy(["a", "b"]));
    const observer = MockIntersectionObserver.instances.at(-1);

    act(() => observer?.trigger([{ id: "b", isIntersecting: true, top: 200 }]));
    expect(result.current).toBe("b");
  });

  it("con varias en vista, gana la más alta (la que se está leyendo)", () => {
    makeSections(["a", "b", "c"]);
    const { result } = renderHook(() => useScrollSpy(["a", "b", "c"]));
    const observer = MockIntersectionObserver.instances.at(-1);

    act(() =>
      observer?.trigger([
        { id: "c", isIntersecting: true, top: 500 },
        { id: "a", isIntersecting: true, top: 100 },
      ]),
    );
    expect(result.current).toBe("a");

    // `a` sale de vista → ahora la más alta es `c`.
    act(() => {
      observer?.trigger([{ id: "a", isIntersecting: false, top: -400 }]);
    });
    expect(result.current).toBe("c");
  });

  it("usa una holgura superior de 80 px (el scroll-margin-top de los destinos)", () => {
    makeSections(["a"]);
    renderHook(() => useScrollSpy(["a"]));
    const observer = MockIntersectionObserver.instances.at(-1);
    expect(observer?.options.rootMargin).toBe("-80px 0px 0px 0px");
  });

  it("sin `IntersectionObserver` el hook es inerte (null, sin lanzar)", () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", undefined);
    makeSections(["a", "b"]);
    const { result } = renderHook(() => useScrollSpy(["a", "b"]));
    expect(result.current).toBeNull();
    // No se creó ninguna instancia.
    expect(MockIntersectionObserver.instances).toHaveLength(0);
  });

  it("desconecta el observer al desmontar", () => {
    makeSections(["a", "b"]);
    const { unmount } = renderHook(() => useScrollSpy(["a", "b"]));
    const observer = MockIntersectionObserver.instances.at(-1);
    unmount();
    expect(observer?.disconnected).toBe(true);
  });
});
