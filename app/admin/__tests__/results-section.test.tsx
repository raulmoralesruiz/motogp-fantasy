// @vitest-environment jsdom
/**
 * Tests de `app/admin/results-section.tsx` (US-16 manual + US-17
 * automático, ADR-0018/0019): sección de importación de resultados
 * (temporada → GP → evento y una fila por piloto del mercado) + bloque de
 * la fuente (vínculo, importación automática, estado y mapeo de pilotos).
 *
 * Los IDs de GP/evento/piloto son UUIDs válidos: el schema compartido
 * (`importEventInputSchema`) los valida y el pre-check local del componente
 * no debe rechazar un payload correcto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  EventFlagResult,
  EventResultView,
  GpEventView,
  ImportEventFromSourceResult,
  ImportEventResult,
  MarkDefinitiveResult,
} from "../../modules/results";
import type { RiderView } from "../../modules/market";
import type { CircuitView, GpView, SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { act, fireEvent, render, screen, userEvent } from "../../../test/rtl";
import {
  asMockFn,
  mockResult,
  resetTrpcMocks,
  trpc,
  type MockFn,
} from "../../../test/trpc-mock";
import { clientError } from "../../../test/errors";
import { navigation, resetNavigationMocks } from "../../../test/ui-mocks";

import ResultsSection from "../results-section";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));
vi.mock("next/navigation", () =>
  import("../../../test/ui-mocks").then((m) => m.navigationMock),
);

// La selección se persiste en la URL (harden): cada test arranca sin params
// para no heredar el contexto del anterior.
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  resetNavigationMocks();
});

const seasonId = "s1";
const gpId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const r1 = "11111111-1111-4111-8111-111111111111";
const r2 = "22222222-2222-4222-8222-222222222222";
const r3 = "33333333-3333-4333-8333-333333333333";

const season: SeasonWithRules = {
  id: seasonId,
  name: "Temporada 2026",
  year: 2026,
  startDate: null,
  endDate: null,
  status: "planned",
  rules: [
    {
      id: "r1",
      version: "provisional-v1",
      rules: PROVISIONAL_SEASON_RULES,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
};

const circuit: CircuitView = {
  id: "c1",
  name: "Circuito de Jerez",
  country: "España",
  location: "Jerez de la Frontera",
};

const gp: GpView = {
  id: gpId,
  seasonId,
  round: 1,
  name: "GP de España",
  circuit,
  date: new Date("2026-04-19T14:00:00Z"),
  status: "scheduled",
  lockoutAt: null,
  sourceRef: null,
  events: [
    { id: eventId, type: "race", orderNum: 2, startTime: null, status: "scheduled" },
  ],
};

/** GP vinculado a la fuente (US-17, ADR-0019). */
const sourceRef = "275ca55d-45d3-440f-ad59-17d6b3e6b2d3";
const gpLinked: GpView = { ...gp, sourceRef };

const event: GpEventView = {
  id: eventId,
  type: "race",
  orderNum: 2,
  status: "scheduled",
  cancelled: false,
  neutralized: false,
  resultCount: 0,
};

const riders: RiderView[] = [
  { id: r1, name: "Piloto Uno", number: 1, isActive: true },
  { id: r2, name: "Piloto Dos", number: 2, isActive: true },
  { id: r3, name: "Piloto Tres", number: 3, isActive: true },
];

/** Fila pre-cargada de BD para r1 (2º, vuelta rápida). */
function r1Row(overrides: Partial<EventResultView> = {}): EventResultView {
  return {
    riderId: r1,
    riderName: "Piloto Uno",
    position: 2,
    started: true,
    finished: true,
    penalties: [],
    bonuses: ["fastest-lap"],
    rawPoints: null,
    derivedStatus: "FINISHED",
    status: "provisional",
    resultsVersion: null,
    ...overrides,
  };
}

function mockGps(result: Record<string, unknown> = {}) {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

function mockGpEvents(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.gpEvents.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

function mockRiders(result: Record<string, unknown> = {}) {
  mockResult(trpc.market.riders.list.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

function mockEventResults(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.eventResults.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

/** US-17: estado del auto-import (vacio por defecto, cargado). */
function mockSourceState(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.sourceState.useQuery, {
    data: [],
    isPending: false,
    isError: false,
    isSuccess: true,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

/** US-17: catálogo de eventos de la fuente (vacio por defecto, cargado). */
function mockSourceEvents(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.sourceEvents.useQuery, {
    data: [],
    isPending: false,
    isError: false,
    isSuccess: true,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

/** US-17: mapeos de pilotos (vacio por defecto, cargado). */
function mockRiderMappings(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.riderMappings.useQuery, {
    data: [],
    isPending: false,
    isError: false,
    isSuccess: true,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

/** US-18: estado de definitivo del GP (por defecto: cargado, sin resultados). */
function mockGpState(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.gpState.useQuery, {
    data: {
      gpId,
      gpName: "GP de España",
      round: 1,
      seasonName: "Temporada 2026",
      definitive: false,
      resultsVersion: null,
      counts: { provisional: 0, definitive: 0, corrected: 0 },
      totalResults: 0,
      lineups: 1,
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

/** US-18: mutations de definitivo/estados de evento en reposo. */
function mockDefinitiveMutations() {
  const markDefinitive = vi.fn();
  const cancelEvent = vi.fn();
  const neutralizeEvent = vi.fn();
  const idle = {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
  };
  mockResult(trpc.results.markDefinitive.useMutation, {
    mutate: markDefinitive,
    ...idle,
  });
  mockResult(trpc.results.cancelEvent.useMutation, { mutate: cancelEvent, ...idle });
  mockResult(trpc.results.neutralizeEvent.useMutation, {
    mutate: neutralizeEvent,
    ...idle,
  });
  return { markDefinitive, cancelEvent, neutralizeEvent };
}

/** US-17: mutations de la fuente en reposo. */
function mockSourceMutations() {
  const importFromSource = vi.fn();
  const link = vi.fn();
  const unlink = vi.fn();
  const setMapping = vi.fn();
  const deleteMapping = vi.fn();
  const idle = {
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
  };
  mockResult(trpc.results.importFromSource.useMutation, {
    mutate: importFromSource,
    ...idle,
  });
  mockResult(trpc.results.linkSource.useMutation, { mutate: link, ...idle });
  mockResult(trpc.results.unlinkSource.useMutation, { mutate: unlink, ...idle });
  mockResult(trpc.results.setRiderMapping.useMutation, { mutate: setMapping, ...idle });
  mockResult(trpc.results.deleteRiderMapping.useMutation, {
    mutate: deleteMapping,
    ...idle,
  });
  return { importFromSource, link, unlink, setMapping, deleteMapping };
}

function mockImport(result: Record<string, unknown> = {}): MockFn {
  const mutate = vi.fn();
  mockResult(trpc.results.importEvent.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
    ...result,
  });
  return mutate;
}

/** Todo cargado (GP, evento, pilotos, resultados previos, fuente) + mutaciones en reposo. */
function mockLoaded(eventResultsData: EventResultView[] = []): MockFn {
  mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
  mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
  mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
  mockEventResults({
    isPending: false,
    isError: false,
    isSuccess: true,
    data: eventResultsData,
  });
  mockGpState();
  mockDefinitiveMutations();
  mockSourceState();
  mockSourceEvents();
  mockRiderMappings();
  mockSourceMutations();
  return mockImport();
}

/** Selecciona temporada → GP → evento y devuelve el `user` para seguir usando. */
async function selectEvent() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
  await user.selectOptions(screen.getByLabelText("GP"), gpId);
  await user.selectOptions(screen.getByLabelText("Evento"), eventId);
  return user;
}

/** Marca una fila nueva terminada con la posición indicada. */
async function markFinished(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  position: string,
) {
  await user.click(screen.getByLabelText(`Salió: ${name}`));
  await user.click(screen.getByLabelText(`Terminó: ${name}`));
  await user.type(screen.getByLabelText(`Posición: ${name}`), position);
}

describe("ResultsSection", () => {
  beforeEach(() => {
    resetTrpcMocks();
    vi.restoreAllMocks();
  });

  it("pide elegir una temporada cuando no hay ninguna seleccionada", () => {
    render(<ResultsSection seasons={[season]} />);
    expect(screen.getByText("Elige una temporada para ver sus GPs.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("pre-carga las filas ya importadas en BD", async () => {
    mockLoaded([r1Row()]);
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(screen.getByLabelText("Salió: Piloto Uno")).toBeChecked();
    expect(screen.getByLabelText("Terminó: Piloto Uno")).toBeChecked();
    // jest-dom convierte el valor de inputs number a número (compareAsSet estricto).
    expect(screen.getByLabelText("Posición: Piloto Uno")).toHaveValue(2);
    expect(screen.getByLabelText("Vuelta rápida: Piloto Uno")).toBeChecked();
    expect(screen.getByText("Terminado")).toBeInTheDocument();
    // Las filas vacías sin pre-carga derivan ABSENT.
    expect(screen.getAllByText("Ausente")).toHaveLength(2);
  });

  it("etiqueta los eventos por tipo y estado de resultados (y marca los cancelados)", async () => {
    const finishedEvent: GpEventView = {
      ...event,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      resultCount: 3,
    };
    const cancelledEvent: GpEventView = {
      ...event,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      status: "cancelled",
    };
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: [finishedEvent, cancelledEvent],
    });
    mockGpState();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(
      screen.getByRole("option", { name: "carrera principal — con resultados" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "carrera principal — evento cancelado" }),
    ).toBeInTheDocument();
  });

  it("envía solo los pilotos con datos o con fila pre-cargada (orden de pilotos)", async () => {
    const mutate = mockLoaded([r1Row()]);
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    // r2: fila nueva (salió + terminó + posición). r3: vacío y sin pre-carga → excluido.
    await markFinished(user, "Piloto Dos", "1");

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      gpId,
      eventId,
      entries: [
        {
          riderId: r1,
          position: 2,
          started: true,
          finished: true,
          penalties: [],
          bonuses: ["fastest-lap"],
          rawPoints: null,
        },
        {
          riderId: r2,
          position: 1,
          started: true,
          finished: true,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
      ],
      reason: undefined,
    });
  });

  it("envía el motivo cuando se indica", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.type(
      screen.getByLabelText(
        "Motivo (obligatorio si la importación corrige resultados existentes)",
      ),
      "corrección de parrilla",
    );

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "corrección de parrilla" }),
    );
  });

  it("corrige a ABSENT un piloto pre-cargado que se vacía", async () => {
    const mutate = mockLoaded([r1Row()]);
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    // La auto-limpieza no toca bonos/penalizaciones: el admin los desmarca a mano.
    await user.click(screen.getByLabelText("Vuelta rápida: Piloto Uno"));
    await user.click(screen.getByLabelText("Salió: Piloto Uno"));
    expect(screen.getByLabelText("Terminó: Piloto Uno")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledWith({
      gpId,
      eventId,
      entries: [
        {
          riderId: r1,
          position: null,
          started: false,
          finished: false,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
      ],
      reason: undefined,
    });
  });

  it("marca y desmarca penalizaciones por piloto", async () => {
    mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    const dq = screen.getByLabelText("Descalificado: Piloto Dos");
    await user.click(dq);
    expect(dq).toBeChecked();
    await user.click(dq);
    expect(dq).not.toBeChecked();
  });

  it("marca un bono en una fila nueva y lo envía en el payload", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await user.click(screen.getByLabelText("Vuelta rápida: Piloto Dos"));
    expect(screen.getByLabelText("Vuelta rápida: Piloto Dos")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledWith({
      gpId,
      eventId,
      entries: [
        {
          riderId: r2,
          position: null,
          started: false,
          finished: false,
          penalties: [],
          bonuses: ["fastest-lap"],
          rawPoints: null,
        },
      ],
      reason: undefined,
    });
  });

  it("rechaza localmente un piloto que terminó sin posición", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await user.click(screen.getByLabelText("Salió: Piloto Dos"));
    await user.click(screen.getByLabelText("Terminó: Piloto Dos"));

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Un piloto que terminó necesita posición",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rechaza localmente una posición no entera (1e2)", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await user.click(screen.getByLabelText("Salió: Piloto Dos"));
    await user.click(screen.getByLabelText("Terminó: Piloto Dos"));
    // jsdom conserva "1e2" (float válido) en inputs number; el regex del
    // componente es lo que lo rechaza.
    fireEvent.change(screen.getByLabelText("Posición: Piloto Dos"), {
      target: { value: "1e2" },
    });

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "La posición de Piloto Dos debe ser un número entero.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rechaza localmente puntos crudos no numéricos (1e2)", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    // jsdom conserva "1e2" (float válido) en inputs number; el regex del
    // componente es lo que lo rechaza.
    fireEvent.change(screen.getByLabelText("Puntos crudos: Piloto Dos"), {
      target: { value: "1e2" },
    });

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Los puntos crudos de Piloto Dos deben ser un número.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("muestra el error del servidor cuando no hay issues de Zod", async () => {
    mockLoaded();
    mockImport({
      isError: true,
      isPending: false,
      error: new Error("El GP está cancelado: no se pueden importar resultados."),
    });
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El GP está cancelado: no se pueden importar resultados.",
    );
  });

  it("muestra los issues de Zod del servidor", async () => {
    mockLoaded();
    const serverError = new Error("bad request");
    (serverError as { data?: unknown }).data = {
      zod: [
        {
          path: ["entries", 0, "riderId"],
          message: "El identificador de piloto no es válido",
        },
      ],
    };
    mockImport({ isError: true, isPending: false, error: serverError });
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El identificador de piloto no es válido",
    );
  });

  it("muestra el resumen de la importación al completar", async () => {
    mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    const options = asMockFn(trpc.results.importEvent.useMutation).mock.calls[0]?.[0] as {
      onSuccess: (data: ImportEventResult) => void;
    };
    act(() => {
      options.onSuccess({
        created: 2,
        corrected: 1,
        unchanged: 3,
        kept: 5,
        recalculated: false,
        resultsVersion: null,
        lineupsScored: 0,
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Importación completada (carrera principal): 2 creados, 1 corregidos, 3 sin cambios y 5 conservados.",
    );
  });

  it("desactiva el botón mientras importa", async () => {
    mockLoaded();
    mockImport({ isPending: true });
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");

    expect(screen.getByRole("button", { name: "Importando…" })).toBeDisabled();
  });

  it("muestra el error al cargar los pilotos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: false, isError: true, error: new Error("sin conexión") });
    mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockGpState();
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(
      screen.getByText("No se pudieron cargar los resultados: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el error al cargar los resultados previos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
    mockEventResults({
      isPending: false,
      isError: true,
      error: new Error("fallo de BD"),
    });
    mockGpState();
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(
      screen.getByText("No se pudieron cargar los resultados: fallo de BD"),
    ).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay pilotos en el mercado", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockGpState();
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(screen.getByText("Aún no hay pilotos en el mercado.")).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga los GPs de la temporada", async () => {
    mockGps({ isPending: true });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error al cargar los GPs de la temporada", async () => {
    mockGps({ isPending: false, isError: true, error: new Error("fallo de BD") });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);

    expect(
      screen.getByText("No se pudieron cargar los GPs: fallo de BD"),
    ).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando la temporada no tiene GPs", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);

    expect(screen.getByText("Esta temporada aún no tiene GPs.")).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga los eventos del GP", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: true });
    mockGpState();
    mockSourceState();
    mockSourceEvents();
    mockRiderMappings();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error al cargar los eventos del GP", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({
      isPending: false,
      isError: true,
      error: new Error("fallo de eventos"),
    });
    mockGpState();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(
      screen.getByText("No se pudieron cargar los eventos: fallo de eventos"),
    ).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando el GP no tiene eventos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockGpState();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(screen.getByText("Este GP aún no tiene eventos.")).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga pilotos y resultados previos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: true });
    mockEventResults({ isPending: true });
    mockGpState();
    mockSourceState();
    mockSourceEvents();
    mockRiderMappings();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);
    await user.selectOptions(screen.getByLabelText("Evento"), eventId);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra '—' en la columna de bonos para eventos sin bonos (sprint)", async () => {
    const sprintEvent: GpEventView = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      type: "sprint",
      orderNum: 1,
      status: "scheduled",
      cancelled: false,
      neutralized: false,
      resultCount: 0,
    };
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: [sprintEvent],
    });
    mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
    mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockGpState();
    mockImport();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);
    await user.selectOptions(screen.getByLabelText("Evento"), sprintEvent.id);

    // Un '—' por cada piloto: el sprint no tiene bonos importables (ADR-0018).
    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  describe("US-17: importación automática (PulseLive)", () => {
    it("muestra el formulario de vínculo y los estados vacíos cuando el GP no está vinculado", async () => {
      mockLoaded();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByRole("heading", { name: "1. Importación automática (PulseLive)" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Evento de la fuente")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Vincular GP" })).toBeInTheDocument();
      expect(screen.getByText("Aún no hay intentos registrados.")).toBeInTheDocument();
      expect(screen.getByText("Aún no hay mapeos de pilotos.")).toBeInTheDocument();
    });

    it("vincula el GP con el evento de la fuente elegido", async () => {
      mockLoaded();
      mockSourceEvents({
        data: [
          { eventRef: "ev-1", name: "MotoGP — Indonesia" },
          { eventRef: "ev-2", name: "Moto2 — Indonesia" },
        ],
      });
      const { link } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento de la fuente"), "ev-1");
      await user.click(screen.getByRole("button", { name: "Vincular GP" }));

      expect(link).toHaveBeenCalledWith({ gpId, eventRef: "ev-1" });
    });

    it("muestra el error local al vincular sin elegir evento de la fuente", async () => {
      mockLoaded();
      const { link } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.click(screen.getByRole("button", { name: "Vincular GP" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "El identificador de evento de la fuente no puede estar vacío",
      );
      expect(link).not.toHaveBeenCalled();
    });

    it("muestra el vínculo existente y permite desvincular", async () => {
      mockGps({ isPending: false, isError: false, isSuccess: true, data: [gpLinked] });
      mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
      mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
      mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
      mockGpState();
      mockSourceState();
      mockRiderMappings();
      const { unlink } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByText(sourceRef)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Desvincular" }));
      await user.click(screen.getByRole("button", { name: "Sí, desvincular la fuente" }));

      expect(unlink).toHaveBeenCalledWith({ gpId });
    });

    it("importa desde la fuente el evento elegido y explica los no importables", async () => {
      const q2: GpEventView = {
        id: "qqqqqqqq-qqqq-4qqq-8qqq-qqqqqqqqqqqq",
        type: "q2",
        orderNum: 1,
        status: "scheduled",
        cancelled: false,
        neutralized: false,
        resultCount: 0,
      };
      const sprint: GpEventView = {
        id: "ssssssss-ssss-4sss-8sss-ssssssssssss",
        type: "sprint",
        orderNum: 2,
        status: "cancelled",
        cancelled: false,
        neutralized: false,
        resultCount: 0,
      };
      const race: GpEventView = {
        id: eventId,
        type: "race",
        orderNum: 3,
        status: "scheduled",
        cancelled: false,
        neutralized: false,
        resultCount: 0,
      };
      mockGps({ isPending: false, isError: false, isSuccess: true, data: [gpLinked] });
      mockGpEvents({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [q2, sprint, race],
      });
      mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
      mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
      mockGpState();
      mockSourceState();
      mockRiderMappings();
      const { importFromSource } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      // Un solo mecanismo de selección de evento: sin evento elegido se pide.
      expect(screen.getByText("elige un evento para importarlo.")).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Evento"), eventId);
      await user.click(
        screen.getByRole("button", { name: "Importar carrera principal" }),
      );
      expect(importFromSource).toHaveBeenCalledWith({ gpId, event: "race" });

      // Un evento cancelado no es importable: se explica, sin botón muerto.
      await user.selectOptions(screen.getByLabelText("Evento"), sprint.id);
      expect(
        screen.queryByRole("button", { name: "Importar sprint" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText("este evento no es importable desde la fuente."),
      ).toBeInTheDocument();

      // Los importables siguen disponibles al volver a elegirlos.
      await user.selectOptions(screen.getByLabelText("Evento"), q2.id);
      expect(screen.getByRole("button", { name: "Importar Q2" })).toBeInTheDocument();
    });

    it("muestra el resumen de la importación automática con los pilotos sin mapear", async () => {
      mockGps({ isPending: false, isError: false, isSuccess: true, data: [gpLinked] });
      mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
      mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
      mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
      mockGpState();
      mockSourceState();
      mockRiderMappings();
      mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(
        screen.getByRole("button", { name: "Importar carrera principal" }),
      );

      const options = asMockFn(trpc.results.importFromSource.useMutation).mock
        .calls[0]?.[0] as {
        onSuccess: (data: ImportEventFromSourceResult) => void;
      };
      act(() => {
        options.onSuccess({
          created: 1,
          corrected: 0,
          unchanged: 2,
          kept: 0,
          unmapped: [{ riderRef: "rider-9", name: null }],
          recalculated: false,
          resultsVersion: null,
          lineupsScored: 0,
        });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "Importación automática (carrera principal): 1 creados, 0 corregidos, 2 sin cambios y 0 conservados.",
      );
      // Los sin mapear se listan aparte con un atajo que precarga el formulario.
      expect(screen.getByText(/rider-9/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Mapear" }));
      expect(screen.getByLabelText("Referencia en la fuente")).toHaveValue("rider-9");
    });

    it("resalta en la tabla del estado los eventos con fallos por encima del umbral", async () => {
      mockLoaded();
      mockSourceState({
        data: [
          {
            event: "race",
            source: "pulselive:v1",
            consecutiveFailures: 3,
            lastError: "timeout de la fuente",
            lastAttemptAt: new Date("2026-10-21T14:00:00Z"),
            lastSuccessAt: null,
            lastUnmapped: null,
          },
          {
            event: "q2",
            source: "pulselive:v1",
            consecutiveFailures: 1,
            lastError: null,
            lastAttemptAt: null,
            lastSuccessAt: new Date("2026-10-21T13:00:00Z"),
            lastUnmapped: [{ riderRef: "rider-4", name: "Piloto Cuatro" }],
          },
        ],
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByText("carrera principal").closest("tr")).toHaveClass("bad");
      expect(screen.getByText("timeout de la fuente")).toBeInTheDocument();
      expect(screen.getByText("Q2").closest("tr")).not.toHaveClass("bad");
      expect(screen.getByText("Piloto Cuatro")).toBeInTheDocument();
    });

    it("muestra los mapeos de pilotos y permite eliminarlos", async () => {
      mockLoaded();
      mockRiderMappings({
        data: [
          {
            source: "pulselive:v1",
            riderRef: "rider-1",
            riderId: r1,
            riderName: "Piloto Uno",
          },
        ],
      });
      const { deleteMapping } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByText("rider-1")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Eliminar" }));
      await user.click(screen.getByRole("button", { name: "Sí, eliminar el mapeo" }));

      expect(deleteMapping).toHaveBeenCalledWith({ riderRef: "rider-1" });
    });

    it("añade un mapeo de piloto desde el formulario", async () => {
      mockLoaded();
      const { setMapping } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.type(screen.getByLabelText("Referencia en la fuente"), "rider-2");
      await user.selectOptions(screen.getByLabelText("Piloto del mercado"), r2);
      await user.click(screen.getByRole("button", { name: "Añadir mapeo" }));

      expect(setMapping).toHaveBeenCalledWith({ riderRef: "rider-2", riderId: r2 });
    });

    it("muestra el error local al añadir un mapeo sin referencia ni piloto", async () => {
      mockLoaded();
      const { setMapping } = mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.click(screen.getByRole("button", { name: "Añadir mapeo" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "La referencia del piloto en la fuente no puede estar vacía",
      );
      expect(setMapping).not.toHaveBeenCalled();
    });

    it("muestra el error del servidor de las mutations de la fuente", async () => {
      mockLoaded();
      mockResult(trpc.results.linkSource.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("El GP ya está vinculado a otra fuente"),
        data: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "El GP ya está vinculado a otra fuente",
      );
    });

    it("al vincular con éxito: refetch de GPs y el selector de evento vuelve a vacío", async () => {
      const gpsRefetch = vi.fn();
      mockLoaded();
      mockGps({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [gp],
        refetch: gpsRefetch,
      });
      mockSourceEvents({ data: [{ eventRef: "ev-1", name: "MotoGP — Indonesia" }] });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento de la fuente"), "ev-1");
      await user.click(screen.getByRole("button", { name: "Vincular GP" }));

      const options = asMockFn(trpc.results.linkSource.useMutation).mock
        .calls[0]?.[0] as { onSuccess: () => void };
      act(() => {
        options.onSuccess();
      });

      expect(gpsRefetch).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Evento de la fuente")).toHaveValue("");
    });

    it("al desvincular con éxito: refetch de GPs", async () => {
      const gpsRefetch = vi.fn();
      mockLoaded();
      mockGps({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [gpLinked],
        refetch: gpsRefetch,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Desvincular" }));
      await user.click(screen.getByRole("button", { name: "Sí, desvincular la fuente" }));

      const options = asMockFn(trpc.results.unlinkSource.useMutation).mock
        .calls[0]?.[0] as { onSuccess: () => void };
      act(() => {
        options.onSuccess();
      });

      expect(gpsRefetch).toHaveBeenCalledTimes(1);
    });

    it("al añadir un mapeo con éxito: refetch de mapeos y los campos vuelven a vacío", async () => {
      const mappingsRefetch = vi.fn();
      mockLoaded();
      mockRiderMappings({ refetch: mappingsRefetch });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.type(screen.getByLabelText("Referencia en la fuente"), "rider-2");
      await user.selectOptions(screen.getByLabelText("Piloto del mercado"), r2);
      await user.click(screen.getByRole("button", { name: "Añadir mapeo" }));

      const options = asMockFn(trpc.results.setRiderMapping.useMutation).mock
        .calls[0]?.[0] as { onSuccess: () => void };
      act(() => {
        options.onSuccess();
      });

      expect(mappingsRefetch).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Referencia en la fuente")).toHaveValue("");
      expect(screen.getByLabelText("Piloto del mercado")).toHaveValue("");
    });

    it("al eliminar un mapeo con éxito: refetch de mapeos", async () => {
      const mappingsRefetch = vi.fn();
      mockLoaded();
      mockRiderMappings({
        data: [
          {
            source: "pulselive:v1",
            riderRef: "rider-1",
            riderId: r1,
            riderName: "Piloto Uno",
          },
        ],
        refetch: mappingsRefetch,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Eliminar" }));
      await user.click(screen.getByRole("button", { name: "Sí, eliminar el mapeo" }));

      const options = asMockFn(trpc.results.deleteRiderMapping.useMutation).mock
        .calls[0]?.[0] as { onSuccess: () => void };
      act(() => {
        options.onSuccess();
      });

      expect(mappingsRefetch).toHaveBeenCalledTimes(1);
    });

    it("muestra el error al cargar el catálogo de eventos de la fuente", async () => {
      mockLoaded();
      mockSourceEvents({
        data: undefined,
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("fallo del catálogo"),
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByText(
          "No se pudieron cargar los eventos de la fuente: fallo del catálogo",
        ),
      ).toBeInTheDocument();
    });

    it("muestra el error al cargar el estado del auto-import", async () => {
      mockLoaded();
      mockSourceState({
        data: undefined,
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("fallo de estado"),
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByText("No se pudo cargar el estado: fallo de estado"),
      ).toBeInTheDocument();
    });

    it("muestra el error al cargar los mapeos de pilotos", async () => {
      mockLoaded();
      mockRiderMappings({
        data: undefined,
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("fallo de mapeos"),
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByText("No se pudieron cargar los mapeos: fallo de mapeos"),
      ).toBeInTheDocument();
    });

    it("muestra el resumen de la importación automática sin pilotos sin mapear", async () => {
      mockGps({ isPending: false, isError: false, isSuccess: true, data: [gpLinked] });
      mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
      mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
      mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
      mockGpState();
      mockSourceState();
      mockRiderMappings();
      mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(
        screen.getByRole("button", { name: "Importar carrera principal" }),
      );

      const options = asMockFn(trpc.results.importFromSource.useMutation).mock
        .calls[0]?.[0] as {
        onSuccess: (data: ImportEventFromSourceResult) => void;
      };
      act(() => {
        options.onSuccess({
          created: 2,
          corrected: 1,
          unchanged: 0,
          kept: 1,
          unmapped: [],
          recalculated: false,
          resultsVersion: null,
          lineupsScored: 0,
        });
      });

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent(
        "Importación automática (carrera principal): 2 creados, 1 corregidos, 0 sin cambios y 1 conservados.",
      );
      expect(status).not.toHaveTextContent("Sin mapear");
    });

    it("muestra los issues Zod del error de las mutations de la fuente", async () => {
      mockLoaded();
      mockResult(trpc.results.linkSource.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: true,
        isSuccess: false,
        error: clientError("Invalid input", {
          zod: {
            issues: [
              {
                path: ["eventRef"],
                message: "El evento de la fuente no existe en el catálogo",
              },
            ],
          },
          code: "BAD_REQUEST",
          message: "Invalid input",
        }),
        data: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("El evento de la fuente no existe en el catálogo");
      expect(alert).not.toHaveTextContent("Invalid input");
    });
  });

  describe("US-18: definitivo + estados de evento (ADR-0020)", () => {
    /** gpState con 12 resultados provisionales (botón 'Marcar definitivo' visible). */
    function withResults() {
      mockGpState({
        data: {
          gpId,
          gpName: "GP de España",
          round: 1,
          seasonName: "Temporada 2026",
          definitive: false,
          resultsVersion: null,
          counts: { provisional: 12, definitive: 0, corrected: 0 },
          totalResults: 12,
          lineups: 1,
        },
      });
    }

    it("muestra el estado provisional y el botón 'Marcar definitivo' cuando hay resultados", async () => {
      mockLoaded();
      withResults();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByRole("heading", { name: /3\. Definitivo y estados de evento/ }),
      ).toBeInTheDocument();
      expect(screen.getByText("provisional")).toBeInTheDocument();
      expect(
        screen.getByText(/12 provisional\(es\), 0 definitivo\(s\), 0 corregido\(s\)/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Marcar definitivo" }),
      ).toBeInTheDocument();
    });

    it("oculta el botón y avisa cuando el GP no tiene resultados", async () => {
      mockLoaded(); // gpState por defecto: 0 resultados
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByText("Importa los resultados antes de marcar el GP definitivo."),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Marcar definitivo" }),
      ).not.toBeInTheDocument();
    });

    it("muestra el estado definitivo con su versión y sin botón", async () => {
      mockLoaded();
      mockGpState({
        data: {
          gpId,
          gpName: "GP de España",
          round: 1,
          seasonName: "Temporada 2026",
          definitive: true,
          resultsVersion: "rv-1",
          counts: { provisional: 0, definitive: 12, corrected: 0 },
          totalResults: 12,
          lineups: 1,
        },
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByText("definitivo (rv-1)")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Marcar definitivo" }),
      ).not.toBeInTheDocument();
    });

    it("muestra el estado definitivo sin versión cuando no hay", async () => {
      mockLoaded();
      mockGpState({
        data: {
          gpId,
          gpName: "GP de España",
          round: 1,
          seasonName: "Temporada 2026",
          definitive: true,
          resultsVersion: null,
          counts: { provisional: 0, definitive: 12, corrected: 0 },
          totalResults: 12,
          lineups: 1,
        },
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByText("definitivo")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Marcar definitivo" }),
      ).not.toBeInTheDocument();
    });

    it("muestra el error si no se pudo cargar el estado", async () => {
      mockLoaded();
      mockGpState({
        data: undefined,
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("fallo de BD"),
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(
        screen.getByText("No se pudo cargar el estado: fallo de BD"),
      ).toBeInTheDocument();
    });

    it("pide confirmación y muta con el gpId al marcar definitivo", async () => {
      mockLoaded();
      withResults();
      const { markDefinitive } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Marcar definitivo" }));

      // Confirmación con impacto (patrón del sistema) antes de mutar.
      expect(
        screen.getByRole("dialog", { name: "Marcar R1 · GP de España como definitivo" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Sí, marcar definitivo" }));
      expect(markDefinitive).toHaveBeenCalledWith({ gpId });
    });

    it("confirma el recálculo tras una versión previa (reconfirmación, US-19)", async () => {
      mockLoaded();
      // GP ya recalculado (rv-1) con filas corregidas: la confirmación
      // apunta a un recálculo posterior, no al primer (rv-1).
      mockGpState({
        data: {
          gpId,
          gpName: "GP de España",
          round: 1,
          seasonName: "Temporada 2026",
          definitive: false,
          resultsVersion: "rv-1",
          counts: { provisional: 2, definitive: 0, corrected: 2 },
          totalResults: 4,
          lineups: 1,
        },
      });
      const { markDefinitive } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Marcar definitivo" }));

      const dialog = screen.getByRole("dialog", {
        name: "Marcar R1 · GP de España como definitivo",
      });
      expect(dialog).toHaveTextContent(/recálculo tras rv-1/);
      expect(dialog).toHaveTextContent(
        "Afecta a 2 fila(s) provisional(es) y 2 corregida(s).",
      );
      await user.click(screen.getByRole("button", { name: "Sí, marcar definitivo" }));
      expect(markDefinitive).toHaveBeenCalledWith({ gpId });
    });

    it("no muta si se cancela la confirmación de marcar definitivo", async () => {
      mockLoaded();
      withResults();
      const { markDefinitive } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Marcar definitivo" }));
      await user.click(screen.getByRole("button", { name: "No, volver" }));

      expect(markDefinitive).not.toHaveBeenCalled();
    });

    it("muestra el resumen de éxito al marcar definitivo", async () => {
      mockLoaded();
      withResults();
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Marcar definitivo" }));
      await user.click(screen.getByRole("button", { name: "Sí, marcar definitivo" }));

      const options = asMockFn(trpc.results.markDefinitive.useMutation).mock
        .calls[0]?.[0] as { onSuccess: (data: MarkDefinitiveResult) => void };
      act(() => {
        options.onSuccess({
          madeDefinitive: 12,
          reconfirmed: 0,
          alreadyDefinitive: 0,
          lineupsScored: 1,
          resultsVersion: "rv-1",
          noop: false,
        });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "GP definitivo: 12 fila(s) a definitivo, 0 reconfirmadas y 1 lineups puntuados (rv-1).",
      );
    });

    it("muestra el resumen de no-op si el GP ya era definitivo", async () => {
      mockLoaded();
      withResults();
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      await user.click(screen.getByRole("button", { name: "Marcar definitivo" }));
      await user.click(screen.getByRole("button", { name: "Sí, marcar definitivo" }));

      const options = asMockFn(trpc.results.markDefinitive.useMutation).mock
        .calls[0]?.[0] as { onSuccess: (data: MarkDefinitiveResult) => void };
      act(() => {
        options.onSuccess({
          madeDefinitive: 0,
          reconfirmed: 0,
          alreadyDefinitive: 12,
          lineupsScored: 0,
          resultsVersion: "rv-1",
          noop: true,
        });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "El GP ya era definitivo (sin cambios).",
      );
    });

    it("muestra el error del servidor al marcar definitivo", async () => {
      mockLoaded();
      withResults();
      mockResult(trpc.results.markDefinitive.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error(
          "El GP no tiene resultados: importa los resultados antes de marcarlo definitivo.",
        ),
        data: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "El GP no tiene resultados: importa los resultados antes de marcarlo definitivo.",
      );
    });

    it("cancela un evento con confirmación y muta", async () => {
      mockLoaded();
      const { cancelEvent } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Cancelar evento" }));

      // El impacto irreversible se muestra como aviso dentro del diálogo
      // (sin resultados importados: se dice expresamente).
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El evento no puntuará (0 para todos) y el recálculo lo saltará.",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "El evento aún no tiene resultados importados.",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Acción irreversible: no se puede des-cancelar ni neutralizar después.",
      );
      await user.click(screen.getByRole("button", { name: "Sí, cancelar el evento" }));
      expect(cancelEvent).toHaveBeenCalledWith({ gpId, eventId });
    });

    it("cuantifica el impacto del diálogo según las filas del evento", async () => {
      const withRows: GpEventView = { ...event, resultCount: 7 };
      mockLoaded();
      mockGpEvents({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [withRows],
      });
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Afecta a las 7 fila(s) de resultado de este evento.",
      );
      await user.click(screen.getByRole("button", { name: "No, volver" }));

      // Neutralizar no es irreversible: el impacto se muestra sin aviso.
      await user.click(screen.getByRole("button", { name: "Neutralizar evento" }));
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "resultado oficial neutralizado",
      );
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Afecta a las 7 fila(s) de resultado de este evento.",
      );
    });

    it("no muta si se cancela la confirmación de cancelar un evento", async () => {
      mockLoaded();
      const { cancelEvent } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
      await user.click(screen.getByRole("button", { name: "No, volver" }));

      expect(cancelEvent).not.toHaveBeenCalled();
    });

    it("muestra el éxito al cancelar un evento", async () => {
      mockLoaded();
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
      await user.click(screen.getByRole("button", { name: "Sí, cancelar el evento" }));

      const options = asMockFn(trpc.results.cancelEvent.useMutation).mock
        .calls[0]?.[0] as { onSuccess: (data: EventFlagResult) => void };
      act(() => {
        options.onSuccess({ cancelled: true, neutralized: false, noop: false });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "Evento cancelado: no puntuará (0 para todos).",
      );
    });

    it("muestra el no-op si el evento ya estaba cancelado", async () => {
      mockLoaded();
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
      await user.click(screen.getByRole("button", { name: "Sí, cancelar el evento" }));

      const options = asMockFn(trpc.results.cancelEvent.useMutation).mock
        .calls[0]?.[0] as { onSuccess: (data: EventFlagResult) => void };
      act(() => {
        options.onSuccess({ cancelled: true, neutralized: false, noop: true });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "El evento ya estaba cancelado (sin cambios).",
      );
    });

    it("neutraliza un evento con confirmación y muta", async () => {
      mockLoaded();
      const { neutralizeEvent } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Neutralizar evento" }));
      await user.click(screen.getByRole("button", { name: "Sí, neutralizar el evento" }));
      expect(neutralizeEvent).toHaveBeenCalledWith({ gpId, eventId });
    });

    it("muestra el éxito al neutralizar un evento", async () => {
      mockLoaded();
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Neutralizar evento" }));
      await user.click(screen.getByRole("button", { name: "Sí, neutralizar el evento" }));

      const options = asMockFn(trpc.results.neutralizeEvent.useMutation).mock
        .calls[0]?.[0] as { onSuccess: (data: EventFlagResult) => void };
      act(() => {
        options.onSuccess({ cancelled: false, neutralized: true, noop: false });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "Evento neutralizado: se puntuará con el resultado oficial declarado.",
      );
    });

    it("muestra el no-op si el evento ya estaba neutralizado", async () => {
      mockLoaded();
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      await user.click(screen.getByRole("button", { name: "Neutralizar evento" }));
      await user.click(screen.getByRole("button", { name: "Sí, neutralizar el evento" }));

      const options = asMockFn(trpc.results.neutralizeEvent.useMutation).mock
        .calls[0]?.[0] as { onSuccess: (data: EventFlagResult) => void };
      act(() => {
        options.onSuccess({ cancelled: false, neutralized: true, noop: true });
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "El evento ya estaba neutralizado (sin cambios).",
      );
    });

    it("muestra el error del servidor al cancelar un evento", async () => {
      mockLoaded();
      mockResult(trpc.results.cancelEvent.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: true,
        isSuccess: false,
        error: new Error("El evento no existe en este GP."),
        data: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByRole("alert")).toHaveTextContent(
        "El evento no existe en este GP.",
      );
    });

    it("muestra 'Consultando…' mientras carga el estado del GP", async () => {
      mockLoaded();
      mockGpState({
        data: undefined,
        isPending: true,
        isError: false,
        isSuccess: false,
        error: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      expect(screen.getByText("Consultando…")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Marcar definitivo" }),
      ).not.toBeInTheDocument();
    });

    it("rechaza localmente marcar definitivo con un gpId inválido", async () => {
      const badGpId = "gp-invalido";
      mockLoaded();
      mockGps({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [{ ...gp, id: badGpId }],
      });
      withResults();
      const { markDefinitive } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), badGpId);

      await user.click(screen.getByRole("button", { name: "Marcar definitivo" }));
      await user.click(screen.getByRole("button", { name: "Sí, marcar definitivo" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "El identificador de GP no es válido",
      );
      expect(markDefinitive).not.toHaveBeenCalled();
    });

    it("rechaza localmente cancelar un evento con un eventId inválido", async () => {
      const badEventId = "evento-invalido";
      mockLoaded();
      mockGpEvents({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [{ ...event, id: badEventId }],
      });
      const { cancelEvent } = mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), badEventId);

      await user.click(screen.getByRole("button", { name: "Cancelar evento" }));
      await user.click(screen.getByRole("button", { name: "Sí, cancelar el evento" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "El identificador de evento no es válido",
      );
      expect(cancelEvent).not.toHaveBeenCalled();
    });

    it("solo ofrece transiciones que el servidor ejecutará (flags reales, ADR-0020)", async () => {
      const cancelled: GpEventView = {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        type: "sprint",
        orderNum: 1,
        status: "scheduled",
        cancelled: true,
        neutralized: false,
        resultCount: 3,
      };
      const neutralized: GpEventView = {
        id: eventId,
        type: "race",
        orderNum: 2,
        status: "scheduled",
        cancelled: false,
        neutralized: true,
        resultCount: 5,
      };
      mockLoaded();
      mockGpEvents({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [cancelled, neutralized],
      });
      mockDefinitiveMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      // Los flags reales (fuente de verdad) son visibles; sin evento
      // elegido no hay acciones.
      expect(screen.getAllByText(/— cancelado \(no puntúa\)/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/— neutralizado/).length).toBeGreaterThan(0);
      expect(
        screen.queryByRole("button", { name: "Cancelar evento" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Neutralizar evento" }),
      ).not.toBeInTheDocument();

      // Evento neutralizado: no se re-ofrece neutralizar (idempotente; el
      // servidor respondería noop); solo se ofrece cancelar.
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);
      expect(screen.getAllByRole("button", { name: "Cancelar evento" })).toHaveLength(1);
      expect(
        screen.queryByRole("button", { name: "Neutralizar evento" }),
      ).not.toBeInTheDocument();

      // Evento cancelado: estado terminal — ninguna transición se ofrece.
      // Neutralizar después de cancelar sería un no-op (el evento queda
      // excluido del recálculo; cancelar es irreversible).
      await user.selectOptions(screen.getByLabelText("Evento"), cancelled.id);
      expect(screen.getAllByText("sin transiciones")).toHaveLength(1);
      expect(
        screen.queryByRole("button", { name: "Cancelar evento" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Neutralizar evento" }),
      ).not.toBeInTheDocument();
    });

    it("explica la distinción cancelar/neutralizar ANTES de la acción (impeccable P1)", async () => {
      mockLoaded();
      render(<ResultsSection seasons={[season]} />);
      await selectEvent();

      // La explicación vive junto a las acciones, no solo dentro del
      // diálogo de confirmación: el operador entiende el coste antes de
      // decidir (la decisión más cara del panel).
      const help = screen.getByText(/Cancelar: el evento no puntúa/);
      expect(help).toHaveTextContent("la decisión es irreversible");
      expect(help).toHaveTextContent(
        "Neutralizar: se puntúa con el resultado oficial declarado.",
      );
    });

    it("muestra los estados de evento como lista: una fila por evento (impeccable P2)", async () => {
      mockLoaded();
      render(<ResultsSection seasons={[season]} />);
      await selectEvent();

      // La fila del evento elegido lleva su etiqueta Y la acción en el
      // mismo elemento de lista (antes: párrafo con acciones en línea).
      const row = screen
        .getAllByRole("listitem")
        .find((li) => li.textContent?.includes("carrera principal — sin resultados"));
      expect(row).toBeDefined();
      expect(row).toContainElement(
        screen.getByRole("button", { name: "Cancelar evento" }),
      );
    });

    it("colapsa el paso manual con fuente vinculada y lo reabre con el summary", async () => {
      mockGps({ isPending: false, isError: false, isSuccess: true, data: [gpLinked] });
      mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
      mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
      mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
      mockGpState();
      mockSourceState();
      mockSourceEvents();
      mockRiderMappings();
      mockSourceMutations();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      const summary = screen.getByText("2. Importación manual — carrera principal");
      const details = summary.closest("details")!;
      expect(details).not.toHaveAttribute("open");

      await user.click(summary);
      expect(details).toHaveAttribute("open");
    });

    it("protege los cambios sin importar al cambiar de contexto", async () => {
      const otherEvent: GpEventView = {
        ...event,
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        type: "sprint",
      };
      mockLoaded();
      mockGpEvents({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [event, otherEvent],
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      // Editar la tabla deja el formulario «con cambios sin importar».
      await user.click(screen.getByLabelText(`Salió: ${riders[0]?.name}`));

      // El paso 2 narra el diff: filas importadas y correcciones pendientes.
      expect(screen.getByText(/1 modificada\(s\) sin importar/)).toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Evento"), otherEvent.id);

      // El cambio no se aplica sin confirmar el descarte.
      expect(
        screen.getByRole("dialog", { name: "Tienes resultados sin importar" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "No, volver" }));
      expect(screen.getByLabelText("Evento")).toHaveValue(eventId);

      await user.selectOptions(screen.getByLabelText("Evento"), otherEvent.id);
      await user.click(screen.getByRole("button", { name: "Sí, descartar los cambios" }));
      expect(screen.getByLabelText("Evento")).toHaveValue(otherEvent.id);
    });

    it("persiste la selección en la URL y la restaura al recargar", async () => {
      mockLoaded();
      const { unmount } = render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      const params = new URLSearchParams(window.location.search);
      expect(params.get("season")).toBe(seasonId);
      expect(params.get("gp")).toBe(gpId);
      expect(params.get("event")).toBe(eventId);

      // Un render nuevo (equivalente a F5): el router entrega el query
      // string y el ritual lo recupera de la URL.
      navigation.searchParams = new URLSearchParams(window.location.search);
      unmount();
      render(<ResultsSection seasons={[season]} />);
      expect(screen.getByLabelText("Temporada")).toHaveValue(seasonId);
      expect(screen.getByLabelText("GP")).toHaveValue(gpId);
      expect(screen.getByLabelText("Evento")).toHaveValue(eventId);
    });

    it("muestra los issues Zod del error de marcar definitivo", async () => {
      mockLoaded();
      withResults();
      mockResult(trpc.results.markDefinitive.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: true,
        isSuccess: false,
        error: clientError("Invalid input", {
          zod: {
            issues: [{ path: ["gpId"], message: "El identificador de GP no es válido" }],
          },
          code: "BAD_REQUEST",
          message: "Invalid input",
        }),
        data: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("El identificador de GP no es válido");
      expect(alert).not.toHaveTextContent("Invalid input");
    });

    it("muestra los issues Zod del error de cancelar un evento", async () => {
      mockLoaded();
      mockResult(trpc.results.cancelEvent.useMutation, {
        mutate: vi.fn(),
        isPending: false,
        isError: true,
        isSuccess: false,
        error: clientError("Invalid input", {
          zod: {
            issues: [
              { path: ["eventId"], message: "El identificador de evento no es válido" },
            ],
          },
          code: "BAD_REQUEST",
          message: "Invalid input",
        }),
        data: undefined,
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("El identificador de evento no es válido");
      expect(alert).not.toHaveTextContent("Invalid input");
    });
  });

  describe("Handoff consola → ritual (adapt: ?season=&gp=)", () => {
    const otherGpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const otherEventId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const otherGp: GpView = {
      ...gp,
      id: otherGpId,
      round: 2,
      name: "GP de Italia",
      date: new Date("2026-04-26T14:00:00Z"),
      events: [
        {
          id: otherEventId,
          type: "race",
          orderNum: 2,
          startTime: null,
          status: "scheduled",
        },
      ],
    };

    it("prellena la cascada al montar con ?season=&gp=", () => {
      navigation.searchParams = new URLSearchParams({
        season: seasonId,
        gp: gpId,
      });
      mockLoaded();
      render(<ResultsSection seasons={[season]} />);

      expect(screen.getByLabelText("Temporada")).toHaveValue(seasonId);
      expect(screen.getByLabelText("GP")).toHaveValue(gpId);
      expect(screen.getByLabelText("Evento")).toHaveValue("");
    });

    it("prellena la cascada completa al montar con ?season=&gp=&event=", () => {
      navigation.searchParams = new URLSearchParams({
        season: seasonId,
        gp: gpId,
        event: eventId,
      });
      mockLoaded();
      render(<ResultsSection seasons={[season]} />);

      expect(screen.getByLabelText("Temporada")).toHaveValue(seasonId);
      expect(screen.getByLabelText("GP")).toHaveValue(gpId);
      expect(screen.getByLabelText("Evento")).toHaveValue(eventId);
    });

    it("aplica un cambio de contexto del router (click en la CTA de la consola)", async () => {
      mockLoaded();
      mockGps({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [gp, otherGp],
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      // La consola «Fin de semana» navega a ?season=&gp=<otro GP>: el
      // router repinta con los nuevos params y el ritual los aplica,
      // vaciando el evento (semántica de la cascada).
      act(() => {
        navigation.searchParams = new URLSearchParams({
          season: seasonId,
          gp: otherGpId,
        });
      });

      expect(screen.getByLabelText("GP")).toHaveValue(otherGpId);
      expect(screen.getByLabelText("Evento")).toHaveValue("");
    });

    it("protege el trabajo pendiente ante un cambio de URL y permite reintentar tras cancelar", async () => {
      mockLoaded();
      mockGps({
        isPending: false,
        isError: false,
        isSuccess: true,
        data: [gp, otherGp],
      });
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
      await user.selectOptions(screen.getByLabelText("GP"), gpId);
      await user.selectOptions(screen.getByLabelText("Evento"), eventId);

      // Cambios sin importar en la tabla.
      await user.click(screen.getByLabelText(`Salió: ${riders[0]?.name}`));
      expect(screen.getByText(/1 modificada\(s\) sin importar/)).toBeInTheDocument();

      // La CTA de la consola navega a otro GP: se pide descartar el trabajo.
      act(() => {
        navigation.searchParams = new URLSearchParams({
          season: seasonId,
          gp: otherGpId,
        });
      });
      expect(
        screen.getByRole("dialog", { name: "Tienes resultados sin importar" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("GP")).toHaveValue(gpId);
      expect(screen.getByLabelText("Evento")).toHaveValue(eventId);

      // Cancelar conserva el trabajo y revierte la URL al contexto de la
      // cascada (la fuente de verdad): un re-click en la CTA re-abre la
      // confirmación en vez de ser un no-op del router.
      await user.click(screen.getByRole("button", { name: "No, volver" }));
      const params = new URLSearchParams(window.location.search);
      expect(params.get("season")).toBe(seasonId);
      expect(params.get("gp")).toBe(gpId);
      expect(params.get("event")).toBe(eventId);

      act(() => {
        navigation.searchParams = new URLSearchParams({
          season: seasonId,
          gp: otherGpId,
        });
      });
      expect(
        screen.getByRole("dialog", { name: "Tienes resultados sin importar" }),
      ).toBeInTheDocument();

      // Confirmar descarta el trabajo y aplica el contexto de la consola.
      await user.click(
        screen.getByRole("button", { name: "Sí, descartar los cambios" }),
      );
      expect(screen.getByLabelText("GP")).toHaveValue(otherGpId);
      expect(screen.getByLabelText("Evento")).toHaveValue("");
    });

    it("no pide descartar si el contexto de la URL es el de la cascada actual", async () => {
      navigation.searchParams = new URLSearchParams({
        season: seasonId,
        gp: gpId,
        event: eventId,
      });
      mockLoaded();
      render(<ResultsSection seasons={[season]} />);
      const user = userEvent.setup();
      expect(screen.getByLabelText("GP")).toHaveValue(gpId);
      expect(screen.getByLabelText("Evento")).toHaveValue(eventId);

      // Cambios sin importar en la tabla.
      await user.click(screen.getByLabelText(`Salió: ${riders[0]?.name}`));

      // Re-navegar al mismo contexto (re-click en la CTA) no debe abrir la
      // confirmación de descarte: la cascada ya está en ese contexto.
      act(() => {
        navigation.searchParams = new URLSearchParams({
          season: seasonId,
          gp: gpId,
          event: eventId,
        });
      });
      expect(
        screen.queryByRole("dialog", { name: "Tienes resultados sin importar" }),
      ).not.toBeInTheDocument();
      expect(screen.getByLabelText("GP")).toHaveValue(gpId);
      expect(screen.getByLabelText("Evento")).toHaveValue(eventId);
    });
  });
});
