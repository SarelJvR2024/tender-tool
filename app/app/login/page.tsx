"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Google and Microsoft only - Facebook was explicitly ruled out earlier
 * (not a fit for a B2B tender tool). Both providers need to be enabled and
 * configured with real OAuth app credentials in the Supabase project's
 * Auth settings before this works - this page alone doesn't do that.
 */
export default function LoginPage() {
  const signInWith = async (provider: "google" | "azure") => {
    // Created here, not at the top of the component: this page is
    // statically prerendered, and instantiating the Supabase client during
    // that prerender throws if the env vars aren't present at build time
    // (see lib/supabase/client.ts) - only ever needed once someone clicks.
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F6F5F1", padding: 16, boxSizing: "border-box" }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "40px 36px", width: 360, maxWidth: "100%", boxSizing: "border-box", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "#16233B", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#FFFFFF" }}>
          T
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Tender Tool</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 28px" }}>Sign in to continue</p>

        <button
          onClick={() => signInWith("google")}
          style={{ width: "100%", minHeight: 44, padding: "0 16px", marginBottom: 10, borderRadius: 8, border: "1px solid #E5E1D5", background: "#FFFFFF", fontSize: 14, fontWeight: 600, color: "#16233B", cursor: "pointer", boxSizing: "border-box" }}
        >
          Continue with Google
        </button>
        <button
          onClick={() => signInWith("azure")}
          style={{ width: "100%", minHeight: 44, padding: "0 16px", borderRadius: 8, border: "1px solid #E5E1D5", background: "#FFFFFF", fontSize: 14, fontWeight: 600, color: "#16233B", cursor: "pointer", boxSizing: "border-box" }}
        >
          Continue with Microsoft
        </button>
      </div>
    </div>
  );
}
