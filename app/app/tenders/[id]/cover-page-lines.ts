/**
 * Pure "what will print" line-building behind cover-page-preview.tsx -
 * factored out so it's testable without a React/Supabase harness, same
 * split tender-readiness.ts already uses for page.tsx's own pure logic.
 *
 * Finding 353: engine/make_envelope_covers.py's own `_addressee_block()`
 * (added 2026-10-18 - see that function's own header comment, "R.396's own
 * Tender Notice says the tender box is at 20 Shoreward Drive...") prints
 * "The South African National Roads Agency SOC Limited" followed by the
 * tender's own tender-box delivery-address lines (read at intake from the
 * tender's own Tender Notice - `intake.delivery_address.lines`,
 * engine/general/process_general_jobs.py, SANRAL route only) whenever one
 * was found on this specific tender, filtering out any blank line
 * (`[l for l in (delivery_address or []) if l]` in Python) rather than
 * printing a bare empty paragraph. `cover-page-preview.tsx`'s own header
 * comment promises this component "shows exactly what
 * engine/make_envelope_covers.py prints ... today" - this must be kept in
 * exact sync with that filter and that line position for that promise to
 * stay true whenever a tender has a real delivery address on file, instead
 * of always rendering as if no delivery address was ever found (silently
 * wrong for any such tender, not merely incomplete).
 *
 * Finding 425: the real generator's own `_bidder_block()` (same file)
 * prints the TENDERER heading/legal name, then - each only if actually on
 * file - the company's own `registered_address` and, as "CIPC Registration
 * No: <number>", its `cipc_registration_number`. This preview's own
 * `tendererLine` only ever covered the legal-name half of that block; the
 * other two real, commonly-populated company fields (both ordinary /company
 * page columns most companies have on file, read by this exact pipeline for
 * fill_docx_forms.py's own Address field too) were never read or shown here
 * at all, so the preview silently omitted content that genuinely prints on
 * every real Outer/Envelope cover for any company with either field set -
 * the same "preview promises exactly what the generator prints, but doesn't"
 * shape Finding 353 fixed for the delivery address, on the bidder block
 * instead of the addressee block.
 *
 * Finding 465: `engine/pack/assemble_pack.py`'s own gate right before it
 * calls `make_outer()`/`make_inner()` - `if not (nra_ref and description and
 * closing):` - means the real pack build produces NO cover pages at all
 * (outer or either inner envelope) whenever any one of those three tender
 * fields is missing; it records a `cover_reason` string
 * ("tender record has no <missing fields> - never invented") and every
 * cover section comes back with `pdf: None` instead. This preview had no
 * equivalent check at all: it rendered a full fake cover with "- no X on
 * file" placeholder text for each missing field, which looks like (and this
 * component's own header comment claims to be) a preview of a real document
 * that is about to be generated - when in the one case that actually
 * matters (one of these three fields missing), the real engine generates
 * nothing whatsoever. `coverOmittedReason()` mirrors that exact gate/message
 * so the preview can tell the user the truth instead.
 */
export function coverOmittedReason(input: {
  nraReference: string | null;
  description: string | null;
  closingDate: string | null;
}): string | null {
  const missing: string[] = [];
  if (!input.nraReference) missing.push("NRA reference");
  if (!input.description) missing.push("description");
  if (!input.closingDate) missing.push("closing date");
  return missing.length > 0 ? `tender record has no ${missing.join(", ")} - never invented` : null;
}
export function deliveryAddressLines(deliveryAddress?: string[] | null): string[] {
  return (deliveryAddress ?? []).filter((line) => !!line && line.trim() !== "");
}

export function buildOuterEnvelopeLines(input: {
  hasLogo: boolean;
  contractNo: string | null;
  nraReference: string | null;
  description: string | null;
  closingText: string;
  buyer: string | null;
  tendererLine: string;
  deliveryAddress?: string[] | null;
  /** _bidder_block()'s own two optional lines, in its own order - each only printed (here, shown) when actually on file. */
  registeredAddress?: string | null;
  cipcRegistrationNumber?: string | null;
}): string[] {
  return [
    input.hasLogo ? "Company logo" : "No logo on file",
    "OUTER ENVELOPE",
    "The South African National Roads Agency SOC Limited",
    ...deliveryAddressLines(input.deliveryAddress),
    `CONTRACT ${input.contractNo ?? "- no contract number on file"}`,
    ...(input.nraReference ? [input.nraReference] : []),
    (input.description ?? "- no description on file").toUpperCase(),
    `TENDER CLOSES: ${input.closingText}`,
    `Client: ${input.buyer ?? "No client on file"}`,
    input.tendererLine,
    ...(input.registeredAddress ? [input.registeredAddress] : []),
    ...(input.cipcRegistrationNumber ? [`CIPC Registration No: ${input.cipcRegistrationNumber}`] : []),
  ];
}
