/**
 * Notificaciones (US-36, ADR-0033): email a los miembros activos de las
 * ligas cuando se publican los resultados definitivos de un GP o se aplica
 * un recálculo.
 *
 * Diseño (ADR-0033):
 * - El enviador es inyectable (frontera de I/O, mismo patrón que US-02,
 *   ADR-0009): `ResendEmailSender` en producción, `LogNotificationSender`
 *   en dev/tests.
 * - **Nunca bloquea ni rompe el flujo principal**: la operación que lo
 *   dispara (definitivo/recálculo) ya está commiteada cuando corre la
 *   notificación; un fallo de envío se loguea y se audita, pero el flujo
 *   no se rompe (el router además lo envuelve en un `.catch` de red).
 * - **Destinatarios**: miembros activos de las ligas que tienen un ranking
 *   en el GP (la liga "pertenecer" al GP se deriva de `rankings` — la
 *   liga no tiene `seasonId`), excluyendo usuarios anonimizados (GDPR) y
 *   usuarios con email deshabilitado. Modelo opt-out: sin fila de ajustes
 *   ⇒ email habilitado.
 * - Sin filas de "notificación enviada" en BD: la auditoría
 *   (`notification.sent`, append-only) es el registro (coherente con T-09).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { appendAudit } from "@/modules/admin";

import type { NotificationEmailSender } from "./email-sender";

/** Actor de la acción (admin) e IP del cliente (auditoría). */
export interface NotificationMeta {
  actorId: string | null;
  ip?: string | null;
}

export interface NotificationServiceDeps {
  prisma: PrismaClient;
  /** Enviador de emails (inyectable; US-36, ADR-0033). */
  sender: NotificationEmailSender;
  /** Remitente (solo informativo aquí; el sender lo usa). */
  from: string;
  /** URL pública de la app para el link del email. */
  appUrl: string;
}

/** Evento notificado (US-36). */
export type NotificationEvent = "definitive_published" | "recalculation_applied";

/** Resultado del envío (para tests y el router). */
export interface NotificationOutcome {
  /** Destinatarios resueltos. */
  recipients: number;
  /** Emails enviados con éxito. */
  sent: number;
  /** Envíos fallidos. */
  failed: number;
  /** Emails fallidos (para el log/auditoría). */
  failedEmails: string[];
}

/** Ajustes de notificación del usuario (US-36). */
export interface NotificationSettingsView {
  emailEnabled: boolean;
}

export class NotificationService {
  private readonly prisma: PrismaClient;
  private readonly sender: NotificationEmailSender;
  private readonly appUrl: string;

  constructor(deps: NotificationServiceDeps) {
    this.prisma = deps.prisma;
    this.sender = deps.sender;
    this.appUrl = deps.appUrl;
  }

  /**
   * Notifica la publicación de resultados definitivos de un GP (US-36).
   * Se invoca DESPUÉS del commit de `markDefinitive` (orquestación BFF del
   * router, patrón US-21). Con 0 destinatarios no envía ni audita.
   */
  async notifyDefinitivePublished(
    gpId: string,
    meta: NotificationMeta,
  ): Promise<NotificationOutcome> {
    return this.deliver(gpId, "definitive_published", meta);
  }

  /**
   * Notifica la aplicación de un recálculo de un GP (US-36). Se invoca
   * DESPUÉS del commit del recálculo (orquestación BFF del router).
   * Con 0 destinatarios no envía ni audita.
   */
  async notifyRecalculationApplied(
    gpId: string,
    meta: NotificationMeta,
  ): Promise<NotificationOutcome> {
    return this.deliver(gpId, "recalculation_applied", meta);
  }

  /** Ajustes del usuario (US-36): sin fila ⇒ email habilitado (opt-out). */
  async getSettings(userId: string): Promise<NotificationSettingsView> {
    const row = await this.prisma.notificationSetting.findUnique({
      where: { userId },
    });
    return { emailEnabled: row?.emailEnabled ?? true };
  }

  /** Actualiza los ajustes del usuario (US-36): upsert por `userId`. */
  async updateSettings(
    userId: string,
    input: { emailEnabled: boolean },
  ): Promise<NotificationSettingsView> {
    await this.prisma.notificationSetting.upsert({
      where: { userId },
      update: { emailEnabled: input.emailEnabled },
      create: { userId, emailEnabled: input.emailEnabled },
    });
    return { emailEnabled: input.emailEnabled };
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  /**
   * Resuelve el GP (nombre, ronda, temporada) para el contenido del email.
   */
  private async resolveGp(gpId: string) {
    const gp = await this.prisma.gp.findUnique({
      where: { id: gpId },
      select: {
        name: true,
        round: true,
        season: { select: { name: true } },
      },
    });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }
    return gp;
  }

  /**
   * Destinatarios (US-36): miembros activos de las ligas que tienen un
   * ranking en el GP, excluyendo anonimizados y email deshabilitado.
   */
  private async resolveRecipients(gpId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ email: string }>>`
      SELECT DISTINCT u.email
      FROM league_members lm
      JOIN users u ON u.id = lm.user_id
      WHERE lm.status = 'active'
        AND u.is_anonymized = false
        AND lm.league_id IN (
          SELECT DISTINCT league_id FROM rankings WHERE gp_id = ${gpId}::uuid
        )
        AND NOT EXISTS (
          SELECT 1 FROM notification_settings ns
          WHERE ns.user_id = lm.user_id AND ns.email_enabled = false
        )
      ORDER BY u.email
    `;
    return rows.map((row) => row.email);
  }

  /**
   * Contenido del email (español, AGENTS.md §2). El link apunta a
   * `/resultados` (la página elige el GP; no lee query params).
   */
  private buildEmail(
    event: NotificationEvent,
    gp: { name: string; round: number; seasonName: string },
  ): { subject: string; html: string } {
    const link = `${this.appUrl}/resultados`;
    if (event === "definitive_published") {
      return {
        subject: `Resultados definitivos: ${gp.name} (ronda ${gp.round})`,
        html: [
          "<p>Hola,</p>",
          `<p>Se han publicado los <strong>resultados definitivos</strong> del <strong>${gp.name}</strong> (ronda ${gp.round}, temporada ${gp.seasonName}).</p>`,
          "<p>Tu puntuación y el ranking de tus ligas se han actualizado.</p>",
          `<p><a href="${link}">Ver mis resultados</a></p>`,
          "<p>— Fantasy MotoGP Independiente</p>",
        ].join("\n"),
      };
    }
    return {
      subject: `Recálculo aplicado: ${gp.name} (ronda ${gp.round})`,
      html: [
        "<p>Hola,</p>",
        `<p>Se ha aplicado un <strong>recálculo</strong> al <strong>${gp.name}</strong> (ronda ${gp.round}, temporada ${gp.seasonName}).</p>`,
        "<p>Tu puntuación puede haber cambiado.</p>",
        `<p><a href="${link}">Ver mis resultados</a></p>`,
        "<p>— Fantasy MotoGP Independiente</p>",
      ].join("\n"),
    };
  }

  /**
   * Envío + auditoría. Un fallo individual no impide el resto de envíos;
   * los fallos se recogen y se auditan (append-only, T-09).
   */
  private async deliver(
    gpId: string,
    event: NotificationEvent,
    meta: NotificationMeta,
  ): Promise<NotificationOutcome> {
    const [gp, recipients] = await Promise.all([
      this.resolveGp(gpId),
      this.resolveRecipients(gpId),
    ]);
    if (recipients.length === 0) {
      // Nadie que notificar: no hay envío ni auditoría (la acción principal
      // ya tiene su propia entrada de auditoría).
      return { recipients: 0, sent: 0, failed: 0, failedEmails: [] };
    }

    const { subject, html } = this.buildEmail(event, {
      name: gp.name,
      round: gp.round,
      seasonName: gp.season.name,
    });

    let sent = 0;
    const failedEmails: string[] = [];
    for (const to of recipients) {
      try {
        await this.sender.send({ to, subject, html });
        sent += 1;
      } catch (error) {
        // Fallo individual: se loguea y se recoge; el resto sigue (ADR-0033).
        console.error(
          `[notification] fallo de envío a ${to}:`,
          error instanceof Error ? error.message : error,
        );
        failedEmails.push(to);
      }
    }

    const outcome: NotificationOutcome = {
      recipients: recipients.length,
      sent,
      failed: failedEmails.length,
      failedEmails,
    };

    await appendAudit(this.prisma, {
      actorId: meta.actorId,
      action: "notification.sent",
      entity: "notification",
      entityId: gpId,
      afterData: { event, gpId, ...outcome } as Prisma.InputJsonValue,
      ip: meta.ip,
    });

    return outcome;
  }
}
