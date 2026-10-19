import { createCompany } from "./actions";
import { Logo } from "../_components/Logo";
import { AuthShell } from "../_components/AuthShell";

// Depends on the signed-in user's session, same reason as dashboard/page.tsx.
export const instant = false;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    // Same split-screen shell as /login and /signup (AuthShell) - this is
    // the very next screen after either, and a plain white card here broke
    // the brand/promise carried through from signup. The card below is the
    // same width and shape those two use, so it drops straight into
    // AuthShell's right panel without needing a wider layout.
    <AuthShell>
      <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "40px 36px", width: 360, maxWidth: "100%", boxSizing: "border-box", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ marginBottom: 20 }}>
          <Logo size={40} />
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Set up your company</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 24px" }}>
          One field to start - registration numbers, BEE, CIDB and the rest get added later in the company profile.
        </p>

        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "9px 14px", marginBottom: 16, fontSize: 12.5, color: "#B91C1C" }}>
            {error === "name_required" ? "Company name is required." : error}
          </div>
        )}

        <form action={createCompany}>
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#16233B", marginBottom: 6 }}>
            Company legal name
          </label>
          <input
            name="legal_name"
            required
            placeholder="Registered name, as on your CIPC certificate"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 12px", marginBottom: 18, borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 14, fontFamily: "inherit" }}
          />
          <button
            type="submit"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 16px", borderRadius: 8, border: "none", background: "#16233B", fontSize: 14, fontWeight: 600, color: "#FFFFFF", cursor: "pointer" }}
          >
            Create company and continue
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
