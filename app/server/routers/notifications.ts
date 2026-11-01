/**
 * Router de notificaciones (US-36, ADR-0033): ajustes del usuario
 * (email on/off).
 *
 * Autorización (T-08): `protectedProcedure` — cada usuario gestiona sus
 * propios ajustes (el `userId` siempre viene de la sesión, nunca del
 * payload). El envío de las notificaciones lo dispara el router `results`
 * (orquestación BFF, patrón US-21) sobre el mismo `NotificationService`.
 */
import type { PrismaClient } from "@prisma/client";

import {
  NotificationService,
  chooseNotificationSender,
  type NotificationEmailSender,
} from "@/modules/notifications";
import { updateNotificationSettingsInputSchema } from "@/shared/validation/notifications";

import { getServerEnv } from "../env";
import { prisma } from "../prisma";
import { protectedProcedure, router } from "../trpc";

export interface NotificationsRouterDeps {
  prisma: PrismaClient;
  /** Enviador de emails (US-36, ADR-0033): inyectable para tests. */
  sender: NotificationEmailSender;
  from: string;
  appUrl: string;
}

/** Router inyectable: los tests de integración lo montan con su propia BD. */
export function createNotificationsRouter(deps: NotificationsRouterDeps) {
  const service = new NotificationService({
    prisma: deps.prisma,
    sender: deps.sender,
    from: deps.from,
    appUrl: deps.appUrl,
  });

  return router({
    /** Ajustes del usuario activo (US-36): sin fila ⇒ email habilitado. */
    settings: protectedProcedure.query(({ ctx }) =>
      service.getSettings(ctx.user.id),
    ),

    /** Actualiza los ajustes del usuario activo (US-36): upsert. */
    updateSettings: protectedProcedure
      .input(updateNotificationSettingsInputSchema)
      .mutation(({ ctx, input }) =>
        service.updateSettings(ctx.user.id, input),
      ),
  });
}

/**
 * Enviador por defecto (producción): Resend si hay `RESEND_API_KEY`,
 * `LogNotificationSender` si no (dev/provisional: la notificación se loguea
 * en el servidor y el operador la recupera con
 * `docker logs motogp-web | grep notification`).
 */
function createDefaultSender(): NotificationEmailSender {
  const env = getServerEnv();
  return chooseNotificationSender({
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
  });
}

/**
 * `NotificationService` por defecto (producción). Compartido por los routers
 * `notifications` y `results` para que usen la misma configuración de envío
 * (ADR-0033).
 */
export function createDefaultNotificationService(
  db: PrismaClient,
): NotificationService {
  const env = getServerEnv();
  return new NotificationService({
    prisma: db,
    sender: createDefaultSender(),
    from: env.EMAIL_FROM,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  });
}

/**
 * Router por defecto (producción): singletons de la app + parámetros por
 * env. Construcción perezosa para que importar el módulo (p. ej. por los
 * tipos) no exija el entorno.
 */
let defaultRouter: ReturnType<typeof createNotificationsRouter> | null = null;

export function getDefaultNotificationsRouter() {
  defaultRouter ??= (() => {
    const env = getServerEnv();
    return createNotificationsRouter({
      prisma,
      sender: createDefaultSender(),
      from: env.EMAIL_FROM,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    });
  })();
  return defaultRouter;
}
