"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";
import { PasswordInput } from "../_components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Same OAuth providers as app/app/login/page.tsx, same MICROSOFT_AUTH_READY
// flag (see that file's own comment for the history) - this page never had
// them at all until 2026-10-22, only email/password (ported late).
const MICROSOFT_AUTH_READY = true;

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthCard({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-9 text-center shadow-sm">{children}</div>;
}

// Same reasoning as app/app/login/page.tsx: read `next` off window.location
// rather than useSearchParams(), to avoid a Suspense-boundary requirement.
function nextParam(): string {
  if (typeof window === "undefined") return "/dashboard";
  const v = new URLSearchParams(window.location.search).get("next");
  return v && v.startsWith("/") ? v : "/dashboard";
}

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Lazy initializer, not an effect - see app/app/login/page.tsx's own copy
  // of this same pattern.
  const [next] = useState(nextParam);
  // null = still checking. Defaults open (true) on a failed check rather
  // than locking every visitor out over a transient RPC error. This only
  // blocks the visible sign-up form; it does not block a direct call to
  // Supabase's own auth API. Real enforcement would need a Supabase Auth
  // Hook (server-side, configured in the Supabase dashboard) - not yet
  // built. Treat this toggle as a UI-level pause, not a hard lock.
  const [signupsEnabled, setSignupsEnabled] = useState<boolean | null>(null);

  const signUpWith = async (provider: "google" | "azure") => {
    // Created here, not at the top of the component - same reasoning as
    // login/page.tsx's own copy of this pattern (this page is statically
    // prerendered; instantiating the Supabase client during that prerender
    // throws if env vars aren't present at build time).
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  };

  useEffect(() => {
    let cancelled = false;
    createClient().rpc("signups_enabled").then(({ data, error }) => {
      if (!cancelled) setSignupsEnabled(error ? true : data !== false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function validate(): boolean {
    const next: typeof fieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) next.email = "Enter a valid email address.";
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `At least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password !== confirmPassword) next.confirmPassword = "Passwords don't match.";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setPending(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }
    // A session comes back immediately when the project has email
    // confirmation turned off (or for an already-confirmed address on
    // some Supabase configs) - don't tell someone who's already signed
    // in to go check their inbox for a link that was never sent.
    if (data.session) {
      router.push(next);
      router.refresh();
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell>
        <AuthCard>
          <h2 className="mb-2.5 font-display text-lg font-medium text-foreground">Check your email</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We&apos;ve sent a confirmation link to <strong className="text-foreground">{email}</strong>. Click it to activate your account and sign in.
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium text-foreground hover:underline">
            &larr; Back to sign in
          </Link>
        </AuthCard>
      </AuthShell>
    );
  }

  if (signupsEnabled === false) {
    return (
      <AuthShell>
        <AuthCard>
          <h2 className="mb-2.5 font-display text-lg font-medium text-foreground">Sign-ups are paused</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Tender Ready isn&apos;t taking new accounts right now. Already have one?
          </p>
          <Link href="/login" className="mt-6 inline-block text-sm font-medium text-foreground hover:underline">
            &larr; Back to sign in
          </Link>
        </AuthCard>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthCard>
        <h2 className="mb-1 font-display text-xl font-medium text-foreground">Create your account</h2>
        <p className="mb-7 text-sm text-muted-foreground">14-day trial &middot; no card needed &middot; one full bid pack</p>

        <Button variant="outline" className="mb-2.5 h-11 w-full" onClick={() => signUpWith("google")}>
          Continue with Google
        </Button>
        {MICROSOFT_AUTH_READY && (
          <Button variant="outline" className="mb-2.5 h-11 w-full" onClick={() => signUpWith("azure")}>
            Continue with Microsoft
          </Button>
        )}

        <div className="my-5 flex items-center gap-2.5">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} noValidate>
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

          <div className="mb-3.5 text-left">
            <Label htmlFor="password" className="mb-1.5">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
            />
            {fieldErrors.password && <p className="mt-1 text-xs text-destructive">{fieldErrors.password}</p>}
          </div>

          <div className="mb-1 text-left">
            <Label htmlFor="confirmPassword" className="mb-1.5">Confirm password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!fieldErrors.confirmPassword}
            />
            {fieldErrors.confirmPassword && <p className="mt-1 text-xs text-destructive">{fieldErrors.confirmPassword}</p>}
          </div>

          {error && <p className="mt-3 text-left text-xs text-destructive">{error}</p>}

          <Button type="submit" disabled={pending} className="mt-4 h-11 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Creating account..." : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-[11px] text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link href="/privacy" className="underline hover:text-foreground">privacy notice</Link>.
        </p>

        <p className="mt-3 text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href={next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="font-medium text-foreground hover:underline">Sign in</Link>
        </p>
      </AuthCard>
    </AuthShell>
  );
}
