import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../_components/SiteNav";
import { captureExperience } from "./actions";
import {
  DOCUMENT_TYPES,
  DISCIPLINES,
  findMatchingExperience,
  isScoreableEvidence,
  labelFor,
  disciplineLabel,
  type ExperienceItem,
} from "@/lib/experience";

// Per-request, under RLS - same escape hatch as people/page.tsx.
export const instant = false;

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 12px",
  borderRadius: 9, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "system-ui, sans-serif",
  color: "#16233B", background: "#FFFFFF",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B6758", marginBottom: 4, display: "block" };

const GREEN = { bg: "#DCFCE7", color: "#15803D" };
const AMBER = { bg: "#FEF3C7", color: "#B45309" };
const GREY = { bg: "#F0EEE6", color: "#6B6758" };

function Chip({ text, tone }: { text: string; tone: { bg: string; color: string } }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: tone.bg, color: tone.color, whiteSpace: "nowrap" }}>
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
  const all = (rows ?? []) as ExperienceItem[];
  const companyId = all[0]?.company_id ?? null;

  // A discipline filter goes through the same experience_matches() query a
  // tender compliance check would use, so what this page shows is exactly
  // what a check would count (tagged items only).
  // Suggested disciplines plus any custom tags this company uses (0036).
  const disciplineOptions = Array.from(new Set([...DISCIPLINES.map((d) => d.value as string), ...all.flatMap((i) => i.disciplines)]));
  const activeDiscipline = discipline && disciplineOptions.includes(discipline) ? discipline : null;
  let filtered: ExperienceItem[] | null = null;
  let filterError: string | null = null;
  if (activeDiscipline && companyId) {
    const res = await findMatchingExperience(supabase, companyId, { disciplines: [activeDiscipline] });
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
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <style>{`
        @media (max-width: 600px) {
          .exp-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <SiteNav active="experience" />

      <div style={{ flex: 1, padding: "24px 16px 40px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: 0 }}>Company experience</h1>
        <div style={{ fontSize: 13, color: "#6B6758", marginTop: 2, marginBottom: 16 }}>
          Reference letters, performance reports, completion certificates, close-out reports and award
          letters that prove what the company has delivered. Upload the document, then tag what it shows
          so tenders can be matched against it.
        </div>

        {(errorParam || loadError || filterError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            {errorParam ? decodeURIComponent(errorParam) : `Could not load experience: ${loadError?.message ?? filterError}`}
          </div>
        )}

        {/* Readiness against the one experience requirement seen in real tenders */}
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B" }}>
              Past-performance evidence: {b6Ready} of 3
            </div>
            <div style={{ fontSize: 12, color: "#6B6758", marginTop: 2 }}>
              SANRAL Form B6 (15 of 100 functionality points) asks for 3 completed projects of similar
              scope in the last 10 years, each with a signed reference letter or CIDB performance report.
              Fewer means a sworn affidavit and a default &quot;Adequate&quot; score.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Chip text={b6Ready >= 3 ? "Enough on file" : `${3 - Math.min(b6Ready, 3)} more needed`} tone={b6Ready >= 3 ? GREEN : AMBER} />
            {untagged.length > 0 && <Chip text={`${untagged.length} need tagging`} tone={AMBER} />}
          </div>
        </div>

        {/* Step 1: capture */}
        <form
          action={captureExperience}
          style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", marginBottom: 20 }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            Add experience
          </div>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={label}>Project name *</label>
              <input style={field} name="project_name" required placeholder="As the client's letter names it" />
            </div>
            <div>
              <label style={label}>Document type *</label>
              <select style={field} name="document_type" defaultValue="reference_letter">
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={label}>Document (PDF, Word or scan - up to 4.4 MB)</label>
            <input style={{ ...field, paddingTop: 10 }} type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
          </div>
          <button
            type="submit"
            style={{ marginTop: 12, minHeight: 44, padding: "0 18px", borderRadius: 10, background: "#D97706", color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
          >
            Upload &amp; tag
          </button>
        </form>

        {/* Discipline filter - runs experience_matches() */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <FilterLink href="/experience" active={!activeDiscipline} text="All" />
          {disciplineOptions.map((v) => (
            <FilterLink key={v} href={`/experience?discipline=${encodeURIComponent(v)}`} active={activeDiscipline === v} text={disciplineLabel(v)} />
          ))}
        </div>
        {activeDiscipline && (
          <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
            Tagged items matching {disciplineLabel(activeDiscipline)} - the same query a tender check uses. Untagged uploads never count.
          </div>
        )}

        {shown.length === 0 && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", fontSize: 13, color: "#6B6758" }}>
            {activeDiscipline
              ? "No tagged experience in this discipline yet."
              : "No experience on file yet. Start with the reference letters and completion certificates you already have."}
          </div>
        )}

        {(filtered ?? [...untagged, ...tagged]).map((e) => (
          <ExperienceRow key={e.id} item={e} url={e.storage_path ? signedUrls[e.storage_path] : undefined} />
        ))}
      </div>
    </div>
  );
}

function FilterLink({ href, active, text }: { href: string; active: boolean; text: string }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-flex", alignItems: "center", minHeight: 32, padding: "0 12px", borderRadius: 100,
        fontSize: 12, fontWeight: 600, textDecoration: "none",
        background: active ? "#16233B" : "#FFFFFF", color: active ? "#FFFFFF" : "#16233B",
        border: active ? "1px solid #16233B" : "1px solid #E5E1D5",
      }}
    >
      {text}
    </Link>
  );
}

function ExperienceRow({ item: e, url }: { item: ExperienceItem; url?: string }) {
  const meta = [
    e.client_name,
    e.client_type,
    e.project_type,
    e.value_rm != null ? `R${e.value_rm}m` : null,
    e.completion_date ? `completed ${e.completion_date}` : null,
  ].filter(Boolean);

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "12px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <Link href={`/experience/${e.id}`} style={{ fontSize: 14, fontWeight: 700, color: "#16233B", textDecoration: "none" }}>
            {e.project_name}
          </Link>
          <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>
            {labelFor(DOCUMENT_TYPES, e.document_type)}
            {meta.length > 0 && ` · ${meta.join(" · ")}`}
          </div>
          {e.tagged_at && e.disciplines.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {e.disciplines.map((d) => (
                <Chip key={d} text={disciplineLabel(d)} tone={GREY} />
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {!e.tagged_at ? (
            <Chip text="Needs tagging" tone={AMBER} />
          ) : e.performance_rating ? (
            <Chip text={`Rated ${e.performance_rating}`} tone={e.performance_rating === "poor" ? AMBER : GREEN} />
          ) : (
            <Chip text="Tagged" tone={GREEN} />
          )}
          {!e.storage_path && <Chip text="No document" tone={AMBER} />}
          {url && (
            <a href={url} style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>Download</a>
          )}
          <Link href={`/experience/${e.id}`} style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>
            {e.tagged_at ? "Edit tags" : "Tag now"}
          </Link>
        </div>
      </div>
    </div>
  );
}
