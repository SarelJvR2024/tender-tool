"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";

// Read directly off window.location rather than useSearchParams(), which
// would force this already-"use client" page behind a Suspense boundary
// just to avoid a build-time prerender error - not worth it for one param.
function nextParam(): string {
  if (typeof window === "undefined") return "/dashboard";
  const v = new URLSearchParams(window.location.search).get("next");
  return v && v.startsWith("/") ? v : "/dashboard";
}

/**
 * Google and Microsoft OAuth, plus email/password for anyone who'd rather
 * not use either (Facebook was explicitly ruled out earlier - not a fit
 * for a B2B tender tool). OAuth providers need to be enabled and
 * configured with real credentials in the Supabase project's Auth
 * settings before they work - this page alone doesn't do that.
 */

// Flip to true once the Azure provider in Supabase has real Microsoft
// Entra credentials (Sarel's own Azure app registration, not the Google
// ones that were pasted in by mistake on 2026-10-18 - that mix-up is what
// this flag exists to stop a real visitor from hitting again).
const MICROSOFT_AUTH_READY = false;

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "40px 36px", width: 360, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", fontFamily: "system-ui, sans-serif" };
const OAUTH_BUTTON: React.CSSProperties = { width: "100%", minHeight: 44, padding: "0 16px", marginBottom: 10, borderRadius: 8, border: "1px solid #E5E1D5", background: "#FFFFFF", fontSize: 14, fontWeight: 600, color: "#16233B", cursor: "pointer", boxSizing: "border-box" };
const LABEL: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#16233B", marginBottom: 4, textAlign: "left" };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, boxSizing: "border-box", marginBottom: 14 };
const PRIMARY_BUTTON: React.CSSProperties = { width: "100%", minHeight: 44, padding: "0 16px", borderRadius: 8, border: "none", background: "#16233B", color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer", boxSizing: "border-box" };

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Lazy initializer, not an effect: it needs to run during the first
  // client render (so OAuth/password sign-in redirect to the right place
  // immediately), and a plain useEffect calling setState here just causes
  // an extra render for no benefit.
  const [next] = useState(nextParam);

  const signInWith = async (provider: "google" | "azure") => {
    // Created here, not at the top of the component: this page is
    // statically prerendered, and instantiating the Supabase client during
    // that prerender throws if the env vars aren't present at build time
    // (see lib/supabase/client.ts) - only ever needed once someone clicks.
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  async function handlePasswordSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Middleware (proxy.ts) sends a signed-in user without a company to
    // /onboarding - safe to still target `next` (e.g. an /invite link),
    // since that route isn't guarded by proxy.ts and the invite page's own
    // logic handles a user who hasn't joined a company yet.
    router.push(next);
    router.refresh();
  }

  return (
    <AuthShell>
      <div style={CARD}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Welcome back</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 28px" }}>Sign in to continue</p>

        <button onClick={() => signInWith("google")} style={OAUTH_BUTTON}>
          Continue with Google
        </button>
        {MICROSOFT_AUTH_READY && (
          <button onClick={() => signInWith("azure")} style={OAUTH_BUTTON}>
            Continue with Microsoft
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "20px 0" }}>
          <div style={{ flex: 1, height: 1, background: "#E5E1D5" }} />
          <span style={{ fontSize: 11, color: "#6B6758" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "#E5E1D5" }} />
        </div>

        <form onSubmit={handlePasswordSignIn}>
          <label style={LABEL} htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={INPUT} />

          <label style={LABEL} htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={INPUT} />

          {error && <p style={{ color: "#B91C1C", fontSize: 12, textAlign: "left", margin: "-6px 0 14px" }}>{error}</p>}

          <button type="submit" disabled={pending} style={{ ...PRIMARY_BUTTON, opacity: pending ? 0.6 : 1 }}>
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, fontSize: 12 }}>
          <Link href="/forgot-password" style={{ color: "#6B6758", textDecoration: "none" }}>Forgot password?</Link>
          <Link href={next === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} style={{ color: "#16233B", fontWeight: 600, textDecoration: "none" }}>Create an account</Link>
        </div>
      </div>
    </AuthShell>
  );
}
