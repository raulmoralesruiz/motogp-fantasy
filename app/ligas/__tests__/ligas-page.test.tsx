// @vitest-environment jsdom
/**
 * Tests de `app/ligas/ligas-page.tsx` (US-23, leagues.md §3; US-24,
 * leagues.md §2):
 * - Mis ligas (nombre, tipo, miembros, admin) → enlace al detalle.
 * - Directorio de ligas públicas (US-24): lista, vacío, error, enlaces.
 * - Formulario de creación (nombre/descripción/tipo/visibilidad/min-máx/
 *   modo de entrada/duración) → `leagues.create` con el payload correcto.
 * - Éxito: la liga creada + enlace al detalle.
 * - Error: el mensaje del servidor.
 *
 * La rotación de código (leagues.md §4) vive en el detalle (US-24) y se
 * cubre en `__tests__/league-detail-page.test.tsx`.
 *
 * Sobre el `trpc` mockeado (test/trpc-mock): los callbacks de éxito/error
 * de las mutations se invocan manualmente (patrón de los tests de lineups).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { asMockFn, mockResult, resetTrpcMocks } from "../../../test/trpc-mock";
import { act, fireEvent, render, screen, userEvent, within } from "../../../test/rtl";

import LigasPage from "../ligas-page";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

import { trpc } from "@/trpc/client";

const LEAGUE = {
  id: "league-1",
  name: "Liga de los amigos",
  description: "Solo para la familia",
  type: "private",
  visibility: "private",
  minMembers: 2,
  maxMembers: 50,
  entryMode: "code",
  status: "active",
  adjustedRankingEnabled: false,
  startDate: null,
  endDate: null,
  activeMembers: 3,
  members: [{ username: "piloto1", role: "admin" }],
  isAdmin: true,
  code: "ABC123XYZ9",
};

/** Liga cerrada (F3 P2: "mis ligas" la marca, no la muestra idéntica). */
const CLOSED_LEAGUE = {
  ...LEAGUE,
  id: "league-2",
  name: "Liga de la temporada pasada",
  status: "finished",
  isAdmin: false,
  code: null,
};

const PUBLIC_LEAGUE = {
  id: "pub-1",
  name: "Liga pública general",
  description: "Comunidad abierta",
  type: "public",
  minMembers: 2,
  maxMembers: 50,
  entryMode: "mixed",
  activeMembers: 12,
  createdAt: new Date("2026-10-01T00:00:00Z"),
};

const PUBLIC_LEAGUE_INVITE = {
  id: "pub-2",
  name: "Liga por invitación",
  description: null,
  type: "public",
  minMembers: 2,
  maxMembers: 10,
  entryMode: "invite",
  activeMembers: 3,
  createdAt: new Date("2026-10-02T00:00:00Z"),
};

function renderLigas(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockMyLeagues(data: unknown) {
  mockResult(trpc.leagues.myLeagues.useQuery, {
    data,
    isPending: false,
    isError: false,
  });
}

function mockPublicLeagues(data: unknown, isError = false) {
  mockResult(trpc.leagues.listPublic.useQuery, {
    data,
    isPending: false,
    isError,
    error: isError ? new Error("fallo") : undefined,
  });
}

function mockMe(isError = false) {
  mockResult(trpc.auth.me.useQuery, {
    data: isError ? undefined : { username: "yo", email: "yo@liga.com", roles: [] },
    isPending: false,
    isError,
    error: isError ? new Error("No estás autenticado") : undefined,
  });
}

/** Mockea una mutation y devuelve el `mutate` (para inspeccionar el input). */
function mockMutation(hook: unknown): ReturnType<typeof vi.fn> {
  const mutate = vi.fn();
  mockResult(hook, {
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
  });
  return mutate;
}

/**
 * Opciones de la mutation (onSuccess/onError) de la ÚLTIMA invocación del
 * hook: las opciones de renders anteriores cierran sobre estado viejo.
 */
function mutationOptions(hook: unknown): {
  onSuccess?: (result: unknown) => void;
  onError?: (err: Error) => void;
} {
  const calls = asMockFn(hook).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as {
    onSuccess?: (result: unknown) => void;
    onError?: (err: Error) => void;
  };
}

describe("LigasPage (US-23/US-24)", () => {
  beforeEach(() => {
    resetTrpcMocks();
    mockMe();
    mockPublicLeagues([PUBLIC_LEAGUE, PUBLIC_LEAGUE_INVITE]);
  });

  it("muestra el estado pendiente de mis ligas", () => {
    mockResult(trpc.leagues.myLeagues.useQuery, {
      data: undefined,
      isPending: true,
      isError: false,
    });
    renderLigas(<LigasPage />);
    expect(screen.getAllByText("Consultando…").length).toBeGreaterThan(0);
  });

  it("muestra un error si la lista de ligas falla", () => {
    mockResult(trpc.leagues.myLeagues.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error("fallo de red"),
    });
    renderLigas(<LigasPage />);
    expect(
      screen.getByText("No se pudo cargar tu lista de ligas."),
    ).toBeInTheDocument();
  });

  it("sin sesión: estado neutro con salida, sin error en rojo (F3 P2)", () => {
    mockMe(true);
    renderLigas(<LigasPage />);

    // Ni el error rojo de la lista ni el formulario de creación (que
    // fallaría al enviar): un estado neutro con las salidas a /login y
    // /registro (patrón de /unirse, US-25).
    expect(
      screen.queryByText("No se pudo cargar tu lista de ligas."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Crear liga" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Para ver tus ligas o crear una necesitas una cuenta/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "crea una cuenta" })).toHaveAttribute(
      "href",
      "/registro",
    );
  });

  it("muestra el vacío elegante si no hay ligas propias", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);
    expect(
      screen.getByText(/Todavía no estás en ninguna liga/),
    ).toBeInTheDocument();
  });

  it("muestra mis ligas con tipo, miembros, admin y enlace al detalle", () => {
    mockMyLeagues([LEAGUE]);
    renderLigas(<LigasPage />);

    expect(screen.getByText("Liga de los amigos")).toBeInTheDocument();
    // F3 P1/P2: fila `.status` con columnas unificadas (tipo · actual/máx ·
    // modo de entrada) — el mismo conjunto que el directorio.
    expect(screen.getByText(/privada · 3\/50 miembros · por código/)).toBeInTheDocument();
    expect(screen.getByText("· admin")).toBeInTheDocument();
    // La lista de datos vive en `.status` (F3, como en /resultados y /lineups).
    expect(screen.getByText("Liga de los amigos").closest("ul")).toHaveClass(
      "status",
    );
    // Enlace al detalle (US-24): el código ya no se muestra en la lista.
    const link = screen.getByRole("link", { name: "Liga de los amigos" });
    expect(link).toHaveAttribute("href", "/ligas/league-1");
    expect(screen.queryByText("ABC123XYZ9")).not.toBeInTheDocument();
  });

  it("marca una liga no activa en mis ligas (F3 P2: no es idéntica a una activa)", () => {
    mockMyLeagues([LEAGUE, CLOSED_LEAGUE]);
    renderLigas(<LigasPage />);

    // La activa no lleva sufijo de estado.
    expect(
      screen.getByText("privada · 3/50 miembros · por código"),
    ).toBeInTheDocument();
    // La finalizada se marca explícitamente en la fila.
    expect(
      screen.getByText("privada · 3/50 miembros · por código · finalizada"),
    ).toBeInTheDocument();
  });

  it("muestra el directorio de ligas públicas (US-24) con enlace", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    expect(screen.getByText("Liga pública general")).toBeInTheDocument();
    expect(screen.getByText(/Comunidad abierta/)).toBeInTheDocument();
    expect(screen.getByText(/12\/50 miembros/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Liga pública general" });
    expect(link).toHaveAttribute("href", "/ligas/pub-1");
  });

  it("enlaza a la unión por código (/unirse, US-25)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const link = screen.getByRole("link", { name: "Únete a una liga" });
    expect(link).toHaveAttribute("href", "/unirse");
  });

  it("muestra el modo de entrada legible de cada liga del directorio", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    // El modo de entrada se lee en la fila de cada liga del directorio
    // (mixed → "código o invitación"; invite → "solo invitación", leagues.md §3).
    // Se acota a la lista de datos: la capa de ayuda del formulario también
    // menciona "código o invitación" y no debe interferir.
    const directory = screen
      .getByText("Liga pública general")
      .closest("ul") as HTMLElement;
    expect(
      within(directory).getByText(/código o invitación/),
    ).toBeInTheDocument();
    expect(within(directory).getByText(/solo invitación/)).toBeInTheDocument();
  });

  it("muestra el vacío del directorio si no hay públicas", () => {
    mockMyLeagues([]);
    mockPublicLeagues([]);
    renderLigas(<LigasPage />);
    expect(
      screen.getByText(/Todavía no hay ligas públicas/),
    ).toBeInTheDocument();
  });

  it("muestra un error si el directorio falla", () => {
    mockMyLeagues([]);
    mockPublicLeagues(undefined, true);
    renderLigas(<LigasPage />);
    expect(
      screen.getByText("No se pudo cargar el directorio de ligas."),
    ).toBeInTheDocument();
  });

  it("muestra el formulario de creación con los campos de leagues.md §3", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Descripción (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo")).toBeInTheDocument();
    // F3 P3: la visibilidad no es un control (deriva del tipo) — se muestra
    // como lectura de solo lectura.
    expect(screen.getByText("Visibilidad: Privada (oculta)")).toBeInTheDocument();
    // F3 P1: el rango PROVISIONAL (D-05) se lee en la etiqueta — los límites
    // que el servidor revalida.
    expect(
      screen.getByLabelText("Miembros mínimos (2–50)"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Miembros máximos (2–50)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Modo de entrada")).toBeInTheDocument();
    expect(screen.getByLabelText("Inicio (opcional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Fin (opcional)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear liga" })).toBeInTheDocument();
  });

  it("explica qué controlan las fechas de la liga (F3 P3: no dejarlas a la interpretación)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    // Las fechas son hoy informativas: la elegibilidad depende de la entrada
    // de cada miembro y de la fecha del GP, no del periodo de la liga.
    expect(
      screen.getByText(/Periodo de la liga/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no de estas fechas/),
    ).toBeInTheDocument();
  });

  it("alineó los límites de miembros al dominio 2–50 (F3 P1, D-05)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const min = screen.getByLabelText("Miembros mínimos (2–50)");
    const max = screen.getByLabelText("Miembros máximos (2–50)");
    // La UI ya no ofrece valores que el servidor rechazaría de forma
    // garantizada (antes 1–100 → fallo rojo seguro).
    expect(min).toHaveAttribute("min", "2");
    expect(min).toHaveAttribute("max", "50");
    expect(max).toHaveAttribute("min", "2");
    expect(max).toHaveAttribute("max", "50");
  });

  it("acopla tipo y visibilidad: la visibilidad deriva del tipo (F3 P1/P3)", async () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    const tipo = screen.getByLabelText("Tipo");

    // Por defecto (privada): la visibilidad se lee como "Privada (oculta)"
    // (F3 P3: no es un control — deriva del tipo) y "solo invitación"
    // deshabilitado (F3 P2: hoy crea una liga muerta — sin código y sin
    // uniones, ADR-0025).
    expect(
      screen.getByText("Visibilidad: Privada (oculta)"),
    ).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Privada",
      "Pública",
      "Por código",
      "Solo invitación (aún no disponible)",
      "Código o invitación",
    ]);
    // La opción "solo invitación" está deshabilitada, no oculta: el usuario
    // ve que existe y por qué no puede elegirla.
    const inviteOption = screen.getByRole("option", {
      name: "Solo invitación (aún no disponible)",
    });
    expect(inviteOption).toBeDisabled();

    // Elegir "Pública" ajusta la visibilidad derivada.
    await user.selectOptions(tipo, "public");
    expect(
      screen.getByText("Visibilidad: Pública (directorio)"),
    ).toBeInTheDocument();
  });

  it("acopla tipo y visibilidad: privada ⇒ visibilidad privada (F3 P1)", async () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Tipo"), "public");
    await user.selectOptions(screen.getByLabelText("Tipo"), "private");
    expect(
      screen.getByText("Visibilidad: Privada (oculta)"),
    ).toBeInTheDocument();
  });

  it("aclara que en una pública la entrada es abierta (F3 P3: el modo solo decide el código)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    // En una liga pública la entrada es abierta (ADR-0024: no requiere
    // código); el modo solo decide si se genera un código para compartir.
    expect(
      screen.getByText(/En una liga pública la entrada es abierta/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/el modo solo decide si se genera un código/),
    ).toBeInTheDocument();
  });

  it("escribe el motivo del botón bloqueado (F3 P2: nunca un control bloqueado sin explicación)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const button = screen.getByRole("button", { name: "Crear liga" });
    // El botón se bloquea con `aria-disabled` (sigue en el orden de foco para
    // que el motivo se anuncie) — no con `disabled` nativo (ver Button).
    expect(button).toHaveAttribute("aria-disabled", "true");
    // El motivo se escribe junto al botón (aria-describedby).
    expect(
      screen.getByText("Escribe un nombre para la liga."),
    ).toBeInTheDocument();
  });

  it("bloquea con motivo si el máximo supera 50 o es menor que el mínimo (F3 P1)", async () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga de prueba");

    await user.clear(screen.getByLabelText("Miembros máximos (2–50)"));
    await user.type(screen.getByLabelText("Miembros máximos (2–50)"), "100");
    expect(
      screen.getByText("El máximo de miembros es 50."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear liga" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.clear(screen.getByLabelText("Miembros máximos (2–50)"));
    await user.type(screen.getByLabelText("Miembros máximos (2–50)"), "1");
    expect(
      screen.getByText(
        "El máximo de miembros no puede ser menor que el mínimo.",
      ),
    ).toBeInTheDocument();
  });

  it("bloquea con motivo si la fecha de fin es anterior a la de inicio (F3 P3)", async () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga temporal");
    await user.type(screen.getByLabelText("Inicio (opcional)"), "2026-12-01");
    await user.type(screen.getByLabelText("Fin (opcional)"), "2026-11-01");
    expect(
      screen.getByText("La fecha de fin no puede ser anterior a la de inicio."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear liga" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("no envía el payload si el formulario está bloqueado (submit por Enter) (F3 P1)", async () => {
    mockMyLeagues([]);
    const mutate = mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    // Sin nombre: el botón está aria-disabled, pero un Enter en un input
    // dispara `submit` de todos modos — la guardia de `handleSubmit` no debe
    // enviar un payload que el servidor rechazaría de forma garantizada.
    fireEvent.submit(screen.getByRole("button", { name: "Crear liga" }).closest("form") as HTMLFormElement);

    expect(mutate).not.toHaveBeenCalled();
  });

  it("muestra el ranking ajustado desactivado por defecto (US-30, D-10)", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const checkbox = screen.getByLabelText(/Ranking ajustado/);
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();
    expect(
      screen.getByText(
        /El ranking general contará solo los GPs desde la entrada del último miembro/,
      ),
    ).toBeInTheDocument();
  });

  it("desactiva el botón de creación sin nombre", () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);
    // Bloqueado con `aria-disabled` (el motivo se escribe junto al botón).
    expect(screen.getByRole("button", { name: "Crear liga" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("vacía el formulario con «Limpiar» (F3 P3: 10 campos, sin fricción)", async () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga temporal");
    await user.type(screen.getByLabelText("Descripción (opcional)"), "Borrador");
    expect(screen.getByLabelText("Nombre")).toHaveValue("Liga temporal");

    await user.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(screen.getByLabelText("Nombre")).toHaveValue("");
    expect(screen.getByLabelText("Descripción (opcional)")).toHaveValue("");
    // Sin nombre, el botón de creación vuelve a bloquearse con su motivo.
    expect(screen.getByRole("button", { name: "Crear liga" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("bloquea el envío durante el estado transitorio (F3 P2: no doble envío)", () => {
    mockMyLeagues([]);
    // Simula el estado transitorio: la mutación está en vuelo.
    mockResult(trpc.leagues.create.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      isSuccess: false,
      error: undefined,
      data: undefined,
    });
    renderLigas(<LigasPage />);

    // El botón primario (texto "Creando…") va `disabled` NATIVO — patrón de
    // `Button` para estados transitorios — para que un doble clic no
    // re-dispare la creación no idempotente.
    const submit = screen.getByRole("button", { name: "Creando…" });
    expect(submit).toBeDisabled();
    expect(submit).not.toHaveAttribute("aria-disabled");
    // "Limpiar" también se bloquea en vuelo (F3 P3).
    expect(screen.getByRole("button", { name: "Limpiar" })).toBeDisabled();
  });

  it("bloquea miembros no enteros (F3 P3: no depender del saneo del navegador)", async () => {
    mockMyLeagues([]);
    renderLigas(<LigasPage />);
    const user = userEvent.setup();

    // Nombre válido (la validación lo comprueba antes que los números).
    await user.type(screen.getByLabelText("Nombre"), "Liga de prueba");
    // Un valor no entero (válido para `type="number"`, pero no un entero)
    // debe bloquear el envío con motivo, no enviar un no-entero al servidor.
    fireEvent.change(screen.getByLabelText("Miembros mínimos (2–50)"), {
      target: { value: "1.5" },
    });
    expect(
      screen.getByText("Los miembros deben ser números enteros."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear liga" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("envía el payload de creación al enviar el formulario", async () => {
    mockMyLeagues([]);
    const mutate = mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga de prueba");
    await user.type(screen.getByLabelText("Descripción (opcional)"), "Descripción");
    await user.selectOptions(screen.getByLabelText("Tipo"), "public");
    // F3 P1/P3: al elegir "Pública" la visibilidad se deriva sola (ya no es
    // un control); el payload la verifica igual.
    expect(screen.getByText("Visibilidad: Pública (directorio)")).toBeInTheDocument();
    // F3 P2: "solo invitación" está deshabilitado (hoy crea una liga muerta),
    // así que el payload se verifica con el modo "código o invitación".
    await user.selectOptions(screen.getByLabelText("Modo de entrada"), "mixed");
    await user.clear(screen.getByLabelText("Miembros mínimos (2–50)"));
    await user.type(screen.getByLabelText("Miembros mínimos (2–50)"), "3");
    await user.clear(screen.getByLabelText("Miembros máximos (2–50)"));
    await user.type(screen.getByLabelText("Miembros máximos (2–50)"), "20");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      name: "Liga de prueba",
      description: "Descripción",
      type: "public",
      visibility: "public",
      minMembers: 3,
      maxMembers: 20,
      entryMode: "mixed",
      adjustedRankingEnabled: false,
    });
  });

  it("envía el ranking ajustado activado si el admin lo marca (US-30)", async () => {
    mockMyLeagues([]);
    const mutate = mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga ajustada");
    await user.click(screen.getByLabelText(/Ranking ajustado/));
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      name: "Liga ajustada",
      adjustedRankingEnabled: true,
    });
  });

  it("tras el éxito muestra la liga creada con enlace al detalle", async () => {
    mockMyLeagues([]);
    mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga nueva");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    await act(async () => {
      mutationOptions(trpc.leagues.create.useMutation).onSuccess?.({
        ...LEAGUE,
        name: "Liga nueva",
        id: "new-1",
      });
    });

    expect(screen.getByText(/Liga «Liga nueva» creada\./)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ver detalle" });
    expect(link).toHaveAttribute("href", "/ligas/new-1");
    // F3 P1: el resultado vive CON la acción (dentro del formulario), no
    // arriba de la página — en móvil, tras el submit el usuario está aquí.
    expect(screen.getByRole("link", { name: "Ver detalle" }).closest("form")).not.toBeNull();
  });

  it("al empezar un borrador nuevo desaparece el banner de la creación anterior (F3 P3)", async () => {
    mockMyLeagues([]);
    mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga nueva");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));
    await act(async () => {
      mutationOptions(trpc.leagues.create.useMutation).onSuccess?.({
        ...LEAGUE,
        name: "Liga nueva",
        id: "new-1",
      });
    });
    expect(screen.getByText(/Liga «Liga nueva» creada\./)).toBeInTheDocument();

    // El usuario empieza otra liga: el banner ya no describe su última acción.
    await user.type(screen.getByLabelText("Nombre"), "Segunda");
    expect(
      screen.queryByText(/Liga «Liga nueva» creada\./),
    ).not.toBeInTheDocument();
  });

  it("si la creación falla muestra el motivo del servidor", async () => {
    mockMyLeagues([]);
    mockMutation(trpc.leagues.create.useMutation);
    renderLigas(<LigasPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre"), "Liga inválida");
    await user.click(screen.getByRole("button", { name: "Crear liga" }));

    await act(async () => {
      mutationOptions(trpc.leagues.create.useMutation).onError?.(
        new Error("El máximo de miembros no puede superar 50."),
      );
    });

    const error = screen.getByText("El máximo de miembros no puede superar 50.");
    expect(error).toBeInTheDocument();
    // F3 P1: el error de creación vive CON la acción (dentro del
    // formulario), no arriba de la página — en móvil, tras un submit
    // fallido el usuario queda abajo y el error no puede quedar fuera de
    // pantalla.
    expect(error.closest("form")).not.toBeNull();
    expect(error.closest("p")).toHaveClass("alert-error");
  });

  it("enlaza los estados vacíos a la creación (F3 P3: salidas de acción, no texto)", () => {
    mockMyLeagues([]);
    mockPublicLeagues([]);
    renderLigas(<LigasPage />);

    const anchors = screen.getAllByRole("link").filter((a) =>
      a.getAttribute("href")?.startsWith("#"),
    );
    // "Crea una abajo" (mis ligas) y "Crea la primera abajo" (directorio)
    // apuntan al ancla de la sección de creación; "únete a una del
    // directorio" (mis ligas) apunta al ancla del directorio (F3 P3: las
    // dos sugerencias del estado vacío son igualmente accionables).
    expect(anchors.length).toBe(3);
    const hrefs = anchors.map((a) => a.getAttribute("href")).sort();
    expect(hrefs).toEqual(["#crear-liga", "#crear-liga", "#directorio"]);
    expect(screen.getByRole("heading", { name: "Crear una liga" })).toHaveAttribute(
      "id",
      "crear-liga",
    );
    expect(
      screen.getByRole("heading", { name: "Directorio de ligas públicas" }),
    ).toHaveAttribute("id", "directorio");
  });

  it("muestra la capa de vocabulario antes de la primera lista (F3 P2)", () => {
    mockMyLeagues([LEAGUE]);
    renderLigas(<LigasPage />);

    const help = screen.getByText(/Miembros: participantes activos/);
    expect(help).toBeInTheDocument();
    // La ayuda precede a la primera lista de datos en el documento.
    const firstList = screen.getByText("Liga de los amigos").closest("ul");
    expect(
      help.compareDocumentPosition(firstList as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
