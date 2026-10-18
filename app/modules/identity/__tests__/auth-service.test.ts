/**
 * Tests de `AuthService.resetPassword` (US-02, T-24): la rama defensiva
 * de la reclamación atómica — el token existe y es válido, pero el
 * `updateMany` condicional no reclama nada (count 0: dos llamadas
 * concurrentes y otra ganó) → mismo error genérico que cualquier otro
 * caso inválido (no se revela cuál fue).
 *
 * `prisma` se inyecta (DI) como objeto falso; `hashPassword` es el argon2
 * real (una sola llamada, coste aceptable en tests).
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { AuthService } from "../auth-service";
import { LogEmailSender } from "../email";
import { InMemoryRateLimitStore } from "../rate-limit";

const cfg = {
  // RateLimitConfig (login): valores de test, sin efecto en este caso.
  maxPerWindow: 5,
  windowSec: 60,
  lockoutThreshold: 5,
  lockoutSec: 300,
  sessionTtlSec: 3600,
  resetTokenTtlSec: 3600,
  resetMaxPerWindow: 5,
  resetWindowSec: 60,
  appUrl: "https://app.test",
};

describe("AuthService.resetPassword (T-24)", () => {
  it("token válido pero ya reclamado (count 0) → UNAUTHORIZED genérico", async () => {
    const record = {
      id: "rt1",
      userId: "u1",
      usedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
    };
    const passwordResetToken = {
      findUnique: vi.fn().mockResolvedValue(record),
      // La reclamación condicional no reclama nada: otra llamada ganó.
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = {
      passwordResetToken,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    } as unknown as PrismaClient;

    const service = new AuthService({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      emailSender: new LogEmailSender(),
      cfg,
    });

    await expect(
      service.resetPassword("token-123", "nueva-clave-secreta"),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "El enlace de recuperación no es válido o ha caducado.",
    });
    // Se intentó la reclamación condicional por (id, usedAt null).
    expect(passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: "rt1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });
});
