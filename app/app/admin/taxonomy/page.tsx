import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { DISCIPLINE_CATEGORY_FULL_COLUMNS, type DisciplineCategoryFull } from "@/lib/disciplineTaxonomy";
import { addCategory, approveSuggestion, rejectSuggestion, updateCategory } from "./actions";

// Per-request (session + RLS), same escape hatch as ../page.tsx.
export const instant = false;

/**
 * The shared discipline list, maintained in the app (audit O2, Sarel
 * 2026-10-17): add and edit categories without CLI access
 * (engine/discovery/taxonomy.py add does the same from a terminal), and
 * review companies' suggestions to promote their own experience tags to the
 * list - never auto-promoted. Reading is open to every signed-in user (0040);
 * writing only to a platform admin (0043 platform_admins).
 *
 * Color-token migration (2026-10-21): was raw inline-CSSProperties
 * throughout, including a bespoke `<style>` media-query block for the
 * 2-column form grids - the media query is now Tailwind's own `sm:grid-cols-*`
 * responsive classes (also fixes a real mobile bug: the old fixed 2/3-column
 * grid only collapsed under 640px, keeping 3 columns in the 390-639px band
 * where the add-category inputs already read as uncomfortably narrow).
 * "amber" (the two add/approve CTAs) -> bg-accent, matching this page's own
 * original distinction between an ordinary per-row "Save" and the two more
 * consequential add-to-the-shared-list actions - not a redesign, the same
 * two-tier button hierarchy the page already had, just blue instead of gold.
 */

type Suggestion = {
  id: string;
  slug: string;
  label: string;
  suggested_parent_slug: string | null;
  note: string | null;
  company_name: string | null;
  example_project_name: string | null;
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const card = "mb-4 rounded-xl border border-border bg-card p-4.5";
const field = "min-h-11 w-full rounded-lg border border-border px-2.5 text-[13px] text-foreground bg-card";
const area = `${field} min-h-[60px] resize-y py-2`;
const label = "mb-1 block text-xs font-semibold text-muted-foreground";
const hint = "mt-1 text-[11px] text-muted-foreground/70";
const primary = "min-h-11 rounded-lg bg-foreground px-4 text-[13px] font-semibold text-white";
const accentBtn = "min-h-11 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-foreground";
const quiet = "min-h-11 rounded-lg border border-destructive/40 bg-card px-4 text-[13px] font-semibold text-destructive";
const sectionTitle = "mb-1 text-[15px] font-bold text-foreground";

function ParentSelect({ groups, value, name = "parent_slug" }: { groups: DisciplineCategoryFull[]; value: string | null; name?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} className={field}>
      <option value="">(none - this is a group)</option>
      {groups.map((g) => (
        <option key={g.slug} value={g.slug}>
          {g.label}
        </option>
      ))}
    </select>
  );
}

function CategoryForm({ c, groups, canEdit }: { c: DisciplineCategoryFull; groups: DisciplineCategoryFull[]; canEdit: boolean }) {
  // A group stays a group (moving one under another would make its own
  // disciplines a third level); a discipline can move between groups.
  return (
    <form action={updateCategory} className="my-1.5 rounded-lg border border-border bg-card p-3">
      <input type="hidden" name="slug" value={c.slug} />
      <fieldset disabled={!canEdit} className="m-0 border-none p-0">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div>
            <label className={label}>Label</label>
            <input name="label" defaultValue={c.label} className={field} required />
          </div>
          <div>
            <label className={label}>Group</label>
            {c.parent_slug ? <ParentSelect groups={groups} value={c.parent_slug} name="parent_slug" /> : (
              <>
                <input type="hidden" name="parent_slug" value="" />
                <div className={`${field} flex items-center text-muted-foreground`}>Top-level group</div>
              </>
            )}
          </div>
        </div>
        <div className="mt-2.5">
          <label className={label}>Keywords (comma-separated)</label>
          <textarea name="keywords" defaultValue={c.keywords.join(", ")} className={area} />
          <div className={hint}>Matched in a tender&apos;s title and description: whole words, a trailing * = any ending, &quot;a &amp; b&quot; = both present.</div>
        </div>
        <div className="mt-2.5">
          <label className={label}>Exclude phrases (comma-separated)</label>
          <input name="exclude_keywords" defaultValue={c.exclude_keywords.join(", ")} className={field} />
          <div className={hint}>Cut out before this category is tried (e.g. a buyer&apos;s name); one starting with ! rules the category out.</div>
        </div>
        <div className="mt-2.5">
          <label className={label}>eTenders categories it corresponds to (one per line)</label>
          <textarea name="etenders_categories" defaultValue={c.etenders_categories.join("\n")} className={area} />
          <div className={hint}>Cross-reference only: Discovery compares the buyer&apos;s own eTenders category with these.</div>
        </div>
        <label className="my-2.5 flex items-center gap-2 text-[13px] text-foreground">
          <input type="checkbox" name="active" defaultChecked={c.active} className="size-5" /> Active (untick to retire: no longer offered or matched, stored tags keep their label)
        </label>
        {c.parent_slug ? (
          <label className="mb-2.5 flex items-start gap-2 text-[13px] text-foreground">
            <input type="checkbox" name="matched_by_group_tag" defaultChecked={c.matched_by_group_tag} className="mt-0.5 size-5" />
            <span>
              A company tagged with the whole group counts as doing this
              <span className={`block ${hint}`}>
                Untick for a discipline the group&apos;s name doesn&apos;t really claim (a firm tagged &quot;Professional &amp; consulting
                services&quot; isn&apos;t thereby a property valuer): Discovery then matches it only for companies that ticked it
                itself, and shows it to group-tagged companies as &quot;needs a look&quot;, never as a fit.
              </span>
            </span>
          </label>
        ) : (
          <input type="hidden" name="matched_by_group_tag" value="on" />
        )}
        <div className="mb-2 text-[11px] text-muted-foreground/70">
          {c.added_from ? `Added from: ${c.added_from}. ` : ""}
          {c.l2b_categories.length ? `L2B: ${c.l2b_categories.join(", ")}. ` : ""}
          {c.cidb_classes.length ? `CIDB: ${c.cidb_classes.join(", ")}. ` : ""}
          Last changed {new Date(c.updated_at).toLocaleDateString("en-ZA")}.
        </div>
        {canEdit && <button type="submit" className={primary}>Save {c.slug}</button>}
      </fieldset>
    </form>
  );
}

export default async function TaxonomyAdminPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error: actionError, saved } = await searchParams;
  const supabase = await createClient();

  const [{ data: catRows, error: catError }, { data: isAdmin }, { data: sugRows, error: sugError }] = await Promise.all([
    supabase.from("discipline_categories").select(DISCIPLINE_CATEGORY_FULL_COLUMNS).order("sort_order"),
    supabase.rpc("is_platform_admin"),
    supabase
      .from("discipline_category_suggestions")
      .select("id, slug, label, suggested_parent_slug, note, company_name, example_project_name, status, review_note, reviewed_at, created_at")
      .order("created_at", { ascending: false }),
  ]);
  if (catError) console.error("discipline_categories select failed", catError);
  if (sugError) console.error("discipline_category_suggestions select failed", sugError);

  const canEdit = isAdmin === true;
  const cats = (catRows ?? []) as DisciplineCategoryFull[];
  const groups = cats.filter((c) => !c.parent_slug);
  const suggestions = (sugRows ?? []) as Suggestion[];
  const pending = suggestions.filter((s) => s.status === "pending");
  const reviewed = suggestions.filter((s) => s.status !== "pending").slice(0, 15);
  const retired = cats.filter((c) => !c.active).length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] px-4 pt-6 pb-10 sm:px-6 md:px-8">
        <AdminNav active="taxonomy" />
        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Discipline list</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Tender Ready&apos;s own, maintained category list: what Discovery sorts tenders into and what companies tag their
          experience with. {groups.length} groups, {cats.length - groups.length} disciplines{retired ? ` (${retired} retired)` : ""}. A change here is used by
          Discovery on its next run - no deploy, no migration.{" "}
          {canEdit ? "You can edit it." : "Read-only for your account: only a Tender Ready platform admin can change it."}
        </p>

        {(actionError || catError || sugError) && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {actionError ?? (catError
              ? "Couldn't load the list - try refreshing. If it keeps happening, let us know."
              : "Couldn't load suggestions - try refreshing. If it keeps happening, let us know.")}
          </div>
        )}
        {saved && (
          <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-4 py-2.5 text-[13px] text-success">
            {saved}
          </div>
        )}

        {/* Suggestions from companies */}
        <div className={card}>
          <div className={sectionTitle}>Suggested by companies ({pending.length} waiting)</div>
          <div className="mb-2.5 text-xs text-muted-foreground">
            A company&apos;s own experience tag, offered for the shared list from its Experience Library. Nothing is added until it
            is approved here. Approving adds it under the same slug, so the company&apos;s tagged items become a listed category
            with no change to their data. If it is really an existing category, reject it with a note saying which one.
          </div>
          {pending.length === 0 && <div className="text-[13px] text-muted-foreground/70">Nothing waiting for review.</div>}
          {pending.map((s) => (
            <div key={s.id} className="border-t border-border py-3">
              <div className="text-sm font-semibold text-foreground">
                {s.label} <span className="font-mono text-xs text-muted-foreground">{s.slug}</span>
              </div>
              <div className="my-0.5 mb-2 text-xs text-muted-foreground">
                From {s.company_name ?? "a company"}
                {s.example_project_name ? `, used on "${s.example_project_name}"` : ""}, {new Date(s.created_at).toLocaleDateString("en-ZA")}.
                {s.note ? ` Their note: "${s.note}"` : ""}
              </div>
              {canEdit ? (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[2fr_1fr]">
                  <form action={approveSuggestion} className="rounded-lg border border-border bg-card p-3">
                    <input type="hidden" name="id" value={s.id} />
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className={label}>Label on the list</label>
                        <input name="label" defaultValue={s.label} className={field} required />
                      </div>
                      <div>
                        <label className={label}>Group</label>
                        <ParentSelect groups={groups} value={s.suggested_parent_slug} />
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <label className={label}>Keywords Discovery should match (comma-separated)</label>
                      <input name="keywords" placeholder="e.g. hydrographic survey*, bathymetric*" className={field} />
                      <div className={hint}>Without keywords it is a tag companies can pick, but Discovery won&apos;t sort tenders into it.</div>
                    </div>
                    <div className="mt-2.5">
                      <label className={label}>Exclude phrases (optional)</label>
                      <input name="exclude_keywords" className={field} />
                    </div>
                    <div className="mt-2.5">
                      <label className={label}>Note to the company (optional)</label>
                      <input name="review_note" className={field} />
                    </div>
                    <button type="submit" className={`${accentBtn} mt-2.5`}>Approve and add to the list</button>
                  </form>
                  <form action={rejectSuggestion} className="rounded-lg border border-border bg-card p-3">
                    <input type="hidden" name="id" value={s.id} />
                    <label className={label}>Why not (shown to the company)</label>
                    <textarea name="review_note" placeholder="e.g. Already covered by Land surveying, GIS & mapping" className={area} />
                    <button type="submit" className={`${quiet} mt-2.5`}>Reject</button>
                  </form>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground/70">Waiting for a platform admin to review it.</div>
              )}
            </div>
          ))}
          {reviewed.length > 0 && (
            <details className="mt-2.5">
              <summary className="min-h-8 cursor-pointer text-xs font-semibold text-accent">Recently reviewed ({reviewed.length})</summary>
              {reviewed.map((s) => (
                <div key={s.id} className="border-t border-border py-1.5 text-xs text-muted-foreground">
                  <strong className={s.status === "approved" ? "text-success" : "text-destructive"}>{s.status}</strong> {s.label} ({s.slug}) from {s.company_name ?? "a company"}
                  {s.review_note ? ` - "${s.review_note}"` : ""}
                </div>
              ))}
            </details>
          )}
        </div>

        {/* Add a category */}
        {canEdit && (
          <div className={card}>
            <div className={sectionTitle}>Add a category</div>
            <div className="mb-2.5 text-xs text-muted-foreground">
              The same as <code>taxonomy.py add</code>. Pick a group to add a discipline; leave it empty to add a new group.
              Two levels only.
            </div>
            <form action={addCategory}>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div>
                  <label className={label}>Slug</label>
                  <input name="slug" required pattern="[a-z][a-z0-9_]{0,62}" placeholder="hydrographic_survey" className={field} />
                  <div className={hint}>Lower-case, digits and _. Can&apos;t be changed later.</div>
                </div>
                <div>
                  <label className={label}>Label</label>
                  <input name="label" required placeholder="Hydrographic & bathymetric survey" className={field} />
                </div>
                <div>
                  <label className={label}>Group</label>
                  <ParentSelect groups={groups} value={null} />
                </div>
              </div>
              <div className="mt-2.5">
                <label className={label}>Keywords (comma-separated)</label>
                <input name="keywords" placeholder="hydrographic survey*, bathymetric*" className={field} />
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className={label}>Exclude phrases (optional)</label>
                  <input name="exclude_keywords" className={field} />
                </div>
                <div>
                  <label className={label}>Where it came from (optional)</label>
                  <input name="note" placeholder="e.g. 3 uncategorised Transnet tenders, Oct 2026" className={field} />
                </div>
              </div>
              <div className="mt-2.5">
                <label className={label}>eTenders categories it corresponds to (one per line, optional)</label>
                <textarea name="etenders_categories" className={area} />
              </div>
              <button type="submit" className={`${accentBtn} mt-2.5`}>Add category</button>
            </form>
          </div>
        )}

        {/* The list */}
        <div className={card}>
          <div className={sectionTitle}>The list</div>
          <div className="mb-2 text-xs text-muted-foreground">Open a group to see and {canEdit ? "edit" : "read"} its disciplines.</div>
          {groups.map((g) => {
            const children = cats.filter((c) => c.parent_slug === g.slug);
            return (
              <details key={g.slug} className="border-t border-border py-2">
                <summary className={`flex min-h-8 flex-wrap items-center gap-2 text-sm font-semibold ${g.active ? "text-foreground" : "text-muted-foreground/70"}`}>
                  {g.label}
                  <span className="font-mono text-[11px] font-normal text-muted-foreground/70">{g.slug}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">{children.length} disciplines</span>
                  {!g.active && <span className="text-[11px] text-destructive">retired</span>}
                </summary>
                <details className="ml-3">
                  <summary className="min-h-7 cursor-pointer text-xs text-accent">The group itself</summary>
                  <CategoryForm c={g} groups={groups} canEdit={canEdit} />
                </details>
                {children.map((c) => (
                  <details key={c.slug} className="ml-3 border-t border-card">
                    <summary className={`flex min-h-[30px] flex-wrap items-center gap-2 text-[13px] ${c.active ? "text-foreground" : "text-muted-foreground/70"}`}>
                      {c.label}
                      <span className="font-mono text-[11px] text-muted-foreground/70">{c.slug}</span>
                      {!c.active && <span className="text-[11px] text-destructive">retired</span>}
                      {!c.matched_by_group_tag && <span className="text-[11px] text-muted-foreground">not matched by a group tag</span>}
                      {c.keywords.length === 0 && <span className="text-[11px] text-warning">no keywords - Discovery never sorts into it</span>}
                    </summary>
                    <CategoryForm c={c} groups={groups} canEdit={canEdit} />
                  </details>
                ))}
              </details>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
