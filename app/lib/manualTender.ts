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

/**
 * Validates a batch of already-uploaded documents against the prefix they
 * must sit under, for registerManualTender()/addManualTenderDocuments()/
 * addPrivateTenderDocuments() (app/tenders/new/actions.ts): every
 * storage_path must start with `prefix` and must not contain a real ".."
 * path-traversal SEGMENT. null means at least one document failed - the
 * whole batch is rejected, never a partial list (its own caller then cleans
 * up every file this batch actually uploaded).
 *
 * ".." is checked as a whole path segment (`storage_path.split("/")`), not
 * as a bare substring: safeFileName() (this module's own re-export) keeps
 * '.' in its allowed character set, so an entirely ordinary document named
 * e.g. "Tender Notice..pdf" produces a storage_path containing the
 * substring ".." without being a traversal attempt at all - a bare
 * substring check used to reject the WHOLE batch for this one, perfectly
 * legitimate file. Finding 35 (2026-10-20) found and fixed the identical
 * false positive in engine/onboarding/process_onboarding_jobs.py's own
 * inline check; this one, and its matching SQL-level checks (migration
 * 0043 tt_own_path(), 0050 tt_path_in_company(), 0045
 * record_tender_document(), 0024 _manual_tender_documents(), 0032
 * tender_private_documents_path), were never swept the same way until the
 * standing review's own 0135 migration. Kept here, not inline in
 * actions.ts, so it can be unit-tested directly - a "use server" file's
 * own exports must all be async Server Actions.
 */
export function cleanDocuments(docs: UploadedTenderDocument[], prefix: string): UploadedTenderDocument[] | null {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const out: UploadedTenderDocument[] = [];
  for (const d of docs) {
    if (typeof d?.storage_path !== "string" || !d.storage_path.startsWith(prefix) || d.storage_path.split("/").includes("..")) return null;
    out.push({ title: String(d.title ?? "").slice(0, 200), storage_path: d.storage_path });
  }
  return out;
}

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
