import { createClient } from "@/lib/supabase/server";
import { loadDocumentExpiryOverview, type DocumentExpiryStatus } from "@/lib/documentExpiry";
import { SectionCard } from "@/components/tt/section-card";
import { cn } from "@/lib/utils";

/**
 * "2 documents need attention before your next bid" - Sarel's own ask: every
 * document this app already tracks an expiry date for, with a status chip,
 * expired/expiring sorted first. Reuses lib/notifications.ts's own
 * COMPANY_EXPIRY_FIELDS and source tables (lib/documentExpiry.ts), so this
 * can never disagree with what the topbar bell already says about the same
 * document - it just shows the whole list, not only what's within the
 * bell's 60-day window. Card shell restyled to the design system for this
 * sub-PR (prompt 10.1, Company vault shell); the data/logic above is
 * untouched.
 */

const STATUS_STYLE: Record<DocumentExpiryStatus, { label: string; tone: "destructive" | "warning" | "muted" | "success" }> = {
  expired: { label: "Expired", tone: "destructive" },
  expiring_soon: { label: "Expires in 30 days", tone: "warning" },
  missing: { label: "Not on file", tone: "muted" },
  valid: { label: "Valid", tone: "success" },
};

const TONE_CLASS = {
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
  warning: "border-warning/20 bg-warning/10 text-warning",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
  success: "border-success/20 bg-success/10 text-success",
};

export async function DocumentExpiryOverview() {
  const supabase = await createClient();
  const rows = await loadDocumentExpiryOverview(supabase);
  const needsAttention = rows.filter((r) => r.status === "expired" || r.status === "expiring_soon" || r.status === "missing").length;

  return (
    <div id="document-expiry" className="scroll-mt-20">
      <SectionCard title="Document expiry">
        {needsAttention > 0 ? (
          <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
            {needsAttention} document{needsAttention === 1 ? "" : "s"} need{needsAttention === 1 ? "s" : ""} attention before your next bid.
          </div>
        ) : (
          <div className="mb-3 text-xs text-muted-foreground">Every tracked document is valid - nothing needs attention right now.</div>
        )}
        <div className="flex flex-col">
          {rows.map((r) => {
            const st = STATUS_STYLE[r.status];
            return (
              <a
                key={r.id}
                href={r.href}
                className="flex items-start gap-2 border-t border-border py-2.5 text-inherit no-underline first:border-t-0 hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "mt-px inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                    TONE_CLASS[st.tone],
                  )}
                >
                  {st.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground">{r.label}</div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
              </a>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
