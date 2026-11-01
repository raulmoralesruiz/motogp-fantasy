/**
 * Tests de `NotificationService` (US-36, ADR-0033): resolución de
 * destinatarios, contenido del email, fallos de envío individuales,
 * auditoría y ajustes de usuario.
 *
 * `prisma` se inyecta (DI) como objeto falso (mismo patrón que los tests de
 * `identity`); el sender es un captor en memoria.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { NotificationService } from "../notification-service";
import type { NotificationEmail } from "../email-sender";

const GP = {
  id: "gp-1",
  name: "GRAND PRIX OF MALAYSIA",
  round: 19,
  season: { name: "test2" },
};

/** Sender que registra los envíos (y puede fallar por destinatario). */
class CapturingSender {
  sent: NotificationEmail[] = [];
  constructor(private readonly failFor: Set<string> = new Set()) {}
  async send(email: NotificationEmail): Promise<void> {
    if (this.failFor.has(email.to)) {
      throw new Error("fallo de red simulado");
    }
    this.sent.push(email);
  }
}

interface FakePrismaOptions {
  gp?: unknown;
  recipients?: Array<{ email: string }>;
  settings?: { emailEnabled: boolean } | null;
}

function fakePrisma(options: FakePrismaOptions = {}) {
  const audit = { calls: [] as unknown[] };
  const notificationSetting = {
    findUnique: vi.fn(async () => options.settings ?? null),
    upsert: vi.fn(async () => options.settings ?? { emailEnabled: true }),
  };
  const prisma = {
    gp: {
      findUnique: vi.fn(async () => (options.gp === undefined ? GP : options.gp)),
    },
    $queryRaw: vi.fn(async () => options.recipients ?? []),
    notificationSetting,
    auditLog: {
      create: vi.fn(async (args: unknown) => {
        audit.calls.push(args);
        return { id: "audit-1" };
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, audit, notificationSetting };
}

function makeService(sender: CapturingSender, prisma: PrismaClient) {
  return new NotificationService({
    prisma,
    sender,
    from: "notificaciones@test.local",
    appUrl: "https://app.test",
  });
}

describe("NotificationService (US-36)", () => {
  it("definitivo: envía a todos los destinatarios con el contenido correcto y audita", async () => {
    const recipients = [
      { email: "ana@liga.com" },
      { email: "luis@liga.com" },
    ];
    const { prisma, audit } = fakePrisma({ recipients });
    const sender = new CapturingSender();
    const service = makeService(sender, prisma);

    const outcome = await service.notifyDefinitivePublished("gp-1", {
      actorId: "admin-1",
      ip: "198.51.100.1",
    });

    expect(outcome).toEqual({
      recipients: 2,
      sent: 2,
      failed: 0,
      failedEmails: [],
    });
    expect(sender.sent).toHaveLength(2);
    const first = sender.sent[0]!;
    expect(first).toMatchObject({
      to: "ana@liga.com",
      subject: "Resultados definitivos: GRAND PRIX OF MALAYSIA (ronda 19)",
    });
    expect(first.html).toContain("resultados definitivos");
    expect(first.html).toContain("GRAND PRIX OF MALAYSIA");
    expect(first.html).toContain("https://app.test/resultados");
    expect(first.html).toContain("temporada test2");

    // Auditoría append-only (T-09): una entrada por envío.
    expect(audit.calls).toHaveLength(1);
    const auditEntry = audit.calls[0] as { data: Record<string, unknown> };
    expect(auditEntry.data).toMatchObject({
      actorId: "admin-1",
      action: "notification.sent",
      entity: "notification",
      entityId: "gp-1",
      ip: "198.51.100.1",
    });
    expect(auditEntry.data).toMatchObject({
      afterData: {
        event: "definitive_published",
        gpId: "gp-1",
        recipients: 2,
        sent: 2,
        failed: 0,
        failedEmails: [],
      },
    });
  });

  it("recálculo: asunto y cuerpo propios del evento", async () => {
    const { prisma } = fakePrisma({ recipients: [{ email: "ana@liga.com" }] });
    const sender = new CapturingSender();
    const service = makeService(sender, prisma);

    await service.notifyRecalculationApplied("gp-1", { actorId: null });

    expect(sender.sent).toHaveLength(1);
    const mail = sender.sent[0]!;
    expect(mail.subject).toBe(
      "Recálculo aplicado: GRAND PRIX OF MALAYSIA (ronda 19)",
    );
    expect(mail.html).toContain("recálculo");
    expect(mail.html).toContain("Tu puntuación puede haber cambiado.");
  });

  it("GP inexistente → NOT_FOUND", async () => {
    const { prisma } = fakePrisma({ gp: null });
    const service = makeService(new CapturingSender(), prisma);
    await expect(
      service.notifyDefinitivePublished("gp-inexistente", { actorId: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("0 destinatarios: no envía y no audita", async () => {
    const { prisma, audit } = fakePrisma({ recipients: [] });
    const sender = new CapturingSender();
    const service = makeService(sender, prisma);

    const outcome = await service.notifyDefinitivePublished("gp-1", {
      actorId: "admin-1",
    });

    expect(outcome).toEqual({ recipients: 0, sent: 0, failed: 0, failedEmails: [] });
    expect(sender.sent).toHaveLength(0);
    expect(audit.calls).toHaveLength(0);
  });

  it("fallo de envío individual: el resto se envía y el fallo se audita", async () => {
    const recipients = [
      { email: "ana@liga.com" },
      { email: "luis@liga.com" },
      { email: "maria@liga.com" },
    ];
    const { prisma, audit } = fakePrisma({ recipients });
    const sender = new CapturingSender(new Set(["luis@liga.com"]));
    const service = makeService(sender, prisma);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await service.notifyRecalculationApplied("gp-1", {
      actorId: "admin-1",
    });

    expect(outcome).toEqual({
      recipients: 3,
      sent: 2,
      failed: 1,
      failedEmails: ["luis@liga.com"],
    });
    expect(sender.sent.map((mail) => mail.to)).toEqual([
      "ana@liga.com",
      "maria@liga.com",
    ]);
    expect(audit.calls[0]).toMatchObject({
      data: {
        afterData: {
          event: "recalculation_applied",
          sent: 2,
          failed: 1,
          failedEmails: ["luis@liga.com"],
        },
      },
    });
    errorSpy.mockRestore();
  });

  describe("ajustes (getSettings/updateSettings)", () => {
    it("sin fila ⇒ email habilitado (opt-out)", async () => {
      const { prisma } = fakePrisma({ settings: null });
      const service = makeService(new CapturingSender(), prisma);
      await expect(service.getSettings("user-1")).resolves.toEqual({
        emailEnabled: true,
      });
    });

    it("con fila ⇒ devuelve el valor guardado", async () => {
      const { prisma } = fakePrisma({ settings: { emailEnabled: false } });
      const service = makeService(new CapturingSender(), prisma);
      await expect(service.getSettings("user-1")).resolves.toEqual({
        emailEnabled: false,
      });
    });

    it("updateSettings: upsert por userId", async () => {
      const { prisma, notificationSetting } = fakePrisma({ settings: null });
      const service = makeService(new CapturingSender(), prisma);

      await service.updateSettings("user-1", { emailEnabled: false });

      expect(notificationSetting.upsert).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        update: { emailEnabled: false },
        create: { userId: "user-1", emailEnabled: false },
      });
    });
  });
});
