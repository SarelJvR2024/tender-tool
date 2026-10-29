import { createClient } from "@/lib/supabase/server";
import { loadDocumentExpiryOverview, type DocumentExpiryStatus } from "@/lib/documentExpiry";
import { SectionCard } from "@/components/tt/section-card";
import { cn } from "@/lib/utils";
import { DocumentUploadAction } from "./_components/DocumentRow";
import { VAULT_DOCUMENTS } from "@/lib/vaultDocuments";

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
 *
 * Real finding, 2026-10-29 (Sarel: make every row here "an interactive
 * upload target with click-to-upload and inline drag-and-drop"): every row
 * was a plain link down to the matching vault section - never an upload
 * target itself. The 7 rows sourced from a company field (lib/documentExpiry
 * .ts's `kind`) each have a real Document Vault upload slot
 * (lib/vaultDocuments.ts), so those now render the SAME DocumentUploadAction
 * (and the SAME FileDropzone underneath it - click or drag, one control,
 * spec v3 O12) the vault's own Compliance documents section already uses -
 * not a second, parallel upload implementation that could silently drift
 * from it. held_registrations and per-person ECSA/SACPCMP rows have no
 * vault slot at all (they live on /company/registrations and /people/[id])
 * and keep their original link-only row - inventing an upload control with
 * nothing real behind it would be worse than the plain link.
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

export async function DocumentExpiryOverview({ companyId }: { companyId: string }) {
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
            const chip = (
              <span
                className={cn(
                  "mt-px inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                  TONE_CLASS[st.tone],
                )}
              >
                {st.label}
              </span>
            );
            if (!r.kind) {
              return (
                <a
                  key={r.id}
                  href={r.href}
                  className="flex items-start gap-2 border-t border-border py-2.5 text-inherit no-underline first:border-t-0 hover:bg-muted/50"
                >
                  {chip}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground">{r.label}</div>
                    <div className="text-xs text-muted-foreground">{r.detail}</div>
                  </div>
                </a>
              );
            }
            return (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-border py-2.5 first:border-t-0">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {chip}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-foreground">{r.label}</div>
                    <div className="text-xs text-muted-foreground">{r.detail}</div>
                  </div>
                </div>
                <div className="w-full sm:w-auto">
                  <DocumentUploadAction companyId={companyId} kind={r.kind} title={VAULT_DOCUMENTS[r.kind].label} hasExisting={!!r.hasExisting} />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
