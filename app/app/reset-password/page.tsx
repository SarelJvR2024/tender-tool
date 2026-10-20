"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";
import { PasswordInput } from "../_components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD_LENGTH = 8;

/**
 * Reached only via the link in a password-reset email, after
 * app/auth/callback/route.ts has already exchanged the recovery code for
 * a session (next=/reset-password). Calling updateUser without that
 * session (e.g. someone just typing this URL directly) fails cleanly -
 * handled below as an expired-link message, not a crash.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validate(): boolean {
    const next: typeof fieldErrors = {};
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
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);

    if (error) {
      setError("This link has expired or is invalid. Request a new one.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell>
      <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-9 text-center shadow-sm">
        <h1 className="mb-1 font-display text-xl font-medium text-foreground">Set a new password</h1>
        <p className="mb-7 text-sm text-muted-foreground">Choose something you haven&apos;t used before</p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-3.5 text-left">
            <Label htmlFor="password" className="mb-1.5">New password</Label>
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
            <Label htmlFor="confirmPassword" className="mb-1.5">Confirm new password</Label>
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

          {error && (
            <p className="mt-3 text-left text-xs text-destructive">
              {error}{" "}
              {error.startsWith("This link") && (
                <Link href="/forgot-password" className="font-medium underline">Request a new link</Link>
              )}
            </p>
          )}

          <Button type="submit" disabled={pending} className="mt-4 h-11 w-full">
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Saving..." : "Save new password"}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
