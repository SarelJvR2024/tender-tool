// Plain data module - deliberately NOT inside quick-blocker-drawer.tsx's own
// "use client" file. A server component (compliance-report.tsx) needs to
// read VAULT_DRAWER_CONFIG directly to decide which Fix/Provide rows get
// the drawer vs the plain Link; a "use client" module's exports are not a
// safe way to hand a server component a plain data object across that
// boundary (confirmed directly: VAULT_DRAWER_CONFIG[item.key] came back
// undefined every time on the deployed preview when it lived in the client
// file, even though the config itself was correct - moved here instead of
// guessed at). quick-blocker-drawer.tsx imports its own shape from here too,
// so there's exactly one definition either side of the boundary uses.

export type QuickFixFieldSpec =
  | { kind: "text"; name: string; label: string; placeholder?: string }
  | { kind: "date"; name: string; label: string }
  | { kind: "number"; name: string; label: string; min?: number; step?: number };

/**
 * One compliance blocker's own quick-fix shape - "Quick Blocker Resolver"
 * (Sarel's own Batch 3 brief, 2026-10-24). Deliberately narrow: plain-text/
 * number/date company fields get an instant single-field form; a backing
 * document, when the item has one, gets ONE dropzone for that one expected
 * kind - never the full multi-file bulk-extraction/OCR review UI (that
 * stays a deliberate, separate "Open in Company Vault" link). For the 6
 * vault kinds the AI document-scan pipeline classifies (every kind except
 * COID), upload here still goes through that same real classification step
 * before anything is marked resolved - spec v3 §4/§17's own anti-overwrite
 * rule ("a new document must NOT silently overwrite verified company or
 * person information") applies here exactly as it does on /company; this
 * drawer does not get a shortcut around it.
 */
export type QuickFixConfig = {
  key: string;
  title: string;
  fields: QuickFixFieldSpec[];
  documentKind: "coid" | "cidb" | "sars_tcs_pin" | "pi_insurance" | "iso_9001" | "bank_letter" | "bee_proof" | null;
  documentLabel: string | null;
  /** true = goes through AI classify + the /company/document-scan review step before it's really resolved. false (COID only) = direct write, instantly resolved. */
  aiClassified: boolean;
};

// Per-compliance-key drawer shape, built from each field's own real column
// on `companies` (lib/tenderCompliance.ts's CompanyVault / COMPANY_VAULT_COLUMNS)
// - verified directly against lib/companyProfileUpdate.ts's own field
// whitelist and lib/vaultDocuments.ts's own VAULT_DOCUMENTS/
// VAULT_KIND_TO_DOCUMENT_KIND, not assumed. Keyed by bid-task-status.ts's
// own ComplianceItem.key - only the keys that actually resolve to a real
// company vault shape get an entry; every other key (authority, past
// performance, briefing, hours, form_of_offer, declarations, ...) keeps its
// existing plain Link to /company, unchanged - CIDB (a document-only vault
// kind with no matching FIX_HREF_FOR_KEY entry at all) is left out for the
// same reason: there is nothing real yet to route it to from here.
export const VAULT_DRAWER_CONFIG: Record<string, QuickFixConfig> = {
  csd: {
    key: "csd",
    title: "CSD supplier number",
    fields: [{ kind: "text", name: "csd_supplier_number", label: "CSD supplier number" }],
    documentKind: null,
    documentLabel: null,
    aiClassified: false,
  },
  tax: {
    key: "tax",
    title: "SARS Tax Compliance Status",
    fields: [
      { kind: "text", name: "sars_tcs_pin", label: "SARS Tax Compliance PIN" },
      { kind: "date", name: "sars_tcs_pin_expiry", label: "Expiry date" },
    ],
    documentKind: "sars_tcs_pin",
    documentLabel: "SARS Tax Compliance Status PIN letter",
    aiClassified: true,
  },
  insurance: {
    key: "insurance",
    title: "Professional indemnity insurance",
    fields: [
      { kind: "text", name: "pi_insurance_insurer", label: "Insurer" },
      { kind: "text", name: "pi_insurance_policy_number", label: "Policy number" },
      { kind: "number", name: "pi_insurance_cover_zar", label: "Cover amount (R)", min: 0 },
      { kind: "date", name: "pi_insurance_expiry", label: "Expiry date" },
    ],
    documentKind: "pi_insurance",
    documentLabel: "Professional indemnity insurance schedule",
    aiClassified: true,
  },
  quality_system: {
    key: "quality_system",
    title: "ISO 9001 certification",
    fields: [
      { kind: "text", name: "iso_9001_certificate_number", label: "Certificate number" },
      { kind: "date", name: "iso_9001_expiry", label: "Expiry date" },
    ],
    documentKind: "iso_9001",
    documentLabel: "ISO 9001 certificate",
    aiClassified: true,
  },
  coid: {
    key: "coid",
    title: "COID Letter of Good Standing",
    fields: [
      { kind: "text", name: "coid_registration_number", label: "COID registration number" },
      { kind: "text", name: "coid_letter_of_good_standing_number", label: "Letter of Good Standing number" },
      { kind: "date", name: "coid_letter_of_good_standing_expiry", label: "Letter expiry date" },
    ],
    documentKind: "coid",
    documentLabel: "COID Letter of Good Standing",
    aiClassified: false,
  },
  bbbee: {
    key: "bbbee",
    title: "B-BBEE status",
    fields: [
      { kind: "number", name: "bee_level", label: "B-BBEE level", min: 1, step: 1 },
      { kind: "number", name: "black_ownership_pct", label: "Black ownership %", min: 0 },
      { kind: "number", name: "bee_procurement_recognition_pct", label: "Procurement recognition %", min: 0 },
      { kind: "date", name: "bee_proof_expiry", label: "Proof expiry date" },
    ],
    documentKind: "bee_proof",
    documentLabel: "B-BBEE certificate or sworn affidavit",
    aiClassified: true,
  },
  bank: {
    key: "bank",
    title: "Bank details",
    // Deliberately no account number field - lib/companyProfileUpdate.ts's
    // own header comment is explicit: account numbers live only in the
    // restricted bank_accounts table, never on companies. This drawer
    // writes through the same whitelist and must not add one either.
    fields: [
      { kind: "text", name: "bank_name", label: "Bank name" },
      { kind: "text", name: "bank_branch_code", label: "Branch code" },
      { kind: "date", name: "bank_confirmation_letter_date", label: "Confirmation letter date" },
    ],
    documentKind: "bank_letter",
    documentLabel: "Bank confirmation letter",
    aiClassified: true,
  },
};
