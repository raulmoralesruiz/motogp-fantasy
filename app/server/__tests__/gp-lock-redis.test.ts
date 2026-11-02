/**
 * Implementación Redis de `GpLockStore` (T-10, ADR-0034): se prueba contra
 * un mock de `../redis` (singleton excluido de cobertura) verificando la
 * clave, el modo `NX`+`PX`, el token devuelto y la release condicional por
 * token.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    set: vi.fn(),
    eval: vi.fn(),
  },
}));

vi.mock("../redis", () => ({ redis: mocks.redis }));

import { redisGpLockStore } from "../gp-lock-redis";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("redisGpLockStore (T-10)", () => {
  describe("acquire (SET NX PX)", () => {
    it("adquiere el lock: clave del GP, modo NX+PX y devuelve el token de dueño", async () => {
      mocks.redis.set.mockResolvedValue("OK");

      const token = await redisGpLockStore.acquire("gp-1", 120);

      expect(token).not.toBeNull();
      expect(typeof token).toBe("string");
      expect(token!.length).toBeGreaterThanOrEqual(16);
      expect(mocks.redis.set).toHaveBeenCalledTimes(1);
      const [key, value, ...rest] = mocks.redis.set.mock.calls[0] ?? [];
      expect(key).toBe("job:gp:lock:gp-1");
      expect(value).toBe(token);
      expect(rest).toContain("NX");
      expect(rest).toContain("PX");
      expect(rest).toContain(120000);
    });

    it("devuelve null si la clave ya existe (otro job lo mantiene)", async () => {
      mocks.redis.set.mockResolvedValue(null);

      const token = await redisGpLockStore.acquire("gp-1", 120);

      expect(token).toBeNull();
    });

    it("cada adquisición genera un token distinto (no es una constante)", async () => {
      mocks.redis.set.mockResolvedValue("OK");

      const t1 = await redisGpLockStore.acquire("gp-1", 120);
      const t2 = await redisGpLockStore.acquire("gp-1", 120);

      expect(t1).not.toBe(t2);
    });
  });

  describe("release (solo si el token coincide)", () => {
    it("ejecuta el script Lua con la clave y el token del dueño", async () => {
      mocks.redis.eval.mockResolvedValue(1);

      await redisGpLockStore.release("gp-1", "token-abc");

      expect(mocks.redis.eval).toHaveBeenCalledTimes(1);
      const [script, numKeys, key, token] = mocks.redis.eval.mock.calls[0] ?? [];
      expect(script).toContain('redis.call("GET", KEYS[1]) == ARGV[1]');
      expect(script).toContain('redis.call("DEL", KEYS[1])');
      expect(numKeys).toBe(1);
      expect(key).toBe("job:gp:lock:gp-1");
      expect(token).toBe("token-abc");
    });
  });
});
