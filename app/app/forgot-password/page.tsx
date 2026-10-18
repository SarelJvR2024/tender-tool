"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const CARD: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "40px 36px", width: 360, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", fontFamily: "system-ui, sans-serif" };
const LABEL: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#16233B", marginBottom: 4, textAlign: "left" };
const INPUT: React.CSSProperties = { width: "100%", minHeight: 40, padding: "0 12px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, boxSizing: "border-box", marginBottom: 14 };
const PRIMARY_BUTTON: React.CSSProperties = { width: "100%", minHeight: 44, padding: "0 16px", borderRadius: 8, border: "none", background: "#16233B", color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer", boxSizing: "border-box" };

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F6F5F1", padding: 16, boxSizing: "border-box" }}>
        <div style={CARD}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: "#16233B", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#FFFFFF" }}>
            T
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 10px" }}>Check your email</h1>
          <p style={{ fontSize: 13, color: "#6B6758", margin: 0, lineHeight: 1.6 }}>
            If an account exists for <strong>{email}</strong>, a password reset link is on its way.
          </p>
          <Link href="/login" style={{ display: "inline-block", marginTop: 24, fontSize: 13, color: "#16233B", fontWeight: 600, textDecoration: "none" }}>
            &larr; Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F6F5F1", padding: 16, boxSizing: "border-box" }}>
      <div style={CARD}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "#16233B", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#FFFFFF" }}>
          T
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Reset your password</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 28px" }}>We&apos;ll email you a link to set a new one</p>

        <form onSubmit={handleSubmit}>
          <label style={LABEL} htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={INPUT} />

          {error && <p style={{ color: "#B91C1C", fontSize: 12, textAlign: "left", margin: "-6px 0 14px" }}>{error}</p>}

          <button type="submit" disabled={pending} style={{ ...PRIMARY_BUTTON, opacity: pending ? 0.6 : 1 }}>
            {pending ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <Link href="/login" style={{ display: "inline-block", marginTop: 20, fontSize: 12, color: "#6B6758", textDecoration: "none" }}>
          &larr; Back to sign in
        </Link>
      </div>
    </div>
  );
}
