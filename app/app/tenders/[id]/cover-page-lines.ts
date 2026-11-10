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
 */
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
  ];
}
