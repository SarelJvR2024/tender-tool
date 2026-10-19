"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "../_components/AuthShell";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "40px 36px", width: 360, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", fontFamily: "system-ui, sans-serif" };
const LABEL: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#16233B", marginBottom: 4, textAlign: "left" };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, boxSizing: "border-box", marginBottom: 14 };
const PRIMARY_BUTTON: React.CSSProperties = { width: "100%", minHeight: 44, padding: "0 16px", borderRadius: 8, border: "none", background: "#16233B", color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer", boxSizing: "border-box" };

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
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

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
      <div style={CARD}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Set a new password</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 28px" }}>Choose something you haven&apos;t used before</p>

        <form onSubmit={handleSubmit}>
          <label style={LABEL} htmlFor="password">New password</label>
          <input id="password" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} style={INPUT} />

          <label style={LABEL} htmlFor="confirmPassword">Confirm new password</label>
          <input id="confirmPassword" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={INPUT} />

          {error && (
            <p style={{ color: "#B91C1C", fontSize: 12, textAlign: "left", margin: "-6px 0 14px" }}>
              {error}{" "}
              {error.startsWith("This link") && (
                <Link href="/forgot-password" style={{ color: "#B91C1C", fontWeight: 600 }}>Request a new link</Link>
              )}
            </p>
          )}

          <button type="submit" disabled={pending} style={{ ...PRIMARY_BUTTON, opacity: pending ? 0.6 : 1 }}>
            {pending ? "Saving..." : "Save new password"}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
