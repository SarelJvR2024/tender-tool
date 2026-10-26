import { createClient } from "@/lib/supabase/server";
import { formatClosingDateTime } from "@/lib/dates";
import { PrintPreviewButton } from "./print-preview-button";

/**
 * Cover-page preview (prompt 10, item 3). Read-only: shows exactly what
 * engine/make_envelope_covers.py prints on the Outer/Envelope covers today
 * (letterhead logo, contract number + NRA reference, description, tenderer
 * block, closing date/time) - all already read elsewhere on this page
 * (tenderFacts) or on the company record, nothing new queried except the
 * company's own logo/legal name.
 *
 * Deliberately NOT editable. Sarel's spec asked for two user-editable
 * fields here (title wording, contact person) - checked `make_outer`/
 * `make_inner` in make_envelope_covers.py and process_pack_jobs.py's own
 * call into it before building anything: neither function accepts a title
 * override or a contact-person argument today, so a text box for either
 * would change nothing about the real generated cover - cosmetic, not
 * real. Flagged in app/AGENTS.md ("Cover page: read-only preview, two
 * fields flagged") rather than built as if it worked. The logo itself is
 * also always blank in practice: `companies.logo_storage_path` is a column
 * with no storage bucket and no upload UI anywhere in this app - also
 * flagged there, not worked around here.
 */
export async function CoverPagePreview({
  contractNo,
  nraReference,
  description,
  buyer,
  closingDate,
  company: companyOverride,
}: {
  contractNo: string | null;
  nraReference: string | null;
  description: string | null;
  buyer: string | null;
  closingDate: string | null;
  // Set by the no-signup demo (spec §6) to skip the real company read below
  // and render with a hand-built sample company instead - every other prop
  // here is already plain data, so this is the one place this component
  // reached for a live Supabase row itself.
  company?: { legal_name: string | null; logo_storage_path: string | null };
}) {
  let company = companyOverride ?? null;
  if (!company) {
    const supabase = await createClient();
    const { data } = await supabase.from("companies").select("legal_name, logo_storage_path").maybeSingle();
    company = data;
  }

  const closingText = closingDate ? (formatClosingDateTime(closingDate) ?? "—") : "- no closing date on file";
  const tendererLine = `TENDERER: ${company?.legal_name ?? "No company name on file"}`;
  const printLines = [
    company?.logo_storage_path ? "Company logo" : "No logo on file",
    "OUTER ENVELOPE",
    "The South African National Roads Agency SOC Limited",
    `CONTRACT ${contractNo ?? "- no contract number on file"}`,
    ...(nraReference ? [nraReference] : []),
    (description ?? "- no description on file").toUpperCase(),
    `TENDER CLOSES: ${closingText}`,
    `Client: ${buyer ?? "No client on file"}`,
    tendererLine,
  ];

  return (
    <div id="cover-page" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-bold text-foreground">Cover page preview</div>
        <PrintPreviewButton lines={printLines} />
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        What the Outer Envelope and Envelope covers will print, generated fresh with the pack - read-only; see below for
        why.
      </div>
      {/* Anonymous/blind-submission check (System Admin/Tender Workspace
          brief, 2026-10-25): no part of this app's extraction pipeline
          (engine/general/requirements.py, the SANRAL manifest reader)
          currently detects a "do not identify the bidder on the outer
          envelope" clause - there is no schema column and no engine rule
          to read this from, so there's nothing real to check yet. Shown as
          an honest "not checked" note rather than a fabricated Yes/No -
          same rule this file's own header comment already follows for its
          two unbuilt editable fields. The real TENDERER line keeps showing
          unconditionally below until this is actually built. */}
      <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
        Anonymous-submission check: not available yet - nothing in this tender&apos;s extracted requirements currently
        flags whether the RFP forbids identifying your company on the outer envelope. Read the RFP&apos;s own submission
        instructions by hand before relying on the tenderer line below.
      </div>
      <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
        <div className="mb-2.5 text-[11px] text-muted-foreground">
          {company?.logo_storage_path ? "Company logo" : "No logo on file"}
        </div>
        <div className="text-[13px] font-bold text-foreground">OUTER ENVELOPE</div>
        <div className="mt-2.5 text-xs text-foreground">The South African National Roads Agency SOC Limited</div>
        <div className="mt-2.5 text-xs font-bold text-foreground">CONTRACT {contractNo ?? "- no contract number on file"}</div>
        {nraReference && <div className="text-xs font-bold text-foreground">{nraReference}</div>}
        <div className="text-xs font-bold text-foreground uppercase">{description ?? "- no description on file"}</div>
        <div className="mt-2.5 text-xs font-bold text-foreground">
          TENDER CLOSES: {closingText}
        </div>
        <div className="mt-2.5 text-[11px] text-muted-foreground">Client: {buyer ?? "No client on file"}</div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">{tendererLine}</div>
      </div>
      <div className="mt-2.5 text-[11px] text-muted-foreground">
        Everything above comes from this tender and your company record - nothing here can be typed over yet.
      </div>
    </div>
  );
}
