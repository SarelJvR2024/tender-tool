"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { TENDER_DOCS_BUCKET, manualPrefix, type UploadedTenderDocument } from "@/lib/manualTender";

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
  return { supabase, companyId: membership.company_id as string };
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
    const time = /^\d{2}:\d{2}$/.test(input.closingTime) ? input.closingTime : "11:00";
    closing = `${input.closingDate}T${time}:00+02:00`;
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
    await cleanup();
    return { error: error?.message ?? "Could not load this tender." };
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
    await supabase.storage.from(TENDER_DOCS_BUCKET).remove(docs.map((d) => d.storage_path));
    return { error: error.message };
  }
  revalidatePath(`/tenders/${input.tenderId}`);
  redirect(`/tenders/${input.tenderId}?saved=intake#intake`);
}
