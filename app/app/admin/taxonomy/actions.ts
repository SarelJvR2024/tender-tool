"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SLUG_RE, splitKeywords } from "@/lib/disciplineTaxonomy";

/**
 * The shared discipline list (0040 discipline_categories) edited in the app
 * instead of only with engine/discovery/taxonomy.py add / SQL (audit O2,
 * Sarel 2026-10-17). Only a platform admin (0043 platform_admins) can write -
 * RLS enforces it; checked here too for a clear message, since a Server
 * Action is reachable by direct POST. The same rules as the CLI: slug format,
 * two levels (the 0040 trigger), never deleted (retire with active = false).
 */
const PAGE = "/admin/taxonomy";
const back = (msg: string, kind: "error" | "saved" = "error"): never => redirect(`${PAGE}?${kind}=${encodeURIComponent(msg)}`);

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: isAdmin, error } = await supabase.rpc("is_platform_admin");
  if (error) back(`Could not check admin rights: ${error.message}`);
  if (!isAdmin) back("Only a Tender Tool platform admin can change the shared discipline list.");
  return { supabase, user };
}

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addCategory(formData: FormData) {
  const { supabase } = await requireAdmin();
  const slug = text(formData, "slug").toLowerCase();
  const label = text(formData, "label");
  const parent = text(formData, "parent_slug") || null;
  if (!SLUG_RE.test(slug)) back(`"${slug}" isn't a valid slug - lower-case letters, digits and _ , starting with a letter.`);
  if (!label) back("A category needs a label.");
  const { data: last } = await supabase.from("discipline_categories").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const sortOrder = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;
  const { error } = await supabase.from("discipline_categories").insert({
    slug,
    label,
    parent_slug: parent,
    sort_order: sortOrder,
    keywords: splitKeywords(text(formData, "keywords")),
    exclude_keywords: splitKeywords(text(formData, "exclude_keywords")),
    etenders_categories: splitKeywords(text(formData, "etenders_categories"), "\n"),
    added_from: `added in /admin/taxonomy${text(formData, "note") ? ` - ${text(formData, "note")}` : ""}`,
  });
  if (error) back(error.code === "23505" ? `${slug} is already on the list.` : error.message);
  revalidatePath(PAGE);
  back(`Added ${label} (${slug}). Discovery uses it from its next run.`, "saved");
}

export async function updateCategory(formData: FormData) {
  const { supabase } = await requireAdmin();
  const slug = text(formData, "slug");
  const label = text(formData, "label");
  if (!label) back("A category needs a label.");
  const { data, error } = await supabase
    .from("discipline_categories")
    .update({
      label,
      parent_slug: text(formData, "parent_slug") || null,
      keywords: splitKeywords(text(formData, "keywords")),
      exclude_keywords: splitKeywords(text(formData, "exclude_keywords")),
      etenders_categories: splitKeywords(text(formData, "etenders_categories"), "\n"),
      active: formData.get("active") === "on",
      // 0058: whether a company tagged with the whole group counts as doing it
      matched_by_group_tag: formData.get("matched_by_group_tag") === "on",
    })
    .eq("slug", slug)
    .select("slug");
  if (error) back(error.message);
  if (!data || data.length === 0) back(`${slug} wasn't updated - not found, or not allowed.`);
  revalidatePath(PAGE);
  back(`Saved ${label} (${slug}).`, "saved");
}

export async function approveSuggestion(formData: FormData) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc("approve_discipline_suggestion", {
    p_suggestion_id: text(formData, "id"),
    p_label: text(formData, "label"),
    p_parent_slug: text(formData, "parent_slug") || null,
    p_keywords: splitKeywords(text(formData, "keywords")),
    p_exclude_keywords: splitKeywords(text(formData, "exclude_keywords")),
    p_review_note: text(formData, "review_note") || null,
  });
  if (error) back(error.message);
  revalidatePath(PAGE);
  back(`Approved: ${data} is now on the shared list (the suggesting company's tagged items are listed under it with no change).`, "saved");
}

export async function rejectSuggestion(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const note = text(formData, "review_note");
  const { data, error } = await supabase
    .from("discipline_category_suggestions")
    .update({ status: "rejected", reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_note: note || null })
    .eq("id", text(formData, "id"))
    .eq("status", "pending")
    .select("slug");
  if (error) back(error.message);
  if (!data || data.length === 0) back("That suggestion is no longer pending.");
  revalidatePath(PAGE);
  back(`Rejected the suggestion "${data![0].slug}".`, "saved");
}
