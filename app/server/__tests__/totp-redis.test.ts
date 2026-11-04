/**
 * Implementación Redis de `TotpChallengeStore` (D-07, ADR-0039): se prueba
 * contra un mock de `../redis` (singleton excluido de cobertura) verificando
 * claves (`totp:challenge:*` / `totp:fail:*`), argumentos y la semántica de
 * TTL (el contador de fallos hereda la vigencia del reto y no queda órfano
 * si el reto ya expiró).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    set: vi.fn(),
    get: vi.fn(),
    incr: vi.fn(),
    ttl: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("../redis", () => ({ redis: mocks.redis }));

import { redisTotpChallengeStore } from "../totp-redis";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("redisTotpChallengeStore (D-07, ADR-0039)", () => {
  const USER = "u-admin";

  describe("issue", () => {
    it("guarda el reto con TTL y devuelve un token opaco de 256 bits", async () => {
      mocks.redis.set.mockResolvedValue("OK");

      const token = await redisTotpChallengeStore.issue(USER, 300);

      // El token es opaco: solo su valor identifica el reto (no enumerable).
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(mocks.redis.set).toHaveBeenCalledWith(
        `totp:challenge:${token}`,
        USER,
        "EX",
        300,
      );
    });
  });

  describe("resolve", () => {
    it("devuelve el userId del reto por su token", async () => {
      mocks.redis.get.mockResolvedValue(USER);

      const userId = await redisTotpChallengeStore.resolve("tok-1");

      expect(userId).toBe(USER);
      expect(mocks.redis.get).toHaveBeenCalledWith("totp:challenge:tok-1");
    });

    it("null si el reto no existe o expiró", async () => {
      mocks.redis.get.mockResolvedValue(null);

      await expect(redisTotpChallengeStore.resolve("tok-expirado")).resolves.toBeNull();
    });
  });

  describe("failureCount", () => {
    it("0 si el reto aún no tiene fallos", async () => {
      mocks.redis.get.mockResolvedValue(null);

      const count = await redisTotpChallengeStore.failureCount("tok-1");

      expect(count).toBe(0);
      expect(mocks.redis.get).toHaveBeenCalledWith("totp:fail:tok-1");
    });

    it("parsea el contador incrementado por `recordFailure`", async () => {
      mocks.redis.get.mockResolvedValue("3");

      await expect(redisTotpChallengeStore.failureCount("tok-1")).resolves.toBe(3);
    });
  });

  describe("recordFailure", () => {
    it("primer fallo: incrementa y hereda el TTL del reto", async () => {
      mocks.redis.incr.mockResolvedValue(1);
      mocks.redis.ttl.mockResolvedValue(45);
      mocks.redis.expire.mockResolvedValue(true);

      const count = await redisTotpChallengeStore.recordFailure("tok-1");

      expect(count).toBe(1);
      expect(mocks.redis.incr).toHaveBeenCalledWith("totp:fail:tok-1");
      expect(mocks.redis.ttl).toHaveBeenCalledWith("totp:challenge:tok-1");
      expect(mocks.redis.expire).toHaveBeenCalledWith("totp:fail:tok-1", 45);
    });

    it("fallos posteriores: no vuelve a fijar el TTL", async () => {
      mocks.redis.incr.mockResolvedValue(4);
      mocks.redis.ttl.mockResolvedValue(12);

      const count = await redisTotpChallengeStore.recordFailure("tok-1");

      expect(count).toBe(4);
      expect(mocks.redis.expire).not.toHaveBeenCalled();
    });

    it("reto expirado: limpia el contador para no dejar una clave órfana", async () => {
      mocks.redis.incr.mockResolvedValue(1);
      mocks.redis.ttl.mockResolvedValue(-2); // el reto ya no existe en Redis
      mocks.redis.del.mockResolvedValue(1);

      const count = await redisTotpChallengeStore.recordFailure("tok-1");

      expect(count).toBe(1);
      expect(mocks.redis.expire).not.toHaveBeenCalled();
      expect(mocks.redis.del).toHaveBeenCalledWith("totp:fail:tok-1");
    });
  });

  describe("consume", () => {
    it("borra el reto y sus fallos (idempotente)", async () => {
      mocks.redis.del.mockResolvedValue(2);

      await redisTotpChallengeStore.consume("tok-1");

      expect(mocks.redis.del).toHaveBeenCalledWith(
        "totp:challenge:tok-1",
        "totp:fail:tok-1",
      );
    });
  });
});
