// Non-SANRAL ("general") tender preparation on the Tender Workspace.
//
// What THIS tender needs is never assumed from the buyer type: it is read
// from the tender's own documents by engine/general/requirements.py and stored
// on tenders.document_requirements (migration 0018). This module only:
//   - types that manifest (the Python side is the single source of the form /
//     returnable / question catalogue - see requirements.py FORMS, RETURNABLES,
//     QUESTIONS, COMPANY_FIELDS);
//   - resolves each supporting document against what the company already has
//     (the companies vault row, 0001/0014) or uploaded for this tender
//     (tender_answers 'upload:<key>' rows);
//   - says which questions are answered and which still need a human.
// Evidence for every rule: docs/specs/General-Tender-Engine-Findings.md and
// docs/specs/General-Tender-Preparation-Findings.md.

import { formatDate } from "./dates.ts";
import { BEE_PROOF_LABEL, validityAtClosing, type CompanyVault, type ComplianceStatus } from "./tenderCompliance.ts";
import type { EvidenceRule } from "./experienceEvidence";
import type { LocalityRow } from "./locality";
import type { RequiredBody } from "./personCredentials";

export const GENERAL_FAMILY = "General (non-SANRAL)";

export type ManifestForm = {
  code: string; // "1", "4", "6.1", "8", "9", "3", "7"...
  label: string; // "SBD 4" / "MBD 4"
  title: string;
  // overlay = a flat PDF edition the engine types onto at the labels it finds
  // (engine/general/fill_flat_pdf.py); what didn't place stays by hand
  status: "auto" | "by_hand" | "attach" | "overlay";
  reason: string;
  mentions: number;
  quote: string | null;
  from_ocr?: boolean; // the quote came from OCR'd text (engine/ocr/scan_ocr.py, experimental)
  editions: { document: string; format: string; editable: boolean }[];
  // How strong the regex/heuristic match behind this item was (0-100) -
  // engine/general/requirements.py, not an LLM call (see that module's own
  // comment). Absent on manifests extracted before that work shipped.
  confidence?: number;
  confidence_reason?: string;
};

// EXPERIMENTAL OCR: set on a manifest document when some/all of its text was
// read by OCR from a scan (engine/general/requirements.py ocr_scanned_pages).
export type ManifestOcr = {
  engine: string | null;
  pages_ocr: number[];
  pages_failed: { page: number; reason: string }[];
  pages_skipped: number[];
  mean_confidence: number | null;
  total_pages: number | null;
  notice: string;
};

export type ManifestReturnable = {
  key: string;
  label: string;
  vault: "csd" | "tax" | "bbbee" | "coid" | "cidb" | "bank" | "insurance" | null;
  conditional: string | null;
  strength: "required" | "mentioned";
  mentions: number;
  document: string;
  quote: string;
  from_ocr?: boolean;
  // See ManifestForm.confidence - same meaning, same engine.
  confidence?: number;
  confidence_reason?: string;
};

export type ManifestQuestion = {
  key: string;
  form?: string;
  condition?: string;
  group: string;
  type: "yes_no" | "text" | "person";
  label: string;
  help: string;
  optional?: boolean;
  derived_default?: string;
};

export type ManifestCompanyField = {
  key: string;
  column: "telephone" | "cellphone" | "email" | "cidb_grading";
  label: string;
  help: string;
  optional?: boolean;
};

export type RequirementManifest = {
  version: number;
  extracted_at: string;
  form_suite: "SBD" | "MBD" | null;
  documents: { name: string; format: string; kind: string; forms: string[]; editable: boolean; converted_from_doc: boolean; unreadable: string | null; ocr?: ManifestOcr | null }[];
  forms: ManifestForm[];
  buyer_forms: {
    key: string; label: string; document: string; format: string; reason: string; quote?: string;
    // set when the engine can type the company details onto this form (CIDB
    // Compulsory Enterprise Questionnaire, Form of Offer signatory block)
    overlay?: { code: string; document: string; page: number; fills: string; by_hand: string };
    confidence?: number;
    confidence_reason?: string;
  }[];
  returnables: ManifestReturnable[];
  roles: { role_code: string; mentions: number; document: string; quote: string; from_ocr?: boolean; confidence?: number; confidence_reason?: string }[];
  // Manifest v2 (2026-10-29) - additive. Absent on manifests extracted
  // before this, same convention as document_depth below.
  extracted_roles?: { title: string; min_years: number; qualifications_and_certs: string[]; cover_page: string | null; document: string; quote: string }[];
  mandatory_gates?: { type: "iso_certification" | "mandatory_credential" | "jv_agreement"; label: string; fatal: boolean; cure_days: number | null; quote: string | null }[];
  pricing_schedule?: {
    type: string | null;
    deliverables: { item: number; description: string }[];
    vat_percentage: number | null;
    quote: string | null;
  } | null;
  // 0040 / audit Q5: per-person registrations this tender requires that are
  // not on every person's record (requirements.py find_person_registrations).
  // Absent when the tender doesn't ask - the People page then keeps the
  // SACNASP / SAGC fields out of the way.
  // plus the 0050 catalog bodies SACAP / SACPLAN / SACQSP / SACPVP / PSIRA.
  person_registrations?: { body: RequiredBody; mentions: number; document: string; quote: string; from_ocr?: boolean; confidence?: number; confidence_reason?: string }[];
  // ambiguous (Finding, 2026-10-24, engine/general/requirements.py): more than
  // one different CIDB grading was found across the documents read (e.g. an
  // addendum correcting the original notice) - requirements.py has no
  // reliable signal for which one is the actual, current requirement, so
  // this flags it rather than silently trusting whichever grading happened
  // to be picked. Optional because every manifest written before this field
  // existed has no key for it at all - absent must read the same as false.
  cidb: { grading: string; quote: string; confidence?: number; confidence_reason?: string; ambiguous?: boolean } | null;
  briefing: { compulsory: boolean; quote: string; confidence?: number; confidence_reason?: string } | null;
  scoring: {
    preference_system: { system: string; reason?: string };
    functionality: {
      present?: boolean | null;
      threshold?: number | null;
      reason?: string;
      // Manifest v2 - absent on manifests extracted before this.
      has_sub_minimum?: boolean;
      sub_minimum_rule?: string | null;
      criteria?: { name: string; weight: number }[];
    };
    specific_goal_bases: string[];
  };
  experience_evidence: { source: string; rules: EvidenceRule[] };
  locality: { rows: LocalityRow[]; mandatory_local_office: { area: string; disqualifies: boolean; quote: string } | null };
  questions: ManifestQuestion[];
  company_fields: ManifestCompanyField[];
  gaps: string[];
  // assess_tender.document_depth() over everything read (added 2026-10-17;
  // absent on manifests extracted before then).
  document_depth?: "full_document" | "advert_or_partial" | "no_extractable_text";
};

export type GeneralCompany = CompanyVault & {
  id: string;
  cipc_registration_number: string | null;
  vat_number: string | null;
  postal_address: string | null;
  registered_address: string | null;
  telephone: string | null;
  cellphone: string | null;
  email: string | null;
  cidb_grading: string | null;
};

export const GENERAL_COMPANY_COLUMNS =
  "cipc_registration_number, vat_number, postal_address, registered_address, telephone, cellphone, email, cidb_grading";

export type TenderAnswer = {
  field_key: string;
  value: string | null;
  storage_path: string | null;
  original_filename: string | null;
  updated_at: string;
};

export const UPLOAD_PREFIX = "upload:";

export type ReturnableCheck = {
  key: string;
  label: string;
  status: ComplianceStatus;
  detail: string;
  quote: string;
  from_ocr?: boolean;
  strength: "required" | "mentioned";
  uploadable: boolean; // offer an "upload for this tender" slot
  vaultLink: boolean; // fix it on the Company page instead
  upload: TenderAnswer | null;
  expiring?: boolean;
  /** Passed straight through from the manifest - lets a renderer route a "missing" row to quick-fix-config.ts's own VAULT_DRAWER_CONFIG (the Quick Blocker Resolver drawer), the same lookup compliance-report.tsx's BidTaskRow already does for SANRAL. */
  vault: "csd" | "tax" | "bbbee" | "coid" | "cidb" | "bank" | "insurance" | null;
  /** requirements.py's own regex/heuristic extraction confidence (0-100) for THIS returnable being required at all - never "AI confidence" (general-pack-review.tsx's MatchStrengthBadge comment explains why). About how confidently the requirement text was found, not whether the company's own document satisfies it - so only meaningful alongside "check", never "missing" (see general-workspace.tsx's own use of matchStrengthStatus()). */
  confidence?: number;
  confidenceReason?: string;
};

// Trust Blue standard date format (Phase 2, 2026-10-23) - see tenderCompliance.ts's own fmt().
const fmt = (d: string) => formatDate(d) ?? d;

/**
 * One supporting document against the vault / this tender's uploads.
 * "have" only when there is something real on file that's valid on the
 * closing date; "check" when a fact is on file but the copy to attach isn't;
 * "missing" when nothing is.
 */
export function checkReturnable(
  r: ManifestReturnable,
  c: GeneralCompany | null,
  closingDate: string | null,
  answers: TenderAnswer[],
  biddingAsJv: boolean | null,
): ReturnableCheck {
  const upload = answers.find((a) => a.field_key === UPLOAD_PREFIX + r.key && a.storage_path) ?? null;
  const base = { key: r.key, label: r.label, quote: r.quote, from_ocr: r.from_ocr, strength: r.strength, upload, vault: r.vault, confidence: r.confidence, confidenceReason: r.confidence_reason };
  const uploaded = upload ? ` Uploaded for this tender: ${upload.original_filename}.` : "";

  if (r.conditional === "jv" && biddingAsJv === false) {
    return { ...base, status: "have", detail: "Not bidding as a joint venture - not needed.", uploadable: false, vaultLink: false };
  }

  switch (r.vault) {
    case "csd":
      if (!c?.csd_supplier_number) {
        return { ...base, status: "missing", detail: "No CSD supplier number on file - register on the CSD and add the number on the Company page.", uploadable: true, vaultLink: true };
      }
      return upload
        ? { ...base, status: "have", detail: `CSD number ${c.csd_supplier_number} on file.${uploaded}`, uploadable: true, vaultLink: false }
        : { ...base, status: "check", detail: `CSD number ${c.csd_supplier_number} on file. Attach a current CSD summary report for this tender.`, uploadable: true, vaultLink: false };
    case "tax": {
      if (!c?.sars_tcs_pin) return { ...base, status: "missing", detail: "No SARS TCS PIN in the vault.", uploadable: true, vaultLink: true };
      if (!c.sars_tcs_pin_expiry) return { ...base, status: "check", detail: `PIN ${c.sars_tcs_pin} on file but no expiry - add it on the Company page.`, uploadable: true, vaultLink: true };
      const v = validityAtClosing(c.sars_tcs_pin_expiry, closingDate);
      const hasCopy = !!c.sars_tcs_pin_document_path || !!upload;
      return { ...base, status: v.status === "have" && !hasCopy ? "check" : v.status, expiring: v.expiring, detail: `PIN ${c.sars_tcs_pin} ${v.text}.${hasCopy ? (upload ? uploaded : " PIN letter in the vault.") : " Upload the PIN letter (vault or this tender) so it goes into the pack."}`, uploadable: !c.sars_tcs_pin_document_path, vaultLink: !c.sars_tcs_pin_document_path };
    }
    case "bbbee": {
      if (!c?.bee_level || !c.bee_proof_type) {
        return { ...base, status: c?.bee_level ? "check" : "missing", detail: c?.bee_level ? `Level ${c.bee_level} on file, but not which proof backs it - record it on the Company page.` : "No B-BBEE level on file - preference points for B-BBEE would be 0.", uploadable: false, vaultLink: true };
      }
      if (!c.bee_proof_expiry) return { ...base, status: "check", detail: `${BEE_PROOF_LABEL[c.bee_proof_type]} on file but no expiry date.`, uploadable: false, vaultLink: true };
      const v = validityAtClosing(c.bee_proof_expiry, closingDate);
      return { ...base, status: v.status === "have" && !c.bee_proof_document_path ? "check" : v.status, expiring: v.expiring, detail: `Level ${c.bee_level}, ${BEE_PROOF_LABEL[c.bee_proof_type]} ${v.text}.${c.bee_proof_document_path ? "" : " Upload the copy to the vault so it goes into the pack."}`, uploadable: false, vaultLink: !c.bee_proof_document_path };
    }
    case "coid": {
      const exp = c?.coid_letter_of_good_standing_expiry ?? null;
      if (!c?.coid_letter_of_good_standing_number && !exp) return { ...base, status: "missing", detail: "No COID Letter of Good Standing on file.", uploadable: false, vaultLink: true };
      if (!exp) return { ...base, status: "check", detail: "COID letter on file but no expiry date.", uploadable: false, vaultLink: true };
      const v = validityAtClosing(exp, closingDate);
      return { ...base, status: v.status === "have" && !c?.coid_letter_document_path ? "check" : v.status, expiring: v.expiring, detail: `COID letter ${v.text}.${c?.coid_letter_document_path ? "" : " Upload the copy to the vault so it goes into the pack."}`, uploadable: false, vaultLink: !c?.coid_letter_document_path };
    }
    case "bank": {
      if (!c?.bank_confirmation_letter_valid_until) return { ...base, status: "missing", detail: "No bank confirmation letter date on file.", uploadable: false, vaultLink: true };
      const v = validityAtClosing(c.bank_confirmation_letter_valid_until, closingDate, 30);
      return { ...base, status: v.status === "have" && !c.bank_confirmation_letter_path ? "check" : v.status, expiring: v.expiring, detail: `Letter dated ${fmt(c.bank_confirmation_letter_date as string)}${v.status === "have" ? `, usable at closing (${v.text})` : " - older than 3 months by closing; get a fresh one"}.`, uploadable: false, vaultLink: true };
    }
    case "insurance": {
      if (!c?.pi_insurance_expiry) return { ...base, status: "missing", detail: "No professional indemnity policy period on file.", uploadable: false, vaultLink: true };
      const v = validityAtClosing(c.pi_insurance_expiry, closingDate);
      return { ...base, status: v.status === "have" && !c.pi_insurance_document_path ? "check" : v.status, expiring: v.expiring, detail: `Policy ${c.pi_insurance_policy_number ?? ""} ${v.text}.`, uploadable: false, vaultLink: !c.pi_insurance_document_path };
    }
    case "cidb":
      return c?.cidb_grading
        ? { ...base, status: upload ? "have" : "check", detail: `CIDB grading ${c.cidb_grading} on file.${uploaded || " Attach the CIDB registration certificate for this tender."}`, uploadable: true, vaultLink: false }
        : { ...base, status: "missing", detail: "No CIDB grading recorded - answer the CIDB question below (leave blank if you have none).", uploadable: true, vaultLink: false };
    default:
      return upload
        ? { ...base, status: "have", detail: `Uploaded for this tender: ${upload.original_filename}.`, uploadable: true, vaultLink: false }
        : { ...base, status: r.strength === "required" ? "missing" : "check", detail: r.strength === "required" ? "Not in the vault - upload a copy for this tender." : "Mentioned in the documents - check whether it applies, and upload it if so.", uploadable: true, vaultLink: false };
  }
}

export type QuestionState = {
  q: ManifestQuestion;
  value: string | null;
  answered: boolean;
  defaultValue: string | null; // pre-selection shown when not answered yet
};

export function questionStates(questions: ManifestQuestion[], answers: TenderAnswer[], company: GeneralCompany | null): QuestionState[] {
  return questions.map((q) => {
    const a = answers.find((x) => x.field_key === q.key);
    const value = a?.value ?? null;
    let defaultValue: string | null = null;
    if (q.derived_default && q.key === "sbd1.foreign_based" && company?.cipc_registration_number) defaultValue = q.derived_default;
    return { q, value, answered: value !== null && value !== "", defaultValue };
  });
}

export function companyFieldStates(fields: ManifestCompanyField[], company: GeneralCompany | null) {
  return fields.map((f) => {
    const value = (company?.[f.column] as string | null | undefined) ?? null;
    return { f, value, answered: !!value };
  });
}

// Tailwind classes, not hex - confirmed single real code consumer
// (general-workspace.tsx; submission-plan-logic.ts/.spec.ts only mention
// this export in comments), so safe to convert directly (design-system
// color migration, batch 4, app/AGENTS.md).
export const FORM_STATUS_STYLE: Record<ManifestForm["status"], { label: string; className: string }> = {
  auto: { label: "Filled for you", className: "bg-success/10 text-success" },
  attach: { label: "From the vault", className: "bg-success/10 text-success" },
  by_hand: { label: "Complete by hand", className: "bg-warning/10 text-warning" },
  overlay: { label: "Typed onto the PDF", className: "bg-success/10 text-success" },
};

export type EngineJob = {
  id: string;
  kind: "extract_requirements" | "generate_pack";
  status: "requested" | "generating" | "ready" | "failed";
  storage_path_pdf: string | null;
  output_files: Record<string, string>;
  page_count: number | null;
  manifest: {
    sections?: { title: string; envelope: string; start_page: number; end_page: number }[];
    omitted?: { title: string; envelope: string; reason: string }[];
    by_hand?: { title: string; reason: string }[];
    provenance_summary?: Record<string, number>;
    // Every document + its status (engine/pack/pdf_merge.py) - pack-checklist.tsx.
    checklist?: { no: number; title: string; envelope: string; status: "included" | "included_warning" | "not_included"; pages: string | null; note: string | null }[];
  } | null;
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
};

export const JOB_COLUMNS = "id, kind, status, storage_path_pdf, output_files, page_count, manifest, error_message, requested_at, completed_at";

export const JOB_STATUS_STYLE: Record<EngineJob["status"], { label: string; bg: string; color: string }> = {
  requested: { label: "Queued", bg: "#FEF3C7", color: "#B45309" },
  generating: { label: "Working…", bg: "#FEF3C7", color: "#B45309" },
  ready: { label: "Ready", bg: "#DCFCE7", color: "#15803D" },
  failed: { label: "Failed", bg: "#FEE2E2", color: "#B91C1C" },
};

export const PACK_BUCKET = "submission-packs"; // created by 0017, reused (0018)

// One job queue for every engine (migration 0026): the general engine's jobs
// are pack_generation_jobs rows with engine = 'general'.
export const JOBS_TABLE = "pack_generation_jobs";
export const GENERAL_ENGINE = "general";
