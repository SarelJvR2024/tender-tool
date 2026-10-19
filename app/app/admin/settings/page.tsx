import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
import { setPlatformSetting } from "../actions";

// Reads per-request session/DB data (platform_admin_settings RPC, 0064) -
// same escape hatch as ../page.tsx.
export const instant = false;

type Setting = { key: string; value: boolean; description: string; updated_at: string };

const SETTING_LABEL: Record<string, string> = {
  signups_enabled: "Public sign-ups",
};

// Super admin portal, part 2 (0064): switches a platform admin can flip
// without a deploy. Deliberately small and real - each row here actually
// gates something (signups_enabled checked live by /signup), not a toggle
// that looks wired but does nothing.
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("platform_admin_settings");
  const settings = (data ?? []) as Setting[];

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <SiteNav active="admin" />

      <div style={{ padding: "24px 32px", maxWidth: 1000, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 12 }}>
          <Link href="/admin" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Alerts &amp; harness results</Link>
          <Link href="/admin/customers" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Customers</Link>
          <span style={{ color: "#16233B", fontWeight: 600 }}>Settings</span>
          <Link href="/admin/taxonomy" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discipline list</Link>
          <Link href="/admin/discovered-opportunities" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discovered opportunities</Link>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>System settings</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 16px" }}>
          Platform-wide switches, applied the moment you flip them - no deploy needed.
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? `Could not load settings: ${error.message}` : actionError}
          </div>
        )}

        <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, overflow: "hidden" }}>
          {settings.length === 0 && !error && (
            <div style={{ padding: "24px 18px", fontSize: 13, color: "#5B6472" }}>No settings recorded.</div>
          )}
          {settings.map((s) => (
            <div key={s.key} style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center", padding: "16px 18px", borderTop: "1px solid #ECEEF1" }}>
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#16233B" }}>{SETTING_LABEL[s.key] ?? s.key}</div>
                <div style={{ fontSize: 12, color: "#5B6472", marginTop: 2 }}>{s.description}</div>
                <div style={{ fontSize: 11, color: "#8A93A0", marginTop: 4 }}>Last changed {new Date(s.updated_at).toLocaleString()}</div>
              </div>
              <form action={setPlatformSetting}>
                <input type="hidden" name="key" value={s.key} />
                <input type="hidden" name="value" value={(!s.value).toString()} />
                <button
                  type="submit"
                  style={{
                    fontSize: 12, fontWeight: 600, padding: "8px 14px", minHeight: 40, borderRadius: 7, border: "none", cursor: "pointer",
                    background: s.value ? "#16233B" : "#E3E6EA", color: s.value ? "#FFFFFF" : "#5B6472",
                  }}
                >
                  {s.value ? "On - click to turn off" : "Off - click to turn on"}
                </button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
