import Link from "next/link";
import { AlertTriangle, FileX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { ConfirmSubmitButton } from "../../_components/ConfirmSubmitButton";
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
import { EmptyState } from "@/components/tt/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";

// Per-request, under RLS - same escape hatch as people/[id]/page.tsx.
export const instant = false;

const fieldClass =
  "min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground";
const hintClass = "mt-0.5 text-[11px] text-muted-foreground";
const sectionTitleClass = "mt-4 mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase first:mt-0";
const checkLabelClass = "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground";
const gridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2";
const cardClass = "mb-4 rounded-xl border border-border bg-card p-4";

type Tone = "success" | "warning" | "destructive" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
};
function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-3">{children}</div>;
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

  const { data, error: itemError } = await supabase.from("experience_items").select("*").eq("id", id).maybeSingle();
  if (itemError) console.error("experience_items select failed for detail page", itemError);
  const item = data as ExperienceItem | null;
  const taxonomy = await loadDisciplineTaxonomy(supabase);
  const customTags = (item?.disciplines ?? []).filter((t) => !isTaxonomySlug(taxonomy, t));
  // 0054 (audit O2): this company's suggestions to promote its own tags to
  // the shared list - pending, approved or rejected, with Sarel's note. This
  // is its own 3-state review workflow, not a Verify/Provide/Fix bid task
  // (nothing here blocks or helps a bid - it's a request to Tender Ready's
  // catalog team) - kept as its own named vocabulary, just token-painted.
  type Suggestion = { id: string; slug: string; status: "pending" | "approved" | "rejected"; review_note: string | null };
  const { data: suggestionRows } =
    customTags.length > 0
      ? await supabase.from("discipline_category_suggestions").select("id, slug, status, review_note").in("slug", customTags).order("created_at", { ascending: false })
      : { data: [] };
  const suggestionFor = (slug: string) => ((suggestionRows ?? []) as Suggestion[]).find((s) => s.slug === slug) ?? null;
  const SUGGESTION_TONE: Record<Suggestion["status"], Tone> = { pending: "warning", approved: "success", rejected: "muted" };
  const SUGGESTION_LABEL: Record<Suggestion["status"], string> = {
    pending: "Suggested - waiting for review",
    approved: "Added to the shared list",
    rejected: "Not added",
  };

  if (!item) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-10">
          <EmptyState
            icon={itemError ? AlertTriangle : FileX}
            title={itemError ? "Couldn't load this experience item" : "Experience item not found"}
            description={
              itemError
                ? "Something went wrong reading this record - try refreshing. If it keeps happening, let us know."
                : "This item may have been removed, or you don't have access to it."
            }
            action={
              <Link href="/experience" className={buttonVariants({ variant: "outline" })}>
                Back to Experience
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }

  let fileUrl: string | null = null;
  if (item.storage_path) {
    const { data: signed } = await supabase.storage.from("experience-documents").createSignedUrl(item.storage_path, 600);
    fileUrl = signed?.signedUrl ?? null;
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6 pb-10">
        <Link href="/experience" className="text-sm text-muted-foreground no-underline">← Company experience</Link>
        <h1 className="mt-2 mb-1 font-display text-xl font-medium text-foreground">{item.project_name}</h1>
        <div className="mb-4 text-sm text-muted-foreground">
          {item.original_filename ? (
            <>
              {item.original_filename}
              {fileUrl && (
                <>
                  {" · "}
                  <a href={fileUrl} className="font-semibold text-accent">Open document</a>
                </>
              )}
            </>
          ) : (
            "No document attached yet - attach the reference letter or certificate below once you have it."
          )}
        </div>

        {captured === "1" && !item.tagged_at && (
          <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            Uploaded. Provide the tags next - it won&apos;t count towards any tender until it&apos;s tagged.
          </div>
        )}
        {suggested === "1" && (
          <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            Suggested for the shared discipline list. It is reviewed before anything is added - you&apos;ll see the outcome here.
          </div>
        )}
        {saved === "1" && (
          <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            Tags saved.
          </div>
        )}
        {errorParam && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {decodeURIComponent(errorParam)}
          </div>
        )}

        <form action={saveExperienceTags} className={cardClass}>
          <input type="hidden" name="id" value={item.id} />

          <div className={sectionTitleClass}>The document</div>
          <div className={gridClass}>
            <Field><label className={labelClass}>Project name *</label><input className={fieldClass} name="project_name" defaultValue={item.project_name} required /></Field>
            <Field>
              <label className={labelClass}>Document type *</label>
              <select className={fieldClass} name="document_type" defaultValue={item.document_type}>
                {DOCUMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field>
              <label className={labelClass}>Rating on the document</label>
              <select className={fieldClass} name="performance_rating" defaultValue={item.performance_rating ?? ""}>
                <option value="">Not rated</option>
                {PERFORMANCE_RATINGS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <div className={hintClass}>Reference letters and CIDB reports carry one - SANRAL scores it 1/3/4/5.</div>
            </Field>
            <Field>
              <label className={labelClass}>{item.storage_path ? "Replace document" : "Attach document"}</label>
              <input className={`${fieldClass} pt-2.5`} type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
            </Field>
          </div>

          <div className={sectionTitleClass}>Client</div>
          <div className={gridClass}>
            <Field><label className={labelClass}>Client name</label><input className={fieldClass} name="client_name" defaultValue={item.client_name ?? ""} placeholder="e.g. Airports Company South Africa" /></Field>
            <Field><label className={labelClass}>Contract number</label><input className={fieldClass} name="contract_number" defaultValue={item.contract_number ?? ""} /></Field>
            <Field>
              <label className={labelClass}>Client type</label>
              <select className={fieldClass} name="client_type" defaultValue={item.client_type ?? ""}>
                <option value="">Not set</option>
                {CLIENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className={hintClass}>SANRAL&apos;s client codes - scored on Forms B1/B2.</div>
            </Field>
          </div>

          <div className={sectionTitleClass}>What the work was</div>
          <label className={labelClass}>Discipline * <span className="font-normal">(tick all that apply - tenders are matched on this)</span></label>
          <div className={hintClass}>
            Tender Ready&apos;s own discipline list, built from real tenders and growing as new kinds of tender come in. Ticking a
            whole group (e.g. Roads, bridges &amp; civil works) matches the disciplines in it, except the ones marked
            &quot;tick on its own&quot; - a whole-group tick is too broad to call those a fit (Professional &amp; consulting
            services doesn&apos;t make a firm a property valuer). Tick one of those itself if the company does that work.
            {taxonomy.source === "fallback" && ` (Showing the original 7 groups only - the full list couldn't be read: ${taxonomy.error}.)`}
          </div>
          <div className="my-2.5">
            {taxonomyGroups(taxonomy).map(({ group, children }) => {
              const ticked = [group, ...children].filter((c) => item.disciplines.includes(c.slug)).length;
              return (
                <details key={group.slug} open={ticked > 0} className="border-t border-border py-1.5 first:border-t-0">
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
                    {group.label}
                    {ticked > 0 && <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">{ticked} ticked</span>}
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <label className={`${checkLabelClass} font-semibold`}>
                      <input type="checkbox" name="disciplines" value={group.slug} defaultChecked={item.disciplines.includes(group.slug)} />
                      Whole group: {group.label.toLowerCase()}
                    </label>
                    {children.map((c) => (
                      <label key={c.slug} className={checkLabelClass}>
                        <input type="checkbox" name="disciplines" value={c.slug} defaultChecked={item.disciplines.includes(c.slug)} />
                        {c.label}
                        {c.matched_by_group_tag === false && <span className="text-[11px] text-muted-foreground">(tick on its own)</span>}
                      </label>
                    ))}
                  </div>
                </details>
              );
            })}
            {customTags.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-2">
                <span className="self-center text-xs text-muted-foreground">Your own tags:</span>
                {customTags.map((v) => (
                  <label key={v} className={checkLabelClass}>
                    <input type="checkbox" name="disciplines" value={v} defaultChecked />
                    {disciplineLabel(v)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <Field>
            <label className={labelClass}>Other disciplines <span className="font-normal">(optional, comma-separated)</span></label>
            <input className={fieldClass} name="other_disciplines" placeholder="e.g. Hydrographic survey, Heritage conservation" />
            <div className={hintClass}>For work the list doesn&apos;t cover yet. It is saved as your own tag; the list itself is reviewed and extended as new kinds of tender come in, so also tick the closest listed discipline if there is one.</div>
          </Field>
          <div className={gridClass}>
            <Field>
              <label className={labelClass}>Project type</label>
              <input className={fieldClass} name="project_type" list="sanral-project-types" defaultValue={item.project_type ?? ""} placeholder="e.g. DS, RRM, MP/MS" />
              <datalist id="sanral-project-types">
                {SANRAL_PROJECT_TYPES.map((p) => <option key={p.code} value={p.code}>{`${p.label} (${p.appliesTo.join("; ")})`}</option>)}
              </datalist>
              <div className={hintClass}>SANRAL&apos;s code where it applies; plain words for other clients.</div>
            </Field>
            <Field><label className={labelClass}>Value (R million)</label><input className={fieldClass} type="number" step="0.01" min="0" name="value_rm" defaultValue={item.value_rm ?? ""} /></Field>
          </div>
          <Field>
            <label className={labelClass}>Scope in a line</label>
            <input className={fieldClass} name="scope_summary" defaultValue={item.scope_summary ?? ""} placeholder="e.g. Crack sealing, pothole and edge repair on N1 section 5" />
            <div className={hintClass}>Tenders ask for &quot;projects of similar scope&quot; - this is what gets compared.</div>
          </Field>
          <label className={labelClass}>Services delivered <span className="font-normal">(CIDB project stages)</span></label>
          <div className="mb-3 flex flex-wrap gap-2">
            {SERVICE_STAGES.map((s) => (
              <label key={s.value} className={checkLabelClass}>
                <input type="checkbox" name="service_stages" value={s.value} defaultChecked={item.service_stages.includes(s.value)} />
                {s.label}
              </label>
            ))}
          </div>

          <div className={sectionTitleClass}>Dates</div>
          <div className={gridClass}>
            <Field><label className={labelClass}>Start date</label><input className={fieldClass} type="date" name="start_date" defaultValue={item.start_date ?? ""} /></Field>
            <Field>
              <label className={labelClass}>Completion date</label>
              <input className={fieldClass} type="date" name="completion_date" defaultValue={item.completion_date ?? ""} />
              <div className={hintClass}>Leave blank if not completed - SANRAL only counts work completed in the last 10 years.</div>
            </Field>
          </div>

          <div className={sectionTitleClass}>Contactable reference</div>
          <div className={gridClass}>
            <Field><label className={labelClass}>Name &amp; position</label><input className={fieldClass} name="reference_contact_name" defaultValue={item.reference_contact_name ?? ""} /></Field>
            <Field><label className={labelClass}>Phone</label><input className={fieldClass} name="reference_contact_phone" defaultValue={item.reference_contact_phone ?? ""} /></Field>
            <Field><label className={labelClass}>Email</label><input className={fieldClass} type="email" name="reference_contact_email" defaultValue={item.reference_contact_email ?? ""} /></Field>
          </div>

          <Field>
            <label className={labelClass}>Notes</label>
            <textarea name="notes" defaultValue={item.notes ?? ""} rows={2} className={`${fieldClass} resize-y py-2.5`} />
          </Field>

          <Button type="submit" variant="accent" size="lg" className="min-h-11 px-5">
            Save tags
          </Button>
        </form>

        {customTags.length > 0 && (
          <div className={cardClass}>
            <div className={`${sectionTitleClass} mt-0`}>Your own tags and the shared list</div>
            <div className="mb-2.5 text-xs text-muted-foreground">
              These tags aren&apos;t on Tender Ready&apos;s shared discipline list, so Discovery doesn&apos;t sort tenders into them. If
              other companies would use one too, suggest it: Tender Ready reviews every suggestion before anything is added. The
              reviewer sees your company name, the tag, your note and this project&apos;s name.
            </div>
            {customTags.map((t) => {
              const sug = suggestionFor(t);
              return (
                <div key={t} className="border-t border-border py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{disciplineLabel(t)}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{t}</span>
                    {sug && <Pill tone={SUGGESTION_TONE[sug.status]}>{SUGGESTION_LABEL[sug.status]}</Pill>}
                  </div>
                  {sug?.review_note && <div className="mt-1 text-xs text-muted-foreground">Reviewer&apos;s note: {sug.review_note}</div>}
                  {sug?.status === "pending" && (
                    <form action={withdrawSuggestion} className="mt-1.5">
                      <input type="hidden" name="id" value={sug.id} />
                      <input type="hidden" name="item_id" value={item.id} />
                      <Button type="submit" variant="outline" size="sm" className="min-h-9 px-3">
                        Withdraw the suggestion
                      </Button>
                    </form>
                  )}
                  {(!sug || sug.status === "rejected") && (
                    <details className="mt-1.5">
                      <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-accent">
                        {sug ? "Suggest it again" : "Suggest this as a shared category"}
                      </summary>
                      <form action={suggestSharedCategory} className="mt-1.5">
                        <input type="hidden" name="item_id" value={item.id} />
                        <input type="hidden" name="slug" value={t} />
                        <div className={gridClass}>
                          <Field>
                            <label className={labelClass}>Name it as it should appear</label>
                            <input className={fieldClass} name="label" defaultValue={disciplineLabel(t)} required />
                          </Field>
                          <Field>
                            <label className={labelClass}>Which group it belongs in (your best guess)</label>
                            <select className={fieldClass} name="parent_slug" defaultValue="">
                              <option value="">Not sure</option>
                              {taxonomyGroups(taxonomy).map(({ group }) => <option key={group.slug} value={group.slug}>{group.label}</option>)}
                            </select>
                          </Field>
                        </div>
                        <Field>
                          <label className={labelClass}>What kind of work it covers (optional)</label>
                          <input className={fieldClass} name="note" placeholder="e.g. Hydrographic surveys of dams and harbours for DWS and TNPA" />
                        </Field>
                        <Button type="submit" variant="default" size="default" className="min-h-10 px-4">
                          Send for review
                        </Button>
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
          <ConfirmSubmitButton
            confirmMessage="Remove this experience item? This can't be undone."
            className="min-h-11 cursor-pointer rounded-lg border border-destructive/30 bg-destructive/10 px-4 text-xs font-semibold text-destructive"
          >
            Remove this item
          </ConfirmSubmitButton>
        </form>
      </div>
    </AppShell>
  );
}
