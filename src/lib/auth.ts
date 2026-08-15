import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env, requireEnv } from "@/lib/env";

const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

interface SessionPayload {
  sub: "admin";
  [key: string]: unknown;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("SESSION_SECRET"));
}

/** Verify the submitted password against the single admin password. */
export function verifyPassword(candidate: string): boolean {
  const expected = requireEnv("ADMIN_PASSWORD");
  return candidate === expected;
}

/** Sign a short-lived session JWT for the single admin user. */
export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "admin" } satisfies SessionPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecretKey());
}

/** Verify a session JWT; returns the payload if valid, null otherwise. */
export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/** Set the session cookie on the response (server actions / route handlers). */
export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(env.sessionCookieName, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(env.sessionCookieName);
}

/** Read + verify the current session from the incoming request cookies. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(env.sessionCookieName)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
