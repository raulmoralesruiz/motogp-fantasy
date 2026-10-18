/**
 * Implementación Redis de `RateLimitStore` (T-24): se prueba contra un mock
 * de `../redis` (singleton excluido de cobertura) verificando claves,
 * argumentos y el mapeo de TTL → `remainingSec`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    eval: vi.fn(),
    ttl: vi.fn(),
    incr: vi.fn(),
    del: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../redis", () => ({ redis: mocks.redis }));

import { redisRateLimitStore } from "../rate-limit-redis";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("redisRateLimitStore", () => {
  describe("recordAttempt (ventana fija por IP)", () => {
    it("ejecuta el script Lua con la clave y ventana correctas y mapea el TTL", async () => {
      mocks.redis.eval.mockResolvedValue(3);
      mocks.redis.ttl.mockResolvedValue(45);

      const result = await redisRateLimitStore.recordAttempt("1.2.3.4", 60);

      expect(mocks.redis.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, windowSec] = mocks.redis.eval.mock.calls[0] ?? [];
      expect(script).toContain('redis.call("INCR", KEYS[1])');
      expect(script).toContain('redis.call("EXPIRE", KEYS[1], ARGV[1])');
      expect(numKeys).toBe(1);
      expect(key).toBe("rl:login:ip:1.2.3.4");
      expect(windowSec).toBe("60");
      expect(mocks.redis.ttl).toHaveBeenCalledWith("rl:login:ip:1.2.3.4");
      expect(result).toEqual({ count: 3, remainingSec: 45 });
    });

    it("remainingSec no es negativo si el TTL ya expiró", async () => {
      mocks.redis.eval.mockResolvedValue(1);
      mocks.redis.ttl.mockResolvedValue(-2);

      const result = await redisRateLimitStore.recordAttempt("1.2.3.4", 60);

      expect(result).toEqual({ count: 1, remainingSec: 0 });
    });
  });

  describe("fallos consecutivos por cuenta", () => {
    it("recordFailure incrementa el contador de la cuenta", async () => {
      mocks.redis.incr.mockResolvedValue(2);

      const count = await redisRateLimitStore.recordFailure("a@b.c");

      expect(mocks.redis.incr).toHaveBeenCalledWith("rl:login:fail:a@b.c");
      expect(count).toBe(2);
    });

    it("resetFailures borra el contador de la cuenta", async () => {
      mocks.redis.del.mockResolvedValue(1);

      await redisRateLimitStore.resetFailures("a@b.c");

      expect(mocks.redis.del).toHaveBeenCalledWith("rl:login:fail:a@b.c");
    });
  });

  describe("bloqueo de cuenta", () => {
    it("lockAccount fija la clave de bloqueo con TTL", async () => {
      mocks.redis.set.mockResolvedValue("OK");

      await redisRateLimitStore.lockAccount("a@b.c", 900);

      expect(mocks.redis.set).toHaveBeenCalledWith("rl:login:lock:a@b.c", "1", "EX", 900);
    });

    it("lockRemainingSec devuelve el TTL (0 si ya expiró)", async () => {
      mocks.redis.ttl.mockResolvedValueOnce(120);
      expect(await redisRateLimitStore.lockRemainingSec("a@b.c")).toBe(120);

      mocks.redis.ttl.mockResolvedValueOnce(-1);
      expect(await redisRateLimitStore.lockRemainingSec("a@b.c")).toBe(0);
    });
  });

  describe("recordResetRequest (US-02, prefijo rl:reset:)", () => {
    it("usa la clave de ventana de recuperación por IP", async () => {
      mocks.redis.eval.mockResolvedValue(4);
      mocks.redis.ttl.mockResolvedValue(0);

      const result = await redisRateLimitStore.recordResetRequest("5.6.7.8", 300);

      expect(mocks.redis.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, windowSec] = mocks.redis.eval.mock.calls[0] ?? [];
      expect(script).toContain('redis.call("INCR", KEYS[1])');
      expect(numKeys).toBe(1);
      expect(key).toBe("rl:reset:ip:5.6.7.8");
      expect(windowSec).toBe("300");
      expect(result).toEqual({ count: 4, remainingSec: 0 });
    });
  });
});
