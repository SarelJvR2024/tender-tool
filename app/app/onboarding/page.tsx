import { createCompany } from "./actions";

// Depends on the signed-in user's session, same reason as dashboard/page.tsx.
export const instant = false;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F6F5F1", padding: 16 }}>
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "40px 36px", width: 360, maxWidth: "100%", boxSizing: "border-box", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: "#16233B", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, color: "#FFFFFF" }}>
          T
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Set up your company</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 24px" }}>
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
            placeholder="e.g. Klipcorp (Pty) Ltd"
            style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", marginBottom: 18, borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "inherit" }}
          />
          <button
            type="submit"
            style={{ width: "100%", padding: "10px 16px", borderRadius: 8, border: "none", background: "#16233B", fontSize: 14, fontWeight: 600, color: "#FFFFFF", cursor: "pointer" }}
          >
            Create company and continue
          </button>
        </form>
      </div>
    </div>
  );
}
