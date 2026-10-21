import { createClient } from "@/lib/supabase/server";
import { loadDocumentExpiryOverview, type DocumentExpiryStatus } from "@/lib/documentExpiry";

/**
 * "2 documents need attention before your next bid" - Sarel's own ask: every
 * document this app already tracks an expiry date for, with a status chip,
 * expired/expiring sorted first. Reuses lib/notifications.ts's own
 * COMPANY_EXPIRY_FIELDS and source tables (lib/documentExpiry.ts), so this
 * can never disagree with what the topbar bell already says about the same
 * document - it just shows the whole list, not only what's within the
 * bell's 60-day window.
 */

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

const STATUS_STYLE: Record<DocumentExpiryStatus, { label: string; bg: string; color: string }> = {
  expired: { label: "Expired", bg: "#FEE2E2", color: "#B91C1C" },
  expiring_soon: { label: "Expires in 30 days", bg: "#FEF3C7", color: "#B45309" },
  missing: { label: "Not on file", bg: "#ECEEF1", color: "#5B6472" },
  valid: { label: "Valid", bg: "#DCFCE7", color: "#15803D" },
};

export async function DocumentExpiryOverview() {
  const supabase = await createClient();
  const rows = await loadDocumentExpiryOverview(supabase);
  const needsAttention = rows.filter((r) => r.status === "expired" || r.status === "expiring_soon" || r.status === "missing").length;

  return (
    <div id="document-expiry" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Document expiry</div>
      {needsAttention > 0 ? (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "9px 12px", margin: "8px 0 12px", fontSize: 12, color: "#92400E", fontWeight: 600 }}>
          {needsAttention} document{needsAttention === 1 ? "" : "s"} need{needsAttention === 1 ? "s" : ""} attention before your next bid.
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>Every tracked document is valid - nothing needs attention right now.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r) => {
          const st = STATUS_STYLE[r.status];
          return (
            <a key={r.id} href={r.href} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 0", borderTop: "1px solid #ECEEF1", textDecoration: "none" }}>
              <span style={{ flex: "0 0 auto", marginTop: 1, display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                {st.label}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{r.label}</div>
                <div style={{ fontSize: 12, color: "#4B5563" }}>{r.detail}</div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
