import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
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

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "16px 18px", marginBottom: 16 };
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 40, padding: "0 10px", borderRadius: 9, border: "1px solid #E5E1D5",
  fontSize: 13, fontFamily: "system-ui, sans-serif", color: "#16233B", background: "#FFFFFF",
};
const area: React.CSSProperties = { ...field, padding: "8px 10px", minHeight: 60, resize: "vertical" };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B6758", marginBottom: 4, display: "block" };
const hint: React.CSSProperties = { fontSize: 11, color: "#9A9684", marginTop: 3 };
const primary: React.CSSProperties = { minHeight: 40, padding: "0 16px", borderRadius: 9, background: "#16233B", color: "#FFFFFF", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer" };
const amber: React.CSSProperties = { ...primary, background: "#D97706" };
const quiet: React.CSSProperties = { ...primary, background: "#FFFFFF", color: "#B91C1C", border: "1px solid #FCA5A5" };
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: "#16233B", margin: "0 0 4px" };

function ParentSelect({ groups, value, name = "parent_slug" }: { groups: DisciplineCategoryFull[]; value: string | null; name?: string }) {
  return (
    <select name={name} defaultValue={value ?? ""} style={field}>
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
    <form action={updateCategory} style={{ background: "#F6F5F1", border: "1px solid #E5E1D5", borderRadius: 9, padding: "12px 12px", margin: "6px 0 10px" }}>
      <input type="hidden" name="slug" value={c.slug} />
      <fieldset disabled={!canEdit} style={{ border: "none", padding: 0, margin: 0 }}>
        <div className="tax-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={label}>Label</label>
            <input name="label" defaultValue={c.label} style={field} required />
          </div>
          <div>
            <label style={label}>Group</label>
            {c.parent_slug ? <ParentSelect groups={groups} value={c.parent_slug} name="parent_slug" /> : (
              <>
                <input type="hidden" name="parent_slug" value="" />
                <div style={{ ...field, display: "flex", alignItems: "center", color: "#6B6758" }}>Top-level group</div>
              </>
            )}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={label}>Keywords (comma-separated)</label>
          <textarea name="keywords" defaultValue={c.keywords.join(", ")} style={area} />
          <div style={hint}>Matched in a tender&apos;s title and description: whole words, a trailing * = any ending, &quot;a &amp; b&quot; = both present.</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={label}>Exclude phrases (comma-separated)</label>
          <input name="exclude_keywords" defaultValue={c.exclude_keywords.join(", ")} style={field} />
          <div style={hint}>Cut out before this category is tried (e.g. a buyer&apos;s name); one starting with ! rules the category out.</div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={label}>eTenders categories it corresponds to (one per line)</label>
          <textarea name="etenders_categories" defaultValue={c.etenders_categories.join("\n")} style={area} />
          <div style={hint}>Cross-reference only: Discovery compares the buyer&apos;s own eTenders category with these.</div>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#16233B", margin: "10px 0" }}>
          <input type="checkbox" name="active" defaultChecked={c.active} /> Active (untick to retire: no longer offered or matched, stored tags keep their label)
        </label>
        <div style={{ fontSize: 11, color: "#9A9684", marginBottom: 8 }}>
          {c.added_from ? `Added from: ${c.added_from}. ` : ""}
          {c.l2b_categories.length ? `L2B: ${c.l2b_categories.join(", ")}. ` : ""}
          {c.cidb_classes.length ? `CIDB: ${c.cidb_classes.join(", ")}. ` : ""}
          Last changed {new Date(c.updated_at).toLocaleDateString("en-ZA")}.
        </div>
        {canEdit && <button type="submit" style={primary}>Save {c.slug}</button>}
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
  const canEdit = isAdmin === true;
  const cats = (catRows ?? []) as DisciplineCategoryFull[];
  const groups = cats.filter((c) => !c.parent_slug);
  const suggestions = (sugRows ?? []) as Suggestion[];
  const pending = suggestions.filter((s) => s.status === "pending");
  const reviewed = suggestions.filter((s) => s.status !== "pending").slice(0, 15);
  const retired = cats.filter((c) => !c.active).length;

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <style>{`@media (max-width: 640px) { .tax-grid { grid-template-columns: 1fr !important; } }`}</style>
      <SiteNav active="admin" />
      <div style={{ padding: "24px 16px 40px", maxWidth: 1000, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 8 }}>
          <Link href="/admin" style={{ color: "#6B6758", textDecoration: "none" }}>Alerts &amp; harness results</Link>
          <span style={{ color: "#16233B", fontWeight: 600 }}>Discipline list</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Discipline list</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 16px" }}>
          Tender Tool&apos;s own, maintained category list: what Discovery sorts tenders into and what companies tag their
          experience with. {groups.length} groups, {cats.length - groups.length} disciplines{retired ? ` (${retired} retired)` : ""}. A change here is used by
          Discovery on its next run - no deploy, no migration.{" "}
          {canEdit ? "You can edit it." : "Read-only for your account: only a Tender Tool platform admin can change it."}
        </p>

        {(actionError || catError || sugError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            {actionError ?? (catError ? `Could not load the list: ${catError.message}` : `Could not load suggestions: ${sugError?.message}`)}
          </div>
        )}
        {saved && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            {saved}
          </div>
        )}

        {/* Suggestions from companies */}
        <div style={card}>
          <div style={sectionTitle}>Suggested by companies ({pending.length} waiting)</div>
          <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
            A company&apos;s own experience tag, offered for the shared list from its Experience Library. Nothing is added until it
            is approved here. Approving adds it under the same slug, so the company&apos;s tagged items become a listed category
            with no change to their data. If it is really an existing category, reject it with a note saying which one.
          </div>
          {pending.length === 0 && <div style={{ fontSize: 13, color: "#9A9684" }}>Nothing waiting for review.</div>}
          {pending.map((s) => (
            <div key={s.id} style={{ borderTop: "1px solid #F0EEE6", padding: "12px 0" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B" }}>
                {s.label} <span style={{ fontFamily: "monospace", fontSize: 12, color: "#6B6758" }}>{s.slug}</span>
              </div>
              <div style={{ fontSize: 12, color: "#4B5563", margin: "2px 0 8px" }}>
                From {s.company_name ?? "a company"}
                {s.example_project_name ? `, used on "${s.example_project_name}"` : ""}, {new Date(s.created_at).toLocaleDateString("en-ZA")}.
                {s.note ? ` Their note: "${s.note}"` : ""}
              </div>
              {canEdit ? (
                <div className="tax-grid" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
                  <form action={approveSuggestion} style={{ background: "#F6F5F1", border: "1px solid #E5E1D5", borderRadius: 9, padding: 12 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <div className="tax-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={label}>Label on the list</label>
                        <input name="label" defaultValue={s.label} style={field} required />
                      </div>
                      <div>
                        <label style={label}>Group</label>
                        <ParentSelect groups={groups} value={s.suggested_parent_slug} />
                      </div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <label style={label}>Keywords Discovery should match (comma-separated)</label>
                      <input name="keywords" placeholder="e.g. hydrographic survey*, bathymetric*" style={field} />
                      <div style={hint}>Without keywords it is a tag companies can pick, but Discovery won&apos;t sort tenders into it.</div>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <label style={label}>Exclude phrases (optional)</label>
                      <input name="exclude_keywords" style={field} />
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <label style={label}>Note to the company (optional)</label>
                      <input name="review_note" style={field} />
                    </div>
                    <button type="submit" style={{ ...amber, marginTop: 10 }}>Approve and add to the list</button>
                  </form>
                  <form action={rejectSuggestion} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, padding: 12 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <label style={label}>Why not (shown to the company)</label>
                    <textarea name="review_note" placeholder="e.g. Already covered by Land surveying, GIS & mapping" style={area} />
                    <button type="submit" style={{ ...quiet, marginTop: 10 }}>Reject</button>
                  </form>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#9A9684" }}>Waiting for a platform admin to review it.</div>
              )}
            </div>
          ))}
          {reviewed.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#D97706", minHeight: 32 }}>Recently reviewed ({reviewed.length})</summary>
              {reviewed.map((s) => (
                <div key={s.id} style={{ fontSize: 12, color: "#4B5563", borderTop: "1px solid #F0EEE6", padding: "6px 0" }}>
                  <strong style={{ color: s.status === "approved" ? "#15803D" : "#B91C1C" }}>{s.status}</strong> {s.label} ({s.slug}) from {s.company_name ?? "a company"}
                  {s.review_note ? ` - "${s.review_note}"` : ""}
                </div>
              ))}
            </details>
          )}
        </div>

        {/* Add a category */}
        {canEdit && (
          <div style={card}>
            <div style={sectionTitle}>Add a category</div>
            <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
              The same as <code>taxonomy.py add</code>. Pick a group to add a discipline; leave it empty to add a new group.
              Two levels only.
            </div>
            <form action={addCategory}>
              <div className="tax-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <label style={label}>Slug</label>
                  <input name="slug" required pattern="[a-z][a-z0-9_]{0,62}" placeholder="hydrographic_survey" style={field} />
                  <div style={hint}>Lower-case, digits and _. Can&apos;t be changed later.</div>
                </div>
                <div>
                  <label style={label}>Label</label>
                  <input name="label" required placeholder="Hydrographic & bathymetric survey" style={field} />
                </div>
                <div>
                  <label style={label}>Group</label>
                  <ParentSelect groups={groups} value={null} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={label}>Keywords (comma-separated)</label>
                <input name="keywords" placeholder="hydrographic survey*, bathymetric*" style={field} />
              </div>
              <div className="tax-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                <div>
                  <label style={label}>Exclude phrases (optional)</label>
                  <input name="exclude_keywords" style={field} />
                </div>
                <div>
                  <label style={label}>Where it came from (optional)</label>
                  <input name="note" placeholder="e.g. 3 uncategorised Transnet tenders, Oct 2026" style={field} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={label}>eTenders categories it corresponds to (one per line, optional)</label>
                <textarea name="etenders_categories" style={area} />
              </div>
              <button type="submit" style={{ ...amber, marginTop: 10 }}>Add category</button>
            </form>
          </div>
        )}

        {/* The list */}
        <div style={card}>
          <div style={sectionTitle}>The list</div>
          <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 8 }}>Open a group to see and {canEdit ? "edit" : "read"} its disciplines.</div>
          {groups.map((g) => {
            const children = cats.filter((c) => c.parent_slug === g.slug);
            return (
              <details key={g.slug} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0" }}>
                <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: g.active ? "#16233B" : "#9A9684", minHeight: 32, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {g.label}
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: "#9A9684", fontWeight: 400 }}>{g.slug}</span>
                  <span style={{ fontSize: 11, color: "#6B6758", fontWeight: 400 }}>{children.length} disciplines</span>
                  {!g.active && <span style={{ fontSize: 11, color: "#B91C1C" }}>retired</span>}
                </summary>
                <details style={{ marginLeft: 12 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12, color: "#D97706", minHeight: 28 }}>The group itself</summary>
                  <CategoryForm c={g} groups={groups} canEdit={canEdit} />
                </details>
                {children.map((c) => (
                  <details key={c.slug} style={{ marginLeft: 12, borderTop: "1px solid #F6F5F1" }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, color: c.active ? "#16233B" : "#9A9684", minHeight: 30, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {c.label}
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: "#9A9684" }}>{c.slug}</span>
                      {!c.active && <span style={{ fontSize: 11, color: "#B91C1C" }}>retired</span>}
                      {c.keywords.length === 0 && <span style={{ fontSize: 11, color: "#B45309" }}>no keywords - Discovery never sorts into it</span>}
                    </summary>
                    <CategoryForm c={c} groups={groups} canEdit={canEdit} />
                  </details>
                ))}
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
