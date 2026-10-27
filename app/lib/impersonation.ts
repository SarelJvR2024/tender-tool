// Admin Command Center, Phase 4: "View Tenant Workspace" impersonation
// (2026-10-27), built under Sarel's own 5 guardrails. This file is the ONLY
// place that touches the service-role key or mints a target-user session -
// everything in it runs server-side only (Server Actions, never a Client
// Component), and nothing it returns to a caller is ever the service-role
// key itself, only a short-lived user session for the one target user being
// viewed as.
//
// Session handling (guardrail 1 - "no service-role leak, no session
// overwrite"): the admin's own real sign-in lives in Supabase's own
// `sb-*-auth-token` cookie(s), written by @supabase/ssr - this file NEVER
// touches those. Impersonation state lives in one SEPARATE cookie
// (IMPERSONATION_COOKIE) carrying the TARGET user's own session tokens (not
// the admin's, not the service-role key). lib/supabase/server.ts's
// createClient() checks for this cookie and, when present, returns a client
// hydrated with the target session instead of the admin's own - every
// existing Server Component/Action in the app that already calls
// createClient() therefore "just works" under impersonation with zero
// per-page changes, and exiting (clearing this one cookie) instantly
// restores the admin's own session, untouched the whole time - nothing to
// "restore" because nothing was ever overwritten.
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const IMPERSONATION_COOKIE = "tt_impersonation";

// A hard ceiling independent of the underlying Supabase session's own
// expiry - bounds how long a forgotten/never-exited impersonation can
// silently linger, same reasoning lifecycle_unsubscribe_tokens-style bearer
// credentials elsewhere in this app stay narrowly scoped.
export const IMPERSONATION_MAX_AGE_SECONDS = 4 * 60 * 60;

export type ImpersonationCookiePayload = {
  auditLogId: string;
  accessToken: string;
  refreshToken: string;
};

/**
 * Service-role client, server-side only. Null (never throws) when the
 * environment has no service-role key configured yet - this is the FIRST
 * time the deployed Next.js app itself would need one (every other
 * service-role caller in this repo is a GitHub Actions workflow or a
 * standalone script - confirmed by grepping the whole app/ tree), so a
 * missing key here is a real, expected possibility until Sarel adds it to
 * Vercel's own env vars, not a bug to crash on.
 */
function serviceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseJsClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Whether impersonation can even be attempted in this environment - callers check this before offering the UI action at all, rather than letting it fail after the admin has already clicked through. */
export function impersonationConfigured(): boolean {
  return serviceRoleClient() !== null;
}

/**
 * Mints a real session for one target user, silently (no email is ever
 * sent - generateLink() only GENERATES a link/token, it never dispatches
 * one; only an actual OTP/magic-link SEND would). Two-step Auth API dance,
 * the documented way to do this since supabase-js has no direct
 * "admin.signInAsUser()" method:
 *   1. admin.generateLink({type: 'magiclink', email}) - service-role only,
 *      returns a hashed_token tied to that user.
 *   2. verifyOtp({token_hash, type: 'magiclink'}) on a PLAIN (non-admin)
 *      client - exchanges that token for a real access/refresh token pair
 *      for exactly that user, with exactly their own normal permissions.
 * Never raises - every failure is returned as a tagged result so the
 * caller can show a clear error instead of a half-started impersonation.
 */
export async function mintTargetSession(targetEmail: string): Promise<
  { ok: true; accessToken: string; refreshToken: string } | { ok: false; error: string }
> {
  const admin = serviceRoleClient();
  if (!admin) return { ok: false, error: "Impersonation isn't configured in this environment (no service role key)." };

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: targetEmail });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("generateLink failed for impersonation", linkError);
    return { ok: false, error: "Could not prepare a session for this tenant's member." };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { ok: false, error: "Supabase isn't configured in this environment." };
  const anon = createSupabaseJsClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verifyData.session) {
    console.error("verifyOtp failed for impersonation", verifyError);
    return { ok: false, error: "Could not start a session for this tenant's member." };
  }

  return { ok: true, accessToken: verifyData.session.access_token, refreshToken: verifyData.session.refresh_token };
}

/** Server Action only (cookies().set requires a mutable context) - writes the one impersonation cookie, httpOnly/secure, never touching the admin's own `sb-*` auth cookies. */
export async function setImpersonationCookie(payload: ImpersonationCookiePayload): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_MAX_AGE_SECONDS,
  });
}

/** Server Action only - the entire "exit" action: delete this one cookie. The admin's own session was never touched, so there is nothing else to restore. */
export async function clearImpersonationCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE);
}

/** Readable anywhere (Server Components included) - cookies().get() never requires the mutable context getAll/set does. */
export async function readImpersonationCookie(): Promise<ImpersonationCookiePayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.auditLogId === "string" && typeof parsed?.accessToken === "string" && typeof parsed?.refreshToken === "string") {
      return parsed as ImpersonationCookiePayload;
    }
  } catch {
    // Malformed/tampered cookie - treated as "not impersonating", never trusted.
  }
  return null;
}
