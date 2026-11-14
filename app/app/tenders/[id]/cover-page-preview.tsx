import { createClient } from "@/lib/supabase/server";
import { formatClosingDateTime } from "@/lib/dates";
import { PrintPreviewButton } from "./print-preview-button";
import { buildOuterEnvelopeLines, coverOmittedReason, deliveryAddressLines } from "./cover-page-lines";

/**
 * Cover-page preview (prompt 10, item 3). Read-only: shows exactly what
 * engine/make_envelope_covers.py prints on the Outer/Envelope covers today
 * (letterhead logo, contract number + NRA reference, description, tenderer
 * block, closing date/time, and - Finding 353 - the tender's own tender-box
 * delivery address when one was found at intake) - all already read
 * elsewhere on this page (tenderFacts/tenderPack's own `intake`) or on the
 * company record, nothing new queried except the company's own logo/legal
 * name/registered address/CIPC number.
 *
 * Finding 425: the real `_bidder_block()` prints the company's own
 * `registered_address` and `cipc_registration_number` (each only if on
 * file) right after the TENDERER line - this component read neither column
 * and never showed either line, so a company with its registered address
 * and/or CIPC number already on file (both ordinary /company fields most
 * companies set) saw a preview missing content that genuinely prints on
 * every real cover.
 *
 * Finding 465: `engine/pack/assemble_pack.py` only calls `make_outer()`/
 * `make_inner()` at all when the tender's own NRA reference, description AND
 * closing date are ALL on file - otherwise it produces NO cover pages
 * whatsoever (`cover_reason`, logged, zero `pdf` for every cover section).
 * This component had no equivalent check and always rendered a full fake
 * cover with "- no X on file" placeholders for any missing field, directly
 * contradicting its own "shows exactly what engine/make_envelope_covers.py
 * prints" promise above in the one case that matters most. Now checks
 * `coverOmittedReason()` first and, when any of the three is missing, shows
 * an honest "no cover pages will be generated" notice instead of the fake
 * preview box.
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
  deliveryAddress,
  company: companyOverride,
}: {
  contractNo: string | null;
  nraReference: string | null;
  description: string | null;
  buyer: string | null;
  closingDate: string | null;
  // Finding 353: the tender's own tender-box delivery address, read at
  // intake from the tender's own Tender Notice (`intake.delivery_address.lines`,
  // tender_packs.intake taking precedence over tenders.intake - the same
  // precedence intake-card.tsx's own `ownPack?.intake ?? tender.intake`
  // already uses) - null/undefined when none was found, which prints (and
  // here, shows) nothing extra, same as before this fix.
  deliveryAddress?: string[] | null;
  // Set by the no-signup demo (spec §6) to skip the real company read below
  // and render with a hand-built sample company instead - every other prop
  // here is already plain data, so this is the one place this component
  // reached for a live Supabase row itself. registered_address/
  // cipc_registration_number are optional here (Finding 425): the demo's
  // own hand-built DEMO_COMPANY never set either, and ?? below already
  // treats "not supplied" the same as "on file but blank".
  company?: {
    legal_name: string | null;
    logo_storage_path: string | null;
    registered_address?: string | null;
    cipc_registration_number?: string | null;
  };
}) {
  let company = companyOverride ?? null;
  if (!company) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("companies")
      .select("legal_name, logo_storage_path, registered_address, cipc_registration_number")
      .maybeSingle();
    company = data;
  }

  // Finding 465: the real engine (engine/pack/assemble_pack.py) refuses to
  // generate ANY of the three covers at all when one of these is missing -
  // see cover-page-lines.ts's own header comment for the full incident.
  // Checked first, before building the (otherwise-misleading) fake preview
  // lines below.
  const omittedReason = coverOmittedReason({ nraReference, description, closingDate });

  const closingText = closingDate ? (formatClosingDateTime(closingDate) ?? "—") : "- no closing date on file";
  const tendererLine = `TENDERER: ${company?.legal_name ?? "No company name on file"}`;
  const registeredAddress = company?.registered_address ?? null;
  const cipcRegistrationNumber = company?.cipc_registration_number ?? null;
  const addressLines = deliveryAddressLines(deliveryAddress);
  const printLines = buildOuterEnvelopeLines({
    hasLogo: !!company?.logo_storage_path,
    contractNo,
    nraReference,
    description,
    closingText,
    buyer,
    tendererLine,
    deliveryAddress,
    registeredAddress,
    cipcRegistrationNumber,
  });

  return (
    <div id="cover-page" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-bold text-foreground">Cover page preview</div>
        {!omittedReason && <PrintPreviewButton lines={printLines} />}
      </div>
      {omittedReason ? (
        <>
          <div className="mb-3 text-xs text-muted-foreground">
            What the Outer Envelope and Envelope covers will print, generated fresh with the pack - read-only.
          </div>
          {/* Finding 465: matches assemble_pack.py's own cover_reason exactly
              - the real pack build makes NO cover pages at all in this case,
              so showing the fake "- no X on file" preview below would be a
              false promise that a document is about to exist. */}
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
            No cover pages will be generated with this pack: {omittedReason}. Fill in the missing tender field(s) above
            before generating - the real pack build never invents them, and will produce no Outer Envelope or Envelope 1/2
            cover sheets at all until they&apos;re on file.
          </div>
        </>
      ) : (
        <div className="mb-3 text-xs text-muted-foreground">
          What the Outer Envelope and Envelope covers will print, generated fresh with the pack - read-only; see below for
          why.
        </div>
      )}
      {!omittedReason && (
        <>
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
            {addressLines.map((line, i) => (
              <div key={i} className="text-xs text-foreground">{line}</div>
            ))}
            <div className="mt-2.5 text-xs font-bold text-foreground">CONTRACT {contractNo ?? "- no contract number on file"}</div>
            {nraReference && <div className="text-xs font-bold text-foreground">{nraReference}</div>}
            <div className="text-xs font-bold text-foreground uppercase">{description ?? "- no description on file"}</div>
            <div className="mt-2.5 text-xs font-bold text-foreground">
              TENDER CLOSES: {closingText}
            </div>
            <div className="mt-2.5 text-[11px] text-muted-foreground">Client: {buyer ?? "No client on file"}</div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">{tendererLine}</div>
            {registeredAddress && <div className="text-[11px] text-muted-foreground">{registeredAddress}</div>}
            {cipcRegistrationNumber && (
              <div className="text-[11px] text-muted-foreground">CIPC Registration No: {cipcRegistrationNumber}</div>
            )}
          </div>
          <div className="mt-2.5 text-[11px] text-muted-foreground">
            Everything above comes from this tender and your company record - nothing here can be typed over yet.
          </div>
        </>
      )}
    </div>
  );
}
