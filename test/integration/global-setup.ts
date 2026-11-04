import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { GenericContainer, Wait } from "testcontainers";
import { DB_URL_FILE, REDIS_URL_FILE } from "./helpers";

const POSTGRES_IMAGE = "postgres:16";
const DB_USER = "motogp";
const DB_PASSWORD = "motogp"; // solo tests: contenedor efímero, no es un secret
const DB_NAME = "motogp_test";
const REDIS_IMAGE = "redis:7";

/**
 * Espera a que el puerto publicado acepte conexiones TCP.
 *
 * La publicación del puerto (docker-proxy) puede completarse unos
 * milisegundos DESPUÉS de que `start()` devuelva (la estrategia de espera
 * solo mira el log del contenedor). En hosts con daemon de Docker lento o
 * bajo carga, el primer intento de conectar recibe RST y el engine de
 * Prisma lo trata como fallo definitivo (P1001, sin reintentos): la suite
 * caía en el global setup. Sondear el puerto antes de invocar Prisma hace
 * el setup robusto en cualquier host (NAS, runners, CI).
 */
async function waitForTcp(
  host: string,
  port: number,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      const done = (result: boolean) => {
        socket.destroy();
        resolve(result);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
      setTimeout(() => done(false), 1000).unref();
    });
    if (ok) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `El puerto publicado ${host}:${port} no aceptó conexiones tras ${timeoutMs} ms`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** `prisma migrate deploy` con reintento acotado (redoble de seguridad). */
async function migrateDeployWithRetry(
  env: NodeJS.ProcessEnv,
  attempts = 4,
): Promise<void> {
  const args = [
    "migrate",
    "deploy",
    "--schema",
    path.join(process.cwd(), "prisma", "schema.prisma"),
  ];
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync(
        path.join(process.cwd(), "node_modules", ".bin", "prisma"),
        args,
        { env, stdio: "inherit" },
      );
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      process.stderr.write(
        `prisma migrate deploy falló (intento ${attempt}/${attempts}); reintento en 1 s…\n`,
      );
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/**
 * Global setup de integración (T-07):
 * 1. Arranca UN contenedor postgres:16 por run (Testcontainers).
 * 2. Aplica las migraciones en orden (`prisma migrate deploy`).
 * 3. Arranca un contenedor redis:7 (T-10: lock por GP de los jobs).
 * 4. Publica las URLs en archivos temporales para los workers de test.
 * Devuelve el teardown: para los contenedores y limpia los archivos.
 */
export default async function setup() {
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: DB_USER,
      POSTGRES_PASSWORD: DB_PASSWORD,
      POSTGRES_DB: DB_NAME,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections"),
    )
    .start();

  const url = `postgresql://${DB_USER}:${DB_PASSWORD}@${container.getHost()}:${container.getMappedPort(
    5432,
  )}/${DB_NAME}?schema=public`;

  const redis = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}/0`;

  // El puerto publicado debe aceptar conexiones ANTES de que Prisma lo
  // intente (ver waitForTcp): sin esto, en hosts con daemon lento el setup
  // fallaba con P1001 a pesar de que el contenedor estaba "listo".
  await waitForTcp(container.getHost(), container.getMappedPort(5432));
  await waitForTcp(redis.getHost(), redis.getMappedPort(6379));

  try {
    await migrateDeployWithRetry({ ...process.env, DATABASE_URL: url });
  } catch (err) {
    await container.stop();
    await redis.stop();
    throw err;
  }

  writeFileSync(DB_URL_FILE, url, "utf8");
  writeFileSync(REDIS_URL_FILE, redisUrl, "utf8");

  return async () => {
    await container.stop();
    await redis.stop();
    rmSync(DB_URL_FILE, { force: true });
    rmSync(REDIS_URL_FILE, { force: true });
  };
}
