// Manual tender load (migration 0024): shared constants/types for the
// /tenders/new form, its server actions, and the Tender Workspace intake card.
//
// Files go straight from the browser into the 'tender-documents' bucket under
// manual/<company_id>/<tender_id>/ - NOT through a Server Action, whose body
// is capped at 4.5 MB on Vercel (next.config.ts). A SANRAL set alone is two
// ~2 MB workbooks plus Book 1/2 PDFs. 0024's storage policy lets a member write
// only under their own company's manual/ prefix.

export const TENDER_DOCS_BUCKET = "tender-documents";

// Supabase Storage's default per-file limit on the standard upload path.
export const MAX_TENDER_FILE_BYTES = 50 * 1024 * 1024;

// What the engines can read (engine/general/requirements.py collect_documents /
// read_document, engine/intake/classify_tender.py for .xlsm/.xlsx).
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".xlsm", ".xlsx", ".zip", ".txt"];

export type UploadedTenderDocument = { title: string; storage_path: string };

export function manualPrefix(companyId: string, tenderId: string): string {
  return `manual/${companyId}/${tenderId}/`;
}

/**
 * A company's own documents for a SHARED tender (one Discovery found) -
 * migration 0032, tender_private_documents. Same bucket, a company-owned
 * prefix: only that company's members can write, read or remove under it.
 */
export function privatePrefix(companyId: string, tenderId: string): string {
  return `private/${companyId}/${tenderId}/`;
}

export { safeFileName } from "./safeFileName.ts";

export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// tenders.intake (written by engine/general/process_general_jobs.py's intake step).
export type TenderIntake = {
  route: "sanral" | "general";
  family: string;
  signal: string;
  sanral_hint: boolean;
  workbooks: { document: string; kind: string; family: string | null; error: string | null }[];
  sanral_documents: { doc_type: string; label: string; document: string }[];
  notes: string[];
  readable_documents: number;
  unreadable_documents: { document: string; reason: string }[];
  analysed_at: string;
  setup?: {
    contract_no: string | null;
    closing_date: string | null;
    positions: { code: string; description: string | null; managerial: boolean; has_alternate: boolean }[];
  };
  fingerprint?: { status: "ok" | "mismatch" | "no_baseline" | "error"; detail: string; changes: string[] };
};
