"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SLUG_RE } from "@/lib/disciplineTaxonomy";
import { sanitizePreferredBuyers } from "@/lib/opportunityBuyerMatch";

/**
 * Tenant check, same pattern as app/app/tenders/[id]/actions.ts's own
 * requireCompanyId (which notes every actions.ts file in this app keeps its
 * own copy rather than a shared lib) - not a substitute for RLS
 * (company_tender_preferences' own is_company_member policies, migration
 * 0088), an extra belt-and-braces server-side check every mutating action
 * in this app makes regardless of what RLS would already block.
 */
async function requireCompanyId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/onboarding");
  return membership.company_id as string;
}

/**
 * Saves this company's real Opportunity preferences (migration 0088,
 * company_tender_preferences) - the real version of
 * OpportunityPreferencesPanel.tsx, replacing its earlier localStorage-only
 * preview (lib/opportunityPreferencesPreview.ts, now removed). One row per
 * company (company_id is the primary key), upserted - never multiple rows.
 *
 * hideSanralBoard gates app/app/pipeline/page.tsx's shared "found" column
 * (every open SANRAL-conventional tender from the un-tenant-scoped `tenders`
 * table, shown to every company by default today - see that file's own
 * renderPipeline() comment); interestedDisciplines and preferredBuyers both
 * feed app/app/discovery/page.tsx's own additive match/deprioritize logic
 * (lib/opportunityDisciplineMatch.ts / lib/opportunityBuyerMatch.ts).
 * Neither this action nor either page ever changes what the scoring engine
 * itself computes (discovered_opportunities.verdict) - this is a UI-level
 * filter/sort only, same distinction the table's own comment draws.
 *
 * Invoked directly from the client panel (useTransition, not a <form>
 * action) - same "no FormData, no companyId argument, called straight from
 * an onChange/onClick" shape as task-status-button.tsx's advanceTaskStatus
 * and task-assignee-select.tsx's reassignTenderTask. companyId is never
 * taken from the client: requireCompanyId() above derives it itself from
 * the signed-in user's own company_members row, so there is nothing a
 * crafted client call could spoof.
 */
export async function setOpportunityPreferences(
  hideSanralBoard: boolean,
  interestedDisciplines: string[],
  preferredBuyers: string[] = [],
) {
  const companyId = await requireCompanyId();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Never trust the client's array blindly, even though the panel only ever
  // sends slugs off lib/disciplineTaxonomy.ts's own taxonomyGroups() - same
  // "degrade, don't throw, don't pass through garbage" discipline the old
  // preview store's sanitizePreferences() used. SLUG_RE is the same shape
  // 0040's own discipline_categories.slug and taxonomy.py's SLUG_RE use.
  const disciplines = Array.from(
    new Set((interestedDisciplines ?? []).filter((d): d is string => typeof d === "string" && SLUG_RE.test(d))),
  );
  // preferredBuyers has no fixed taxonomy to validate against (buyer names
  // aren't normalised anywhere in this schema) - sanitizePreferredBuyers()
  // caps shape (trim, length, count, dedupe) instead of a slug check.
  const buyers = sanitizePreferredBuyers(preferredBuyers);

  const { error } = await supabase.from("company_tender_preferences").upsert(
    {
      company_id: companyId,
      hide_sanral_board: hideSanralBoard === true,
      interested_disciplines: disciplines,
      preferred_buyers: buyers,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: "company_id" },
  );

  if (error) {
    console.error("company_tender_preferences upsert failed", error);
    return { ok: false as const, error: "Could not save your opportunity preferences - try again. If it keeps happening, let us know." };
  }

  // Only /pipeline, and only revalidated here - not every write needs to
  // force a fresh render. Real finding, 2026-10-29 (Sarel: "opportunity
  // preferences are taking very long to save when clicking on any"):
  // revalidatePath("/discovery") used to run unconditionally on every single
  // chip/checkbox click, forcing discovery/page.tsx's renderDiscovery() to
  // redo its full, deliberately-heavy pipeline (8 parallel queries, N+1
  // listing-change/scope lookups, up to MAX_PRICING_LOOKUPS=40 market-pricing
  // lookups) before the click could visually resolve - exactly what made
  // every toggle feel like it "took forever". interested_disciplines only
  // ever re-SORTS rows that page already fetched (matchesInterestedDisciplines(),
  // never a WHERE clause) - see this file's own header comment - so there is
  // nothing there that genuinely needs a synchronous refetch; the panel's own
  // optimistic local state already shows the new chip state instantly, and
  // the next natural /discovery load picks up the new sort order for free.
  // hide_sanral_board is different: pipeline/page.tsx's renderPipeline()
  // actually filters its "found" column by this value (a real WHERE-adjacent
  // branch, not just a sort), so that page's own cache genuinely needs
  // invalidating - and renderPipeline() isn't the expensive one.
  revalidatePath("/pipeline");
  return { ok: true as const };
}
