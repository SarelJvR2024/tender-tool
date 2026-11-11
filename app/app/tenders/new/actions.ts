"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TENDER_DOCS_BUCKET, manualPrefix, parseManualTenderClosing, privatePrefix, type UploadedTenderDocument } from "@/lib/manualTender";
import { GENERAL_ENGINE, JOBS_TABLE } from "@/lib/generalTender";

/**
 * Manual tender load (migration 0024). The browser has already put the files
 * in Storage (tender-documents/manual/<company>/<tender>/ - 0024's policy
 * only lets a member write under their own company's prefix); this action
 * only creates the tender via load_manual_tender(), which re-checks every
 * path, creates the private tenders row + this company's tender_pack, and
 * queues the intake job (engine/general/process_general_jobs.py: SANRAL vs.
 * general routing, requirements, fit). On any refusal the uploaded files are
 * removed again so nothing is left orphaned.
 */

type Result = { error: string } | undefined;

async function requireMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new Error("Couldn't verify your company - try again.");
  if (!membership) redirect("/onboarding");
  return { supabase, companyId: membership.company_id as string, userId: user.id };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanDocuments(docs: UploadedTenderDocument[], prefix: string): UploadedTenderDocument[] | null {
  if (!Array.isArray(docs) || docs.length === 0) return null;
  const out: UploadedTenderDocument[] = [];
  for (const d of docs) {
    if (typeof d?.storage_path !== "string" || !d.storage_path.startsWith(prefix) || d.storage_path.includes("..")) return null;
    out.push({ title: String(d.title ?? "").slice(0, 200), storage_path: d.storage_path });
  }
  return out;
}

// Finding 391 (standing QA/robustness review, 2026-11-11): cleanDocuments()
// rejects the WHOLE batch (returns null) the moment any ONE entry's path is
// invalid - but the browser has already put every file in Storage before
// calling this action (this file's own header comment), so a batch with one
// bad entry alongside otherwise-genuinely-uploaded files left those real
// files orphaned in Storage forever: never recorded in the DB, never
// cleaned up. registerManualTender() already closed this exact gap for
// itself (2026-11-09, its own inline comment: "Every refusal here now
// cleans up the already-uploaded documents") by filtering the RAW input for
// real, prefix-matching paths rather than trusting cleanDocuments()'s own
// all-or-nothing output - but that fix was never swept to this file's other
// two upload actions, addManualTenderDocuments()/addPrivateTenderDocuments(),
// which had no cleanup at all on a rejected batch. Shared here so the same
// discipline applies uniformly, including on an RPC/insert failure (not
// just a no-docs refusal).
async function cleanupUploadedPaths(supabase: Awaited<ReturnType<typeof createClient>>, documents: UploadedTenderDocument[] | null | undefined, prefix: string): Promise<void> {
  const paths = (documents ?? []).map((d) => d?.storage_path).filter((p): p is string => typeof p === "string" && p.startsWith(prefix));
  if (paths.length > 0) await supabase.storage.from(TENDER_DOCS_BUCKET).remove(paths);
}

export async function registerManualTender(input: {
  tenderId: string;
  title: string;
  buyer: string;
  reference: string;
  ocid: string;
  closingDate: string; // yyyy-mm-dd, may be empty
  closingTime: string; // HH:MM, may be empty
  documents: UploadedTenderDocument[];
}): Promise<Result> {
  const { supabase, companyId } = await requireMember();
  if (!UUID_RE.test(input.tenderId)) return { error: "Invalid upload - start again." };
  const prefix = manualPrefix(companyId, input.tenderId);
  const docs = cleanDocuments(input.documents, prefix);
  const cleanup = () => cleanupUploadedPaths(supabase, input.documents, prefix);
  if (!docs) {
    await cleanup();
    return { error: "Upload at least one of the tender's own documents." };
  }
  // South African tenders close at a stated SAST time; store it with the
  // +02:00 offset so "days left" and expiry-at-closing checks are right.
  // parseManualTenderClosing() also catches the closing-TIME-with-no-
  // closing-DATE direction (previously silently dropped with no error -
  // QA pass, 2026-11-09) - see its own header comment. Every refusal here
  // now cleans up the already-uploaded documents, same as every other
  // refusal in this function: a malformed closingDate used to return
  // early WITHOUT calling cleanup(), directly contradicting this file's
  // own "On any refusal the uploaded files are removed again so nothing
  // is left orphaned" promise above - confirmed live (storage.remove was
  // never called on that one path) before this fix.
  const closingResult = parseManualTenderClosing(input.closingDate, input.closingTime);
  if ("error" in closingResult) {
    await cleanup();
    return { error: closingResult.error };
  }
  const closing = closingResult.closing;

  const { data, error } = await supabase.rpc("load_manual_tender", {
    p_company_id: companyId,
    p_tender_id: input.tenderId,
    p_title: input.title.trim().slice(0, 300),
    p_buyer: input.buyer.trim().slice(0, 200),
    p_reference: input.reference.trim().slice(0, 100) || null,
    p_ocid: input.ocid.trim().slice(0, 200) || null,
    p_closing_date: closing,
    p_documents: docs,
  });
  if (error || !data) {
    if (error) console.error("load_manual_tender rpc failed", error);
    await cleanup();
    return { error: error ? "Could not load this tender - try again. If it keeps happening, let us know." : "Could not load this tender." };
  }
  revalidatePath("/dashboard");
  redirect(`/tenders/${input.tenderId}#intake`);
}

/** More documents for a manually loaded tender (e.g. the SANRAL workbook that was missing) + a fresh intake. */
export async function addManualTenderDocuments(input: { tenderId: string; documents: UploadedTenderDocument[] }): Promise<Result> {
  const { supabase, companyId } = await requireMember();
  if (!UUID_RE.test(input.tenderId)) return { error: "Unknown tender." };
  const prefix = manualPrefix(companyId, input.tenderId);
  const docs = cleanDocuments(input.documents, prefix);
  if (!docs) {
    await cleanupUploadedPaths(supabase, input.documents, prefix);
    return { error: "Choose at least one document." };
  }
  const { error } = await supabase.rpc("add_manual_tender_documents", { p_tender_id: input.tenderId, p_documents: docs });
  if (error) {
    console.error("add_manual_tender_documents rpc failed", error);
    await cleanupUploadedPaths(supabase, input.documents, prefix);
    return { error: "Could not add these documents - try again. If it keeps happening, let us know." };
  }
  revalidatePath(`/tenders/${input.tenderId}`);
  redirect(`/tenders/${input.tenderId}?saved=intake#intake`);
}

/**
 * Private documents on a SHARED tender (migration 0032). The browser already
 * put the files under tender-documents/private/<company>/<tender>/; this
 * records them in tender_private_documents (RLS: own company, a shared
 * tender it has a pack for, path under its own prefix - also a CHECK
 * constraint) and queues a fresh read of the tender. The bridge reads the
 * published documents plus these, and writes the result to this company's
 * tender_packs row only - never to the shared tender.
 */
export async function addPrivateTenderDocuments(input: { tenderId: string; documents: UploadedTenderDocument[] }): Promise<Result> {
  const { supabase, companyId, userId } = await requireMember();
  if (!UUID_RE.test(input.tenderId)) return { error: "Unknown tender." };
  const prefix = privatePrefix(companyId, input.tenderId);
  const docs = cleanDocuments(input.documents, prefix);
  const cleanup = () => cleanupUploadedPaths(supabase, input.documents, prefix);
  if (!docs) {
    await cleanup();
    return { error: "Choose at least one document." };
  }

  const { data: pack } = await supabase.from("tender_packs").select("id").eq("tender_id", input.tenderId).eq("company_id", companyId).maybeSingle();
  if (!pack) {
    await cleanup();
    return { error: "Start working on this tender first (Prepare this tender), then add your documents." };
  }
  const { error } = await supabase.from("tender_private_documents").insert(
    docs.map((d) => ({ company_id: companyId, tender_id: input.tenderId, title: d.title || "document", storage_path: d.storage_path, original_filename: d.title, uploaded_by: userId })),
  );
  if (error) {
    console.error("tender_private_documents insert failed", error);
    await cleanup();
    return { error: "Could not add your documents - try again. If it keeps happening, let us know." };
  }
  const { error: jobErr } = await supabase.from(JOBS_TABLE).insert({
    engine: GENERAL_ENGINE,
    company_id: companyId,
    tender_id: input.tenderId,
    tender_pack_id: pack.id as string,
    kind: "extract_requirements",
    requested_by: userId,
  });
  // 23505: a read is already queued - it will pick these documents up.
  if (jobErr && jobErr.code !== "23505") {
    console.error("extract_requirements job insert failed", jobErr);
    return { error: "Documents saved, but the read could not be queued - try again. If it keeps happening, let us know." };
  }
  revalidatePath(`/tenders/${input.tenderId}`);
  redirect(`/tenders/${input.tenderId}?saved=extract#private-documents`);
}
