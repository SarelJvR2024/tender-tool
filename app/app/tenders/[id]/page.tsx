import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewButton } from "./review-button";

// Reads the signed-in user's session (via RLS) and per-tender data on every
// request - can't be prerendered. Same escape hatch as app/app/dashboard/page.tsx.
export const instant = false;

type TenderFacts = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  closing_date: string | null;
};

type TenderPack = {
  id: string;
  status: string;
};

type ProvenanceRow = {
  field_key: string;
  status: "confirmed" | "computed" | "assumed_default" | "missing";
  value: string | null;
  reason: string | null;
};

// tender_packs.status is a flat enum ('suggested' | 'confirmed' | 'filled') -
// there's no multi-stage workflow modeled in the schema, so this is an honest
// single badge rather than an invented stepper UI.
const PACK_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  suggested: { label: "Suggested - not yet confirmed", bg: "#FEF3C7", color: "#B45309" },
  confirmed: { label: "Confirmed", bg: "#DCFCE7", color: "#15803D" },
  filled: { label: "Filled", bg: "#DCFCE7", color: "#15803D" },
};

// field_key is a dotted path like "a_forms.A8.litigation" or
// "financial_hours.Roadworks.A.PL" (see 0002_field_provenance.sql) - there's
// no display-name table, so this is a best-effort humanization: drop the
// owning-script prefix segment, underscore-split the rest, title-case it.
function humanizeFieldKey(fieldKey: string): string {
  const parts = fieldKey.split(".");
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  return rest
    .join(" ")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

function daysLeft(closingDate: string | null): number | null {
  if (!closingDate) return null;
  const ms = new Date(closingDate).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default async function TenderWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tender, error: tenderError } = await supabase
    .from("tenders")
    .select("id, contract_no, nra_reference, description, closing_date")
    .eq("id", id)
    .maybeSingle();

  if (!tender && !tenderError) {
    notFound();
  }

  const tenderFacts = tender as TenderFacts | null;

  // RLS scopes this to the signed-in user's own company - there's at most
  // one pack per (company, tender) per the unique constraint in
  // 0001_init_schema.sql, so .maybeSingle() is correct, not a shortcut.
  const { data: pack, error: packError } = await supabase
    .from("tender_packs")
    .select("id, status")
    .eq("tender_id", id)
    .maybeSingle();

  const tenderPack = pack as TenderPack | null;

  let provenance: ProvenanceRow[] = [];
  let provenanceError: { message: string } | null = null;
  if (tenderPack) {
    const { data: rows, error } = await supabase
      .from("field_provenance")
      .select("field_key, status, value, reason")
      .eq("tender_pack_id", tenderPack.id)
      .order("field_key", { ascending: true });
    provenance = (rows ?? []) as ProvenanceRow[];
    provenanceError = error ? { message: error.message } : null;
  }

  const confirmedRows = provenance.filter((r) => r.status === "confirmed" || r.status === "computed");
  const reviewRows = provenance.filter((r) => r.status === "assumed_default");
  const missingRows = provenance.filter((r) => r.status === "missing");

  const left = daysLeft(tenderFacts?.closing_date ?? null);
  const packStatus = tenderPack ? PACK_STATUS_LABEL[tenderPack.status] : null;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", background: "#16233B", color: "#FFFFFF", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#16233B", flexShrink: 0 }}>T</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Tender Tool</div>
        </div>
        <Link href="/dashboard" style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", textDecoration: "none" }}>
          &larr; Back to dashboard
        </Link>
      </div>

      <div style={{ flex: 1, padding: "20px 16px", maxWidth: 820, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {tenderError && (
          <ErrorBanner message={`Could not load this tender: ${tenderError.message}`} />
        )}

        {!tenderFacts && !tenderError && (
          <ErrorBanner message="This tender could not be found." />
        )}

        {tenderFacts && (
          <>
            {/* Tender facts */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#16233B" }}>{tenderFacts.contract_no ?? "No contract number"}</div>
                  <div style={{ fontSize: 11, color: "#9A9684" }}>{tenderFacts.nra_reference ?? "No NRA reference"}</div>
                </div>
                {packStatus && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 12px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: packStatus.bg, color: packStatus.color, whiteSpace: "nowrap" }}>
                    {packStatus.label}
                  </span>
                )}
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 10px", lineHeight: 1.35 }}>
                {tenderFacts.description ?? "Untitled tender"}
              </h1>
              <div style={{ fontSize: 13, color: "#6B6758" }}>
                Closes{" "}
                {tenderFacts.closing_date ? new Date(tenderFacts.closing_date).toLocaleDateString() : "- no closing date on file"}
                {left !== null && (
                  <span style={{ marginLeft: 8, fontWeight: 600, color: left <= 7 ? "#B45309" : "#9A9684" }}>
                    ({left >= 0 ? `${left} days left` : "closed"})
                  </span>
                )}
              </div>
            </div>

            {packError && <ErrorBanner message={`Could not load this company's pack for this tender: ${packError.message}`} />}

            {!tenderPack && !packError && (
              <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "#6B6758" }}>
                No tender pack exists yet for this tender at your company - nothing to review until one is created.
              </div>
            )}

            {tenderPack && (
              <>
                {provenanceError && <ErrorBanner message={`Could not load the readiness report: ${provenanceError.message}`} />}

                {provenance.length === 0 && !provenanceError && (
                  <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "#6B6758" }}>
                    No readiness data recorded yet for this pack.
                  </div>
                )}

                {provenance.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
                    <ReportCard
                      title="Already confirmed"
                      count={confirmedRows.length}
                      accent="#15803D"
                      bg="#DCFCE7"
                      emptyText="Nothing confirmed yet."
                    >
                      {confirmedRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid #F0EEE6" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                          <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word" }}>{row.value ?? "-"}</div>
                        </div>
                      ))}
                    </ReportCard>

                    <ReportCard
                      title="Please review"
                      count={reviewRows.length}
                      accent="#B45309"
                      bg="#FEF3C7"
                      emptyText="Nothing waiting on review."
                    >
                      {reviewRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "10px 0", borderTop: "1px solid #F0EEE6" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                            <ReviewButton fieldKey={row.field_key} />
                          </div>
                          <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word", marginTop: 2 }}>{row.value ?? "-"}</div>
                          {row.reason && (
                            <div style={{ fontSize: 11, color: "#B45309", marginTop: 3 }}>{row.reason}</div>
                          )}
                        </div>
                      ))}
                    </ReportCard>

                    <ReportCard
                      title="Needs your input"
                      count={missingRows.length}
                      accent="#B91C1C"
                      bg="#FEE2E2"
                      emptyText="Nothing missing."
                    >
                      {missingRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid #F0EEE6" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                          {row.reason && (
                            <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 2 }}>{row.reason}</div>
                          )}
                        </div>
                      ))}
                    </ReportCard>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
      {message}
    </div>
  );
}

function ReportCard({
  title,
  count,
  accent,
  bg,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  bg: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{title}</div>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: bg, color: accent }}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div style={{ fontSize: 12, color: "#9A9684", paddingTop: 6 }}>{emptyText}</div>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}
