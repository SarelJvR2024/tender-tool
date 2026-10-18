import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
import { isTaxonomySlug, loadDisciplineTaxonomy, taxonomyGroups } from "@/lib/disciplineTaxonomy";
import { saveExperienceTags, deleteExperience, suggestSharedCategory, withdrawSuggestion } from "../actions";
import {
  DOCUMENT_TYPES,
  CLIENT_TYPES,
  SERVICE_STAGES,
  PERFORMANCE_RATINGS,
  SANRAL_PROJECT_TYPES,
  disciplineLabel,
  type ExperienceItem,
} from "@/lib/experience";

// Per-request, under RLS - same escape hatch as people/[id]/page.tsx.
export const instant = false;

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 12px",
  borderRadius: 9, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "system-ui, sans-serif",
  color: "#16233B", background: "#FFFFFF",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B6758", marginBottom: 4, display: "block" };
const hint: React.CSSProperties = { fontSize: 11, color: "#9A9684", marginTop: 3 };
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 10px",
};
const checkLabel: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, minHeight: 36, padding: "0 12px", borderRadius: 9,
  border: "1px solid #E5E1D5", fontSize: 13, color: "#16233B", background: "#FFFFFF", cursor: "pointer",
};

function Field({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}>{children}</div>;
}

export default async function ExperienceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; captured?: string; suggested?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, saved, captured, suggested } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("experience_items").select("*").eq("id", id).maybeSingle();
  const item = data as ExperienceItem | null;
  const taxonomy = await loadDisciplineTaxonomy(supabase);
  const customTags = (item?.disciplines ?? []).filter((t) => !isTaxonomySlug(taxonomy, t));
  // 0054 (audit O2): this company's suggestions to promote its own tags to
  // the shared list - pending, approved or rejected, with Sarel's note.
  type Suggestion = { id: string; slug: string; status: "pending" | "approved" | "rejected"; review_note: string | null };
  const { data: suggestionRows } =
    customTags.length > 0
      ? await supabase.from("discipline_category_suggestions").select("id, slug, status, review_note").in("slug", customTags).order("created_at", { ascending: false })
      : { data: [] };
  const suggestionFor = (slug: string) => ((suggestionRows ?? []) as Suggestion[]).find((s) => s.slug === slug) ?? null;

  if (!item) {
    return (
      <div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#B91C1C" }}>Experience item not found, or you don&apos;t have access to it.</p>
        <Link href="/experience">← Back to Experience</Link>
      </div>
    );
  }

  let fileUrl: string | null = null;
  if (item.storage_path) {
    const { data: signed } = await supabase.storage.from("experience-documents").createSignedUrl(item.storage_path, 600);
    fileUrl = signed?.signedUrl ?? null;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <style>{`
        @media (max-width: 600px) {
          .exp-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <SiteNav active="experience" />

      <div style={{ flex: 1, padding: "24px 16px 40px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <Link href="/experience" style={{ fontSize: 13, color: "#6B6758", textDecoration: "none" }}>← Company experience</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "8px 0 4px" }}>{item.project_name}</h1>
        <div style={{ fontSize: 13, color: "#6B6758", marginBottom: 16 }}>
          {item.original_filename ? (
            <>
              {item.original_filename}
              {fileUrl && (
                <>
                  {" · "}
                  <a href={fileUrl} style={{ color: "#D97706", fontWeight: 600 }}>Open document</a>
                </>
              )}
            </>
          ) : (
            "No document attached yet - attach the reference letter or certificate below once you have it."
          )}
        </div>

        {captured === "1" && !item.tagged_at && (
          <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B45309" }}>
            Uploaded. Now tag what this document shows - it won&apos;t count towards any tender until it&apos;s tagged.
          </div>
        )}
        {suggested === "1" && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            Suggested for the shared discipline list. It is reviewed before anything is added - you&apos;ll see the outcome here.
          </div>
        )}
        {saved === "1" && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            Tags saved.
          </div>
        )}
        {errorParam && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            {decodeURIComponent(errorParam)}
          </div>
        )}

        <form action={saveExperienceTags} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "18px 16px", marginBottom: 16 }}>
          <input type="hidden" name="id" value={item.id} />

          <div style={{ ...sectionTitle, marginTop: 0 }}>The document</div>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>Project name *</label><input style={field} name="project_name" defaultValue={item.project_name} required /></Field>
            <Field>
              <label style={label}>Document type *</label>
              <select style={field} name="document_type" defaultValue={item.document_type}>
                {DOCUMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field>
              <label style={label}>Rating on the document</label>
              <select style={field} name="performance_rating" defaultValue={item.performance_rating ?? ""}>
                <option value="">Not rated</option>
                {PERFORMANCE_RATINGS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <div style={hint}>Reference letters and CIDB reports carry one - SANRAL scores it 1/3/4/5.</div>
            </Field>
            <Field>
              <label style={label}>{item.storage_path ? "Replace document" : "Attach document"}</label>
              <input style={{ ...field, paddingTop: 10 }} type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
            </Field>
          </div>

          <div style={sectionTitle}>Client</div>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>Client name</label><input style={field} name="client_name" defaultValue={item.client_name ?? ""} placeholder="e.g. Airports Company South Africa" /></Field>
            <Field><label style={label}>Contract number</label><input style={field} name="contract_number" defaultValue={item.contract_number ?? ""} /></Field>
            <Field>
              <label style={label}>Client type</label>
              <select style={field} name="client_type" defaultValue={item.client_type ?? ""}>
                <option value="">Not set</option>
                {CLIENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={hint}>SANRAL&apos;s client codes - scored on Forms B1/B2.</div>
            </Field>
          </div>

          <div style={sectionTitle}>What the work was</div>
          <label style={label}>Discipline * <span style={{ fontWeight: 400 }}>(tick all that apply - tenders are matched on this)</span></label>
          <div style={hint}>
            Tender Tool&apos;s own discipline list, built from real tenders and growing as new kinds of tender come in. Ticking a
            whole group (e.g. Roads, bridges &amp; civil works) matches the disciplines in it, except the ones marked
            &quot;tick on its own&quot; - a whole-group tick is too broad to call those a fit (Professional &amp; consulting
            services doesn&apos;t make a firm a property valuer). Tick one of those itself if the company does that work.
            {taxonomy.source === "fallback" && ` (Showing the original 7 groups only - the full list couldn't be read: ${taxonomy.error}.)`}
          </div>
          <div style={{ margin: "6px 0 12px" }}>
            {taxonomyGroups(taxonomy).map(({ group, children }) => {
              const ticked = [group, ...children].filter((c) => item.disciplines.includes(c.slug)).length;
              return (
                <details key={group.slug} open={ticked > 0} style={{ borderTop: "1px solid #F0EEE6", padding: "6px 0" }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#16233B", minHeight: 32, display: "flex", alignItems: "center", gap: 8 }}>
                    {group.label}
                    {ticked > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: "#15803D", background: "#DCFCE7", borderRadius: 100, padding: "2px 8px" }}>{ticked} ticked</span>}
                  </summary>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <label style={{ ...checkLabel, fontWeight: 600 }}>
                      <input type="checkbox" name="disciplines" value={group.slug} defaultChecked={item.disciplines.includes(group.slug)} />
                      Whole group: {group.label.toLowerCase()}
                    </label>
                    {children.map((c) => (
                      <label key={c.slug} style={checkLabel}>
                        <input type="checkbox" name="disciplines" value={c.slug} defaultChecked={item.disciplines.includes(c.slug)} />
                        {c.label}
                        {c.matched_by_group_tag === false && <span style={{ fontSize: 11, color: "#9A9684" }}>(tick on its own)</span>}
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
            {customTags.length > 0 && (
              <div style={{ borderTop: "1px solid #F0EEE6", paddingTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#6B6758", alignSelf: "center" }}>Your own tags:</span>
                {customTags.map((v) => (
                  <label key={v} style={checkLabel}>
                    <input type="checkbox" name="disciplines" value={v} defaultChecked />
                    {disciplineLabel(v)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Field>
            <label style={label}>Other disciplines <span style={{ fontWeight: 400 }}>(optional, comma-separated)</span></label>
            <input style={field} name="other_disciplines" placeholder="e.g. Hydrographic survey, Heritage conservation" />
            <div style={hint}>For work the list doesn&apos;t cover yet. It is saved as your own tag; the list itself is reviewed and extended as new kinds of tender come in, so also tick the closest listed discipline if there is one.</div>
          </Field>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field>
              <label style={label}>Project type</label>
              <input style={field} name="project_type" list="sanral-project-types" defaultValue={item.project_type ?? ""} placeholder="e.g. DS, RRM, MP/MS" />
              <datalist id="sanral-project-types">
                {SANRAL_PROJECT_TYPES.map((p) => <option key={p.code} value={p.code}>{`${p.label} (${p.appliesTo.join("; ")})`}</option>)}
              </datalist>
              <div style={hint}>SANRAL&apos;s code where it applies; plain words for other clients.</div>
            </Field>
            <Field><label style={label}>Value (R million)</label><input style={field} type="number" step="0.01" min="0" name="value_rm" defaultValue={item.value_rm ?? ""} /></Field>
          </div>
          <Field>
            <label style={label}>Scope in a line</label>
            <input style={field} name="scope_summary" defaultValue={item.scope_summary ?? ""} placeholder="e.g. Crack sealing, pothole and edge repair on N1 section 5" />
            <div style={hint}>Tenders ask for &quot;projects of similar scope&quot; - this is what gets compared.</div>
          </Field>
          <label style={label}>Services delivered <span style={{ fontWeight: 400 }}>(CIDB project stages)</span></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {SERVICE_STAGES.map((s) => (
              <label key={s.value} style={checkLabel}>
                <input type="checkbox" name="service_stages" value={s.value} defaultChecked={item.service_stages.includes(s.value)} />
                {s.label}
              </label>
            ))}
          </div>

          <div style={sectionTitle}>Dates</div>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>Start date</label><input style={field} type="date" name="start_date" defaultValue={item.start_date ?? ""} /></Field>
            <Field>
              <label style={label}>Completion date</label>
              <input style={field} type="date" name="completion_date" defaultValue={item.completion_date ?? ""} />
              <div style={hint}>Leave blank if not completed - SANRAL only counts work completed in the last 10 years.</div>
            </Field>
          </div>

          <div style={sectionTitle}>Contactable reference</div>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>Name &amp; position</label><input style={field} name="reference_contact_name" defaultValue={item.reference_contact_name ?? ""} /></Field>
            <Field><label style={label}>Phone</label><input style={field} name="reference_contact_phone" defaultValue={item.reference_contact_phone ?? ""} /></Field>
            <Field><label style={label}>Email</label><input style={field} type="email" name="reference_contact_email" defaultValue={item.reference_contact_email ?? ""} /></Field>
          </div>

          <Field>
            <label style={label}>Notes</label>
            <textarea name="notes" defaultValue={item.notes ?? ""} rows={2} style={{ ...field, padding: "10px 12px", resize: "vertical" }} />
          </Field>

          <button
            type="submit"
            style={{ minHeight: 44, padding: "0 20px", borderRadius: 10, background: "#16233B", color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
          >
            Save tags
          </button>
        </form>

        {customTags.length > 0 && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "16px 16px", marginBottom: 16 }}>
            <div style={{ ...sectionTitle, marginTop: 0 }}>Your own tags and the shared list</div>
            <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
              These tags aren&apos;t on Tender Tool&apos;s shared discipline list, so Discovery doesn&apos;t sort tenders into them. If
              other companies would use one too, suggest it: Tender Tool reviews every suggestion before anything is added. The
              reviewer sees your company name, the tag, your note and this project&apos;s name.
            </div>
            {customTags.map((t) => {
              const sug = suggestionFor(t);
              return (
                <div key={t} style={{ borderTop: "1px solid #F0EEE6", padding: "10px 0" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>{disciplineLabel(t)}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "#9A9684" }}>{t}</span>
                    {sug && (
                      <span
                        style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 100,
                          background: sug.status === "pending" ? "#FEF3C7" : sug.status === "approved" ? "#DCFCE7" : "#FEE2E2",
                          color: sug.status === "pending" ? "#B45309" : sug.status === "approved" ? "#15803D" : "#B91C1C",
                        }}
                      >
                        {sug.status === "pending" ? "Suggested - waiting for review" : sug.status === "approved" ? "Added to the shared list" : "Not added"}
                      </span>
                    )}
                  </div>
                  {sug?.review_note && <div style={{ fontSize: 12, color: "#4B5563", marginTop: 4 }}>Reviewer&apos;s note: {sug.review_note}</div>}
                  {sug?.status === "pending" && (
                    <form action={withdrawSuggestion} style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={sug.id} />
                      <input type="hidden" name="item_id" value={item.id} />
                      <button type="submit" style={{ minHeight: 36, padding: "0 12px", borderRadius: 9, background: "#FFFFFF", color: "#6B6758", fontWeight: 600, fontSize: 12, border: "1px solid #E5E1D5", cursor: "pointer" }}>
                        Withdraw the suggestion
                      </button>
                    </form>
                  )}
                  {(!sug || sug.status === "rejected") && (
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#D97706", minHeight: 32 }}>
                        {sug ? "Suggest it again" : "Suggest this as a shared category"}
                      </summary>
                      <form action={suggestSharedCategory} style={{ marginTop: 6 }}>
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="slug" value={t} />
                        <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                          <Field>
                            <label style={label}>Name it as it should appear</label>
                            <input style={field} name="label" defaultValue={disciplineLabel(t)} required />
                          </Field>
                          <Field>
                            <label style={label}>Which group it belongs in (your best guess)</label>
                            <select style={field} name="parent_slug" defaultValue="">
                              <option value="">Not sure</option>
                              {taxonomyGroups(taxonomy).map(({ group }) => <option key={group.slug} value={group.slug}>{group.label}</option>)}
                            </select>
                          </Field>
                        </div>
                        <Field>
                          <label style={label}>What kind of work it covers (optional)</label>
                          <input style={field} name="note" placeholder="e.g. Hydrographic surveys of dams and harbours for DWS and TNPA" />
                        </Field>
                        <button type="submit" style={{ minHeight: 40, padding: "0 16px", borderRadius: 9, background: "#D97706", color: "#FFFFFF", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer" }}>
                          Send for review
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <form action={deleteExperience}>
          <input type="hidden" name="id" value={item.id} />
          <button
            type="submit"
            style={{ minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#FEE2E2", color: "#B91C1C", fontWeight: 600, fontSize: 13, border: "1px solid #FCA5A5", cursor: "pointer" }}
          >
            Remove this item
          </button>
        </form>
      </div>
    </div>
  );
}
