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

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
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
      router.push("/dashboard");
      router.refresh();
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <AuthShell>
        <div style={CARD}>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 10px" }}>Check your email</h1>
          <p style={{ fontSize: 13, color: "#6B6758", margin: 0, lineHeight: 1.6 }}>
            We&apos;ve sent a confirmation link to <strong>{email}</strong>. Click it to activate your account and sign in.
          </p>
          <Link href="/login" style={{ display: "inline-block", marginTop: 24, fontSize: 13, color: "#16233B", fontWeight: 600, textDecoration: "none" }}>
            &larr; Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div style={CARD}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Create your account</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 28px" }}>Start tracking and preparing tenders</p>

        <form onSubmit={handleSubmit}>
          <label style={LABEL} htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={INPUT} />

          <label style={LABEL} htmlFor="password">Password</label>
          <input id="password" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} style={INPUT} />

          <label style={LABEL} htmlFor="confirmPassword">Confirm password</label>
          <input id="confirmPassword" type="password" required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={INPUT} />

          {error && <p style={{ color: "#B91C1C", fontSize: 12, textAlign: "left", margin: "-6px 0 14px" }}>{error}</p>}

          <button type="submit" disabled={pending} style={{ ...PRIMARY_BUTTON, opacity: pending ? 0.6 : 1 }}>
            {pending ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 12, color: "#6B6758" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ color: "#16233B", fontWeight: 600, textDecoration: "none" }}>Sign in</Link>
        </p>
      </div>
    </AuthShell>
  );
}
