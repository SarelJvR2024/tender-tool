"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TENDER_DOCS_BUCKET, manualPrefix, privatePrefix, type UploadedTenderDocument } from "@/lib/manualTender";
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
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
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
  const cleanup = async () => {
    const paths = (input.documents ?? []).map((d) => d.storage_path).filter((p) => typeof p === "string" && p.startsWith(prefix));
    if (paths.length > 0) await supabase.storage.from(TENDER_DOCS_BUCKET).remove(paths);
  };
  if (!docs) {
    await cleanup();
    return { error: "Upload at least one of the tender's own documents." };
  }
  // South African tenders close at a stated SAST time; store it with the
  // +02:00 offset so "days left" and expiry-at-closing checks are right.
  let closing: string | null = null;
  if (input.closingDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.closingDate)) return { error: "Closing date isn't a valid date." };
    // No assumed time (Form-Field-Audit 2026-10-18): the form used to pre-fill
    // 12:00 and this fell back to it - R.396's closing time, not every
    // tender's (many close at 11:00). The time goes onto the envelope covers
    // and decides "closed" on the closing day, so it must be the notice's own.
    if (!/^\d{2}:\d{2}$/.test(input.closingTime)) {
      await cleanup();
      return { error: "Enter the closing time from the tender notice (or leave the closing date blank too)." };
    }
    closing = `${input.closingDate}T${input.closingTime}:00+02:00`;
  }

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
  if (!docs) return { error: "Choose at least one document." };
  const { error } = await supabase.rpc("add_manual_tender_documents", { p_tender_id: input.tenderId, p_documents: docs });
  if (error) {
    console.error("add_manual_tender_documents rpc failed", error);
    await supabase.storage.from(TENDER_DOCS_BUCKET).remove(docs.map((d) => d.storage_path));
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
  if (!docs) return { error: "Choose at least one document." };
  const cleanup = () => supabase.storage.from(TENDER_DOCS_BUCKET).remove(docs.map((d) => d.storage_path));

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
