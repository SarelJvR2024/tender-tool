import { describe, expect, it } from "vitest";
import { returnablesMissingMandatoryItems } from "./returnablesDigestCandidates";
import { GENERAL_FAMILY } from "./generalTender";
import { SANRAL_CONVENTIONAL_FAMILY } from "./tenderCompliance";

/** A minimal Supabase client stub - same shape as complianceDigestCandidates.spec.ts's own stub, extended with a per-table maybeSingle() result map (this file's own queries, unlike that one's, read different maybeSingle() rows from different tables in the same run). */
function stubSupabase(opts: {
  company: Record<string, unknown> | null;
  pack: Record<string, unknown> | null;
  provenance?: Record<string, unknown>[];
  answers?: Record<string, unknown>[];
}) {
  const maybeSingleByTable: Record<string, unknown> = { companies: opts.company, tender_packs: opts.pack };
  const rowsByTable: Record<string, unknown[]> = { field_provenance: opts.provenance ?? [], tender_answers: opts.answers ?? [] };
  return {
    from(table: string) {
      const self: Record<string, unknown> = {
        select: () => self,
        eq: () => self,
        maybeSingle: async () => ({ data: maybeSingleByTable[table] ?? null }),
        then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rowsByTable[table] ?? [] }),
      };
      return self;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("returnablesMissingMandatoryItems - SANRAL Conventional", () => {
  it("reports CSD as missing when no CSD supplier number is on file", async () => {
    const supabase = stubSupabase({ company: { id: "co1", csd_supplier_number: null }, pack: null });
    const result = await returnablesMissingMandatoryItems(supabase, { id: "t1", family: SANRAL_CONVENTIONAL_FAMILY, closing_date: "2026-11-01", document_requirements: null }, "co1");
    expect(result.mapped).toBe(true);
    expect(result.workspaceAnchor).toBe("compliance-check");
    expect(result.missingLabels).toContain("A7 Central Supplier Database (CSD) registration");
  });

  it("CSD and COID satisfied still leaves the Form of Offer outstanding - it always needs a human signature", async () => {
    // sanralConventionalDocumentChecks()'s own C1.1.1 item is "check", never
    // "have", whatever the provenance - confirmed by reading it: status is
    // `fill.status ?? "check"`, and formFillNote() only ever returns null or
    // "check", never "have". A generated Form of Offer always needs signing
    // by hand, so this is real behaviour (the same "Verify: Sign the Form of
    // Offer" the live compliance report always shows too), not a bug.
    const supabase = stubSupabase({
      company: { id: "co1", csd_supplier_number: "CSD123", coid_letter_of_good_standing_number: "COID1", coid_letter_of_good_standing_expiry: "2030-01-01" },
      pack: { id: "pack1" },
      provenance: [],
    });
    const result = await returnablesMissingMandatoryItems(supabase, { id: "t1", family: SANRAL_CONVENTIONAL_FAMILY, closing_date: "2026-11-01", document_requirements: null }, "co1");
    expect(result.mapped).toBe(true);
    expect(result.missingLabels).toEqual(["C1.1.1 Form of Offer, completed and signed"]);
  });
});

describe("returnablesMissingMandatoryItems - General (non-SANRAL)", () => {
  const manifest = {
    returnables: [
      { key: "csd", label: "CSD registration", vault: "csd", conditional: null, strength: "required", mentions: 1, document: "RFQ.pdf", quote: "" },
      { key: "site_visit", label: "Site visit certificate", vault: null, conditional: null, strength: "mentioned", mentions: 1, document: "RFQ.pdf", quote: "" },
    ],
  };

  it("reports the required CSD returnable as missing, but never the merely-mentioned one", async () => {
    const supabase = stubSupabase({ company: { id: "co1", csd_supplier_number: null }, pack: { document_requirements: null } });
    const result = await returnablesMissingMandatoryItems(
      supabase,
      { id: "t1", family: GENERAL_FAMILY, closing_date: "2026-11-01", document_requirements: manifest },
      "co1"
    );
    expect(result.mapped).toBe(true);
    expect(result.workspaceAnchor).toBe("general-documents");
    expect(result.missingLabels).toEqual(["CSD registration"]);
  });

  it("prefers the company's own pack manifest over the shared tender manifest when both exist", async () => {
    // The SHARED manifest asks for a required item the company's OWN
    // (private-document) manifest doesn't carry at all - if the code read
    // the wrong one, that item would wrongly show up as missing.
    const sharedManifest = { returnables: [{ key: "other", label: "Shared-manifest-only required doc", vault: null, conditional: null, strength: "required", mentions: 1, document: "x", quote: "" }] };
    const ownManifest = { returnables: [{ key: "csd", label: "CSD registration", vault: "csd", conditional: null, strength: "required", mentions: 1, document: "x", quote: "" }] };
    const supabase = stubSupabase({
      company: { id: "co1", csd_supplier_number: "CSD123" },
      pack: { document_requirements: ownManifest },
      answers: [{ field_key: "upload:csd", value: null, storage_path: "co1/tenders/t1/csd.pdf", original_filename: "csd.pdf", updated_at: "2026-10-01" }],
    });
    const result = await returnablesMissingMandatoryItems(
      supabase,
      { id: "t1", family: GENERAL_FAMILY, closing_date: "2026-11-01", document_requirements: sharedManifest },
      "co1"
    );
    expect(result.mapped).toBe(true);
    expect(result.missingLabels).toEqual([]); // CSD fully satisfied (number + upload) per the OWN pack manifest; the shared-only item is correctly never read
  });
});

describe("returnablesMissingMandatoryItems - unmapped family", () => {
  it("reports mapped:false rather than guessing at a family with no mandatory-item concept", async () => {
    const supabase = stubSupabase({ company: null, pack: null });
    const result = await returnablesMissingMandatoryItems(supabase, { id: "t1", family: "RRM Consultant Tender", closing_date: "2026-11-01", document_requirements: null }, "co1");
    expect(result.mapped).toBe(false);
    expect(result.missingLabels).toEqual([]);
  });

  it("reports mapped:false for a General-family tender with no manifest extracted yet", async () => {
    const supabase = stubSupabase({ company: { id: "co1" }, pack: { document_requirements: null } });
    const result = await returnablesMissingMandatoryItems(supabase, { id: "t1", family: GENERAL_FAMILY, closing_date: "2026-11-01", document_requirements: null }, "co1");
    expect(result.mapped).toBe(false);
  });
});
