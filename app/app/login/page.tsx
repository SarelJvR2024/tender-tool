"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";
import { PasswordInput } from "../_components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

// Was false 2026-10-18 to 2026-10-22: Supabase's Azure provider had
// Google's credentials pasted into it by mistake, and this flag existed to
// stop a real visitor hitting that broken path. Fixed 2026-10-22 - a real
// Microsoft Entra app registration ("Tender Ready", multi-tenant + personal
// accounts, Supabase's own /auth/v1/callback as the redirect URI) now backs
// Supabase's Azure provider, tenant set to "common" to match.
const MICROSOFT_AUTH_READY = true;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
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

  function validate(): boolean {
    const next: typeof fieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) next.email = "Enter a valid email address.";
    if (!password) next.password = "Enter your password.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handlePasswordSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

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
      <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-9 text-center shadow-sm">
        <h1 className="mb-1 font-display text-xl font-medium text-foreground">Welcome back</h1>
        <p className="mb-7 text-sm text-muted-foreground">Sign in to continue</p>

        <Button variant="outline" className="mb-2.5 h-11 w-full" onClick={() => signInWith("google")}>
          Continue with Google
        </Button>
        {MICROSOFT_AUTH_READY && (
          <Button variant="outline" className="mb-2.5 h-11 w-full" onClick={() => signInWith("azure")}>
            Continue with Microsoft
          </Button>
        )}

        <div className="my-5 flex items-center gap-2.5">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handlePasswordSignIn} noValidate>
          <div className="mb-3.5 text-left">
            <Label htmlFor="email" className="mb-1.5">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              className="h-11"
            />
            {fieldErrors.email && <p className="mt-1 text-xs text-destructive">{fieldErrors.email}</p>}
          </div>

          <div className="mb-1 text-left">
            <Label htmlFor="password" className="mb-1.5">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
            />
            {fieldErrors.password && <p className="mt-1 text-xs text-destructive">{fieldErrors.password}</p>}
          </div>

          {error && <p className="mt-3 text-left text-xs text-destructive">{error}</p>}

          <Button type="submit" disabled={pending} className="mt-4 h-11 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <div className="mt-4 flex justify-between text-xs">
          <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">Forgot password?</Link>
          <Link href={next === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} className="font-medium text-foreground hover:underline">Create an account</Link>
        </div>
      </div>
    </AuthShell>
  );
}
