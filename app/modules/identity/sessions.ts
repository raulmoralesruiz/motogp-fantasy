/**
 * Sesiones (US-01, security.md §1.1): token opaco en BD + cookie HttpOnly.
 *
 * Las piezas puras (construcción de la cookie, parseo de la cabecera
 * `Cookie`) están separadas para poder testearlas sin I/O.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient, Profile, Role, Session, User } from "@prisma/client";

export const SESSION_COOKIE_NAME = "session";

/** Usuario con sus relaciones de sesión (perfil + roles). */
export type SessionUser = User & {
  profile: Profile | null;
  userRoles: { role: Role }[];
};

/** Proyección pública del usuario (sin datos sensibles — GDPR, AGENTS.md §8). */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  roles: string[];
  createdAt: Date;
}

export function toPublicUser(user: SessionUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.profile?.displayName ?? null,
    roles: user.userRoles.map((ur) => ur.role.name),
    createdAt: user.createdAt,
  };
}

export interface SessionCookieOptions {
  /** Vigencia de la sesión en segundos (Max-Age). */
  maxAgeSec: number;
  /** Flag Secure (obligatorio en producción; solo false en dev local). */
  secure: boolean;
}

/**
 * PURA: construye la cabecera `Set-Cookie` de la sesión.
 * Flags: HttpOnly + Secure + SameSite=Lax (security.md §1.1, CA de US-01).
 */
export function buildSessionCookie(token: string, opts: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(opts.maxAgeSec)}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** PURA: parsea una cabecera `Cookie` a un mapa nombre→valor. */
export function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = part.slice(idx + 1).trim();
  }
  return out;
}

/** Token opaco: 32 bytes aleatorios (256 bits) en hex (security.md §1.1). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export interface CreateSessionInput {
  userId: string;
  /** Vigencia de la sesión en segundos. */
  ttlSec: number;
  ip?: string | null;
  userAgent?: string | null;
}

/** Crea una sesión en BD (token opaco + expiración + auditoría básica). */
export async function createSession(
  prisma: PrismaClient,
  input: CreateSessionInput,
): Promise<Session> {
  return prisma.session.create({
    data: {
      userId: input.userId,
      token: generateSessionToken(),
      expiresAt: new Date(Date.now() + input.ttlSec * 1000),
      ip: input.ip ?? null,
      userAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
    },
  });
}

/**
 * Resuelve el usuario activo de un token de sesión: la sesión debe existir,
 * no estar revocada, no estar expirada y el usuario no debe estar
 * anonimizado (GDPR).
 */
export async function findActiveSessionUser(
  prisma: PrismaClient,
  token: string | undefined,
  now: Date = new Date(),
): Promise<SessionUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        include: { profile: true, userRoles: { include: { role: true } } },
      },
    },
  });
  if (!session || session.revokedAt !== null || session.expiresAt <= now) return null;
  if (session.user.isAnonymized) return null;
  return session.user;
}

/** Revoca una sesión (idempotente; US-02 usará esto para el logout). */
export async function revokeSession(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
