/**
 * Validación del entorno del servidor (Zod).
 * Falla rápido y con mensaje claro si falta o es inválida una variable.
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria"),
  REDIS_URL: z.string().min(1, "REDIS_URL es obligatoria"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Entorno del servidor inválido — ${details}`);
  }
  cached = parsed.data;
  return parsed.data;
}
