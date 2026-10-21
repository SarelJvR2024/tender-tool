import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { captureExperience } from "./actions";
import { expandDisciplines, loadDisciplineTaxonomy, taxonomyGroups, taxonomyLabel } from "@/lib/disciplineTaxonomy";
import {
  DOCUMENT_TYPES,
  findMatchingExperience,
  isScoreableEvidence,
  labelFor,
  type ExperienceItem,
} from "@/lib/experience";
import { PageHeader } from "@/components/tt/page-header";
import { EmptyState } from "@/components/tt/empty-state";
import { Button } from "@/components/ui/button";

// Per-request, under RLS - same escape hatch as people/page.tsx.
export const instant = false;

const fieldClass =
  "min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground";
const gridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2";
const cardClass = "mb-4 rounded-xl border border-border bg-card p-4";

type Tone = "success" | "warning" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

// Verify/Provide/Fix (app/AGENTS.md's product promise): "Needs tagging" and
// "No document" are genuine Provide-type gaps (an untagged or document-less
// item counts toward nothing until it's tagged/supplied) - relabelled with
// the real vocabulary. "Tagged"/"Rated X" describe a completed state with
// no outstanding action, so they stay plain descriptive chips (tone only,
// no Verify/Provide/Fix word) rather than being forced to say "Verify" for
// something that's already done and needs no further confirmation.
function Chip({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {text}
    </span>
  );
}

function yearsAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24 * 365.25);
}

export default async function ExperiencePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; discipline?: string }>;
}) {
  const { error: errorParam, discipline } = await searchParams;
  const supabase = await createClient();

  const { data: rows, error: loadError } = await supabase
    .from("experience_items")
    .select("*")
    .order("completion_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (loadError) console.error("experience_items select failed", loadError);
  const all = (rows ?? []) as ExperienceItem[];
  const companyId = all[0]?.company_id ?? null;

  // A discipline filter goes through the same experience_matches() query a
  // tender compliance check would use, so what this page shows is exactly
  // what a check would count (tagged items only).
  // The discipline list's groups (0040, the live discipline_categories
  // table) plus every tag this company actually uses - listed disciplines
  // and its own custom tags (0036). A group filter matches every discipline
  // in it, exactly as a tender check does (expandDisciplines).
  const taxonomy = await loadDisciplineTaxonomy(supabase);
  const disciplineOptions = Array.from(new Set([...taxonomyGroups(taxonomy).map((g) => g.group.slug), ...all.flatMap((i) => i.disciplines)]));
  const labelOf = (slug: string) => taxonomyLabel(taxonomy, slug);
  const activeDiscipline = discipline && disciplineOptions.includes(discipline) ? discipline : null;
  let filtered: ExperienceItem[] | null = null;
  let filterError: string | null = null;
  if (activeDiscipline && companyId) {
    const res = await findMatchingExperience(supabase, companyId, { disciplines: expandDisciplines(taxonomy, [activeDiscipline]) });
    filtered = res.items;
    filterError = res.error;
  } else if (activeDiscipline) {
    filtered = [];
  }

  const untagged = all.filter((e) => !e.tagged_at);
  const tagged = all.filter((e) => e.tagged_at);
  // SANRAL Form B6: 3 completed projects, last 10 years, evidenced by a
  // reference letter or CIDB performance report (Experience-Library-Findings.md).
  const b6Ready = tagged.filter((e) => {
    const y = yearsAgo(e.completion_date);
    return y !== null && y >= 0 && y <= 10 && isScoreableEvidence(e.document_type) && !!e.storage_path;
  }).length;

  const shown = filtered ?? all;
  const signedUrls: Record<string, string> = {};
  const paths = shown.map((e) => e.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const results = await Promise.all(paths.map((p) => supabase.storage.from("experience-documents").createSignedUrl(p, 600)));
    results.forEach((r, i) => {
      if (r.data?.signedUrl) signedUrls[paths[i]] = r.data.signedUrl;
    });
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6 pb-10">
        <PageHeader
          className="mb-4"
          title="Company experience"
          description="Reference letters, performance reports, completion certificates, close-out reports and award letters that prove what the company has delivered. Upload the document, then tag what it shows so tenders can be matched against it."
        />

        {(errorParam || loadError || filterError) && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorParam ? decodeURIComponent(errorParam) : `Could not load experience: ${loadError?.message ?? filterError}`}
          </div>
        )}

        {/* Readiness against the one experience requirement seen in real tenders */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="max-w-[520px]">
            <div className="text-sm font-semibold text-foreground">
              Past-performance evidence: {b6Ready} of 3
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              SANRAL Form B6 (15 of 100 functionality points) asks for 3 completed projects of similar
              scope in the last 10 years, each with a signed reference letter or CIDB performance report.
              Fewer means a sworn affidavit and a default &quot;Adequate&quot; score.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip text={b6Ready >= 3 ? "Enough on file" : `Provide - ${3 - Math.min(b6Ready, 3)} more needed`} tone={b6Ready >= 3 ? "success" : "warning"} />
            {untagged.length > 0 && <Chip text={`Provide - ${untagged.length} need tagging`} tone="warning" />}
          </div>
        </div>

        {/* Step 1: capture */}
        <form action={captureExperience} className={cardClass}>
          <div className="mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Add experience
          </div>
          <div className={gridClass}>
            <div>
              <label className={labelClass}>Project name *</label>
              <input className={fieldClass} name="project_name" required placeholder="As the client's letter names it" />
            </div>
            <div>
              <label className={labelClass}>Document type *</label>
              {/* No pre-selected type (form-field audit 2026-10-18): it used to
                  default to "Reference letter", which SANRAL's Form B6 scores -
                  a completion certificate left on the default was counted as
                  scoreable evidence. */}
              <select className={fieldClass} name="document_type" defaultValue="" required>
                <option value="" disabled>Choose…</option>
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <label className={labelClass}>Document (PDF, Word or scan - up to 4.4 MB)</label>
            <input className={`${fieldClass} pt-2.5`} type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
          </div>
          <Button type="submit" variant="accent" size="lg" className="mt-3 min-h-11 px-5">
            Upload &amp; tag
          </Button>
        </form>

        {/* Discipline filter - runs experience_matches() */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterLink href="/experience" active={!activeDiscipline} text="All" />
          {disciplineOptions.map((v) => (
            <FilterLink key={v} href={`/experience?discipline=${encodeURIComponent(v)}`} active={activeDiscipline === v} text={labelOf(v)} />
          ))}
        </div>
        {activeDiscipline && (
          <div className="mb-2.5 text-xs text-muted-foreground">
            Tagged items matching {labelOf(activeDiscipline)}{taxonomyGroups(taxonomy).some((g) => g.group.slug === activeDiscipline) ? " (any discipline in this group)" : ""} - the same query a tender check uses. Untagged uploads never count.
          </div>
        )}

        {shown.length === 0 && !loadError && (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState
              icon={FolderOpen}
              title={activeDiscipline ? "No tagged experience in this discipline yet" : "No experience on file yet"}
              description={activeDiscipline ? undefined : "Start with the reference letters and completion certificates you already have."}
            />
          </div>
        )}

        {(filtered ?? [...untagged, ...tagged]).map((e) => (
          <ExperienceRow key={e.id} item={e} url={e.storage_path ? signedUrls[e.storage_path] : undefined} labelOf={labelOf} />
        ))}
      </div>
    </AppShell>
  );
}

function FilterLink({ href, active, text }: { href: string; active: boolean; text: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold no-underline ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
      }`}
    >
      {text}
    </Link>
  );
}

function ExperienceRow({ item: e, url, labelOf }: { item: ExperienceItem; url?: string; labelOf: (slug: string) => string }) {
  const meta = [
    e.client_name,
    e.client_type,
    e.project_type,
    e.value_rm != null ? `R${e.value_rm}m` : null,
    e.completion_date ? `completed ${e.completion_date}` : null,
  ].filter(Boolean);

  return (
    <div className="mb-2.5 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0 flex-[1_1_320px]">
          <Link href={`/experience/${e.id}`} className="text-sm font-bold text-foreground no-underline">
            {e.project_name}
          </Link>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {labelFor(DOCUMENT_TYPES, e.document_type)}
            {meta.length > 0 && ` · ${meta.join(" · ")}`}
          </div>
          {e.tagged_at && e.disciplines.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {e.disciplines.map((d) => (
                <Chip key={d} text={labelOf(d)} tone="muted" />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {!e.tagged_at ? (
            <Chip text="Provide - needs tagging" tone="warning" />
          ) : e.performance_rating ? (
            <Chip text={`Rated ${e.performance_rating}`} tone={e.performance_rating === "poor" ? "warning" : "success"} />
          ) : (
            <Chip text="Tagged" tone="success" />
          )}
          {!e.storage_path && <Chip text="Provide - no document" tone="warning" />}
          {url && (
            <a href={url} className="text-xs font-semibold text-accent">Download</a>
          )}
          <Link href={`/experience/${e.id}`} className="text-xs font-semibold text-accent">
            {e.tagged_at ? "Edit tags" : "Tag now"}
          </Link>
        </div>
      </div>
    </div>
  );
}
