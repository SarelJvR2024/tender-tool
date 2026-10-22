import { createClient } from "@/lib/supabase/server";

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
}: {
  contractNo: string | null;
  nraReference: string | null;
  description: string | null;
  buyer: string | null;
  closingDate: string | null;
}) {
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("legal_name, logo_storage_path").maybeSingle();

  return (
    <div id="cover-page" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 text-[15px] font-bold text-foreground">Cover page preview</div>
      <div className="mb-3 text-xs text-muted-foreground">
        What the Outer Envelope and Envelope covers will print, generated fresh with the pack - read-only; see below for
        why.
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
          TENDER CLOSES: {closingDate ? new Date(closingDate).toLocaleString() : "- no closing date on file"}
        </div>
        <div className="mt-2.5 text-[11px] text-muted-foreground">Client: {buyer ?? "No client on file"}</div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">TENDERER: {company?.legal_name ?? "No company name on file"}</div>
      </div>
      <div className="mt-2.5 text-[11px] text-muted-foreground">
        Everything above comes from this tender and your company record - nothing here can be typed over yet. The
        title wording and a chosen contact person (Sarel&apos;s own spec) aren&apos;t things the cover generator
        accepts as input today, so a box for either would change nothing about the real cover; see app/AGENTS.md for
        what that would take.
      </div>
    </div>
  );
}
