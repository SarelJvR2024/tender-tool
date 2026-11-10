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

const CLOSING_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOSING_TIME_RE = /^\d{2}:\d{2}$/;

export type ManualTenderClosing = { closing: string | null } | { error: string };

/**
 * South African tenders close at a stated SAST time; store it with the
 * +02:00 offset so "days left" and expiry-at-closing checks are right
 * (same reasoning as the no-assumed-time fix, Form-Field-Audit 2026-10-18 -
 * the form used to pre-fill 12:00 and silently fall back to it on a bare
 * date, which this function still rejects below).
 *
 * Requires BOTH a date and a time, or neither - previously only the
 * date-without-time direction was checked (the 2026-10-18 audit); a closing
 * TIME typed with no closing DATE was never validated at all and fell
 * straight through registerManualTender()'s own `if (input.closingDate)`
 * guard with no error, silently discarding the typed time and loading the
 * tender with no closing date whatsoever (QA pass, 2026-11-09, standing
 * review). Both directions of the partial-input pair are now rejected here,
 * in one place, so the client form and the server action can't drift apart
 * on which half they each check.
 */
export function parseManualTenderClosing(date: string, time: string): ManualTenderClosing {
  if (!date && !time) return { closing: null };
  if (date && !time) {
    return { error: "Enter the closing time from the tender notice too (or leave the closing date blank)." };
  }
  if (time && !date) {
    return { error: "Enter the closing date too (or leave the closing time blank)." };
  }
  if (!CLOSING_DATE_RE.test(date)) return { error: "Closing date isn't a valid date." };
  if (!CLOSING_TIME_RE.test(time)) {
    return { error: "Enter the closing time from the tender notice (or leave the closing date blank too)." };
  }
  return { closing: `${date}T${time}:00+02:00` };
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
  // The tender's own tender-box delivery address (engine/intake/classify_tender.py's
  // find_delivery_address(), SANRAL route only) - read from the Tender Notice,
  // printed by engine/make_envelope_covers.py's own envelope covers. Missing
  // from this type until Finding 353 even though process_general_jobs.py has
  // written it since 2026-10-18 - the gap that let every real caller of this
  // type (including cover-page-preview.tsx) silently never read it.
  delivery_address?: { lines: string[]; quote: string; ambiguous: boolean };
};
