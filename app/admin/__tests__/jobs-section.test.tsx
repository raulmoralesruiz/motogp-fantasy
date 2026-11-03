// @vitest-environment jsdom
/**
 * Tests de `app/admin/jobs-section.tsx` (T-14, ADR-0036): sección
 * "Jobs y fuentes" del panel de admin.
 *
 * - Estados de `admin.jobsStatus`: pendiente, error y éxito (colas,
 *   alertas activas, probe, Sentry).
 * - Botón "Comprobar fuente ahora" (`admin.sourceHealth`): ok (latencia)
 *   y fallo (motivo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceProbeResult } from "../../modules/results";
import { act, fireEvent, render, screen } from "../../../test/rtl";
import { mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { trpc } from "../../../test/trpc-mock";

import JobsSection from "../jobs-section";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const QUEUES = [
  {
    name: "gp-prices",
    waiting: 1,
    active: 0,
    delayed: 2,
    completed: 10,
    failed: 3,
    lastFailedJob: {
      id: "job-42",
      name: "apply-formula",
      failedAt: "2026-11-02T10:00:00.000Z",
      failedReason: "HTTP 503",
      attemptsMade: 3,
    },
  },
  {
    name: "results-poll",
    waiting: 0,
    active: 0,
    delayed: 0,
    completed: 40,
    failed: 0,
    lastFailedJob: null,
  },
];

const STATUS_OK = {
  queues: QUEUES,
  activeAlerts: [
    {
      gpId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      event: "race",
      source: "pulselive",
      consecutiveFailures: 3,
      lastError: "HTTP 503 (test)",
      lastAttemptAt: "2026-11-02T09:00:00.000Z",
      lastSuccessAt: null,
    },
  ],
  probe: {
    consecutiveFailures: 0,
    lastError: "timeout (antiguo)",
    lastAttemptAt: "2026-11-02T10:00:00.000Z",
    lastSuccessAt: "2026-11-02T10:00:00.000Z",
    lastLatencyMs: 180,
  },
  sentryEnabled: false,
};

function mockStatus(result: Record<string, unknown>) {
  mockResult(trpc.admin.jobsStatus.useQuery, result);
}

beforeEach(() => {
  resetTrpcMocks();
});

describe("JobsSection (T-14, ADR-0036)", () => {
  it("muestra 'Consultando…' mientras la query está pendiente", () => {
    render(<JobsSection />);
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error si no se puede cargar el estado", () => {
    mockStatus({
      isPending: false,
      isError: true,
      data: undefined,
      error: { message: "Redis no disponible" },
    });
    render(<JobsSection />);
    expect(
      screen.getByText(/No se pudo cargar el estado de los jobs/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Redis no disponible/)).toBeInTheDocument();
  });

  it("éxito: colas con counts, último fallo, probe, alertas y Sentry desactivado", () => {
    mockStatus({ isPending: false, isError: false, data: STATUS_OK });
    render(<JobsSection />);

    // Colas (nombres + counts de la primera cola).
    expect(screen.getByText("Colas de jobs (BullMQ)")).toBeInTheDocument();
    expect(screen.getByText("gp-prices")).toBeInTheDocument();
    expect(screen.getByText("results-poll")).toBeInTheDocument();
    // Cada cola muestra sus 5 contadores (2 colas ⇒ 2 de cada etiqueta);
    // los valores concretos de cada cola se verifican por su `<strong>`.
    expect(screen.getAllByText(/^en espera:/)).toHaveLength(2);
    expect(screen.getAllByText(/^completados:/)).toHaveLength(2);
    expect(screen.getAllByText(/^fallidos:/)).toHaveLength(2);
    expect(screen.getByText("10")).toBeInTheDocument(); // gp-prices
    expect(screen.getByText("40")).toBeInTheDocument(); // results-poll

    // Último job fallido (motivo + intentos).
    expect(screen.getByText(/«apply-formula» — HTTP 503/)).toBeInTheDocument();
    expect(screen.getByText(/3 intento\(s\)/)).toBeInTheDocument();

    // Probe (estado del worker en Redis).
    expect(screen.getByText("Fuente de datos (PulseLive)")).toBeInTheDocument();
    expect(screen.getByText("fallos consecutivos:")).toBeInTheDocument();
    expect(screen.getByText("timeout (antiguo)")).toBeInTheDocument();

    // Alerta activa (umbral de US-17 alcanzado).
    expect(screen.getByText("Alertas activas (umbral alcanzado)")).toBeInTheDocument();
    expect(screen.getByText(/carrera principal/)).toBeInTheDocument();
    expect(screen.getByText(/3 fallos/)).toBeInTheDocument();

    // Sentry desactivado (sin DSN).
    expect(screen.getByText("Sentry (errores)")).toBeInTheDocument();
    expect(screen.getByText(/Desactivado/)).toBeInTheDocument();
  });

  it("sin alertas activas: mensaje informativo (sin lista)", () => {
    mockStatus({
      isPending: false,
      isError: false,
      data: { ...STATUS_OK, activeAlerts: [] },
    });
    render(<JobsSection />);

    expect(
      screen.getByText(/Sin alertas activas/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Alertas activas (umbral alcanzado)"),
    ).not.toBeInTheDocument();
  });

  it("sin probe registrado: 'Aún no hay comprobaciones'", () => {
    mockStatus({
      isPending: false,
      isError: false,
      data: { ...STATUS_OK, probe: null },
    });
    render(<JobsSection />);

    expect(
      screen.getByText("Aún no hay comprobaciones registradas."),
    ).toBeInTheDocument();
  });

  it("Sentry habilitado: muestra 'Activo'", () => {
    mockStatus({
      isPending: false,
      isError: false,
      data: { ...STATUS_OK, sentryEnabled: true },
    });
    render(<JobsSection />);

    expect(screen.getByText(/Activo: los errores/)).toBeInTheDocument();
  });

  it("probe sin éxito registrado: 'sin éxito registrado' + último error", () => {
    mockStatus({
      isPending: false,
      isError: false,
      data: {
        queues: QUEUES,
        activeAlerts: [],
        probe: {
          consecutiveFailures: 2,
          lastError: "timeout (test)",
          lastAttemptAt: "2026-11-02T10:00:00.000Z",
          lastSuccessAt: null,
          lastLatencyMs: null,
        },
        sentryEnabled: false,
      },
    });
    render(<JobsSection />);

    expect(screen.getByText(/sin éxito registrado/)).toBeInTheDocument();
    expect(screen.getByText(/fallos consecutivos/)).toBeInTheDocument();
    expect(screen.getByText("timeout (test)")).toBeInTheDocument();
  });

  it("alerta activa sin error: no muestra el motivo", () => {
    mockStatus({
      isPending: false,
      isError: false,
      data: {
        queues: [],
        activeAlerts: [
          {
            gpId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            event: "sprint",
            source: "pulselive",
            consecutiveFailures: 4,
            lastError: null,
            lastAttemptAt: "2026-11-02T09:00:00.000Z",
            lastSuccessAt: null,
          },
        ],
        probe: null,
        sentryEnabled: false,
      },
    });
    render(<JobsSection />);

    // La alerta muestra GP + número de fallos…
    expect(screen.getByText(/4 fallos/)).toBeInTheDocument();
    // …pero NO el motivo (alerta con `lastError: null`).
    expect(screen.queryByText(/HTTP 503/)).not.toBeInTheDocument();
  });

  describe('botón "Comprobar fuente ahora" (admin.sourceHealth)', () => {
    it("ok: alerta de éxito con la latencia", async () => {
      mockStatus({ isPending: false, isError: false, data: STATUS_OK });
      const probeResult: SourceProbeResult = {
        ok: true,
        latencyMs: 95,
        error: null,
        probedAt: new Date("2026-11-02T10:30:00.000Z"),
      };
      const mutateAsync = vi.fn(async () => probeResult);
      mockResult(trpc.admin.sourceHealth.useMutation, {
        mutateAsync,
        isPending: false,
      });

      render(<JobsSection />);
      await act(async () => {
        await fireEvent.click(screen.getByText("Comprobar fuente ahora"));
      });

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/PulseLive responde/),
      ).toBeInTheDocument();
      expect(screen.getByText(/95 ms/)).toBeInTheDocument();
    });

    it("probe ok=false (fuente caída): alerta de error con el motivo", async () => {
      mockStatus({ isPending: false, isError: false, data: STATUS_OK });
      const probeResult: SourceProbeResult = {
        ok: false,
        latencyMs: null,
        error: "PulseLive no es alcanzable: fetch failed",
        probedAt: new Date("2026-11-02T10:30:00.000Z"),
      };
      const mutateAsync = vi.fn(async () => probeResult);
      mockResult(trpc.admin.sourceHealth.useMutation, {
        mutateAsync,
        isPending: false,
      });

      render(<JobsSection />);
      await act(async () => {
        await fireEvent.click(screen.getByText("Comprobar fuente ahora"));
      });

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(/PulseLive no responde/),
      ).toBeInTheDocument();
      expect(screen.getByText(/fetch failed/)).toBeInTheDocument();
    });

    it("mutación rechazada (tRPC): se muestra el error del transporte", async () => {
      mockStatus({ isPending: false, isError: false, data: STATUS_OK });
      const mutateAsync = vi.fn(async () => {
        throw new Error("No se pudo conectar con la API");
      });
      mockResult(trpc.admin.sourceHealth.useMutation, {
        mutateAsync,
        isPending: false,
      });

      render(<JobsSection />);
      await act(async () => {
        await fireEvent.click(screen.getByText("Comprobar fuente ahora"));
      });

      expect(
        screen.getByText("No se pudo conectar con la API"),
      ).toBeInTheDocument();
    });
  });
});
