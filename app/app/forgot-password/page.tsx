"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthCard({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-9 text-center shadow-sm">{children}</div>;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_PATTERN.test(email.trim())) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);

    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setPending(false);

    if (error) {
      setError(error.message);
      return;
    }
    // Shown regardless of whether the email is actually registered -
    // Supabase itself doesn't reveal that, and neither should this page.
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell>
        <AuthCard>
          <h2 className="mb-2.5 font-display text-lg font-medium text-foreground">Check your email</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            If an account exists for <strong className="text-foreground">{email}</strong>, a password reset link is on its way.
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
        <h2 className="mb-1 font-display text-xl font-medium text-foreground">Reset your password</h2>
        <p className="mb-7 text-sm text-muted-foreground">We&apos;ll email you a link to set a new one</p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-1 text-left">
            <Label htmlFor="email" className="mb-1.5">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldError}
              className="h-11"
            />
            {fieldError && <p className="mt-1 text-xs text-destructive">{fieldError}</p>}
          </div>

          {error && <p className="mt-3 text-left text-xs text-destructive">{error}</p>}

          <Button type="submit" disabled={pending} className="mt-4 h-11 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Sending..." : "Send reset link"}
          </Button>
        </form>

        <Link href="/login" className="mt-5 inline-block text-xs text-muted-foreground hover:text-foreground">
          &larr; Back to sign in
        </Link>
      </AuthCard>
    </AuthShell>
  );
}
