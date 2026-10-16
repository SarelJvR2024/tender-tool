import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { savePerson, deletePerson, saveProject, deleteProject, uploadCv, saveRoleEligibility } from "../actions";
import { SiteNav } from "../../_components/SiteNav";
import { ROLE_FAMILY_LABEL, ROLE_FAMILY_ORDER, TENDER_ROLE_COLUMNS, type TenderRole } from "@/lib/tenderRoles";

// Per-request: loads one real person's record (or a blank "new" form) under
// RLS. Same Cache Components escape hatch as dashboard/page.tsx and ../page.tsx.
export const instant = false;

type Person = {
  id: string;
  name: string;
  id_number: string | null;
  description: string | null;
  role: string | null;
  signatory_capacity: string | null;
  phone: string | null;
  email: string | null;
  ecsa_level: string | null;
  ecsa_number: string | null;
  ecsa_date: string | null;
  sacpcmp_number: string | null;
  sacpcmp_date: string | null;
  highest_level: string | null;
  highest_description: string | null;
  highest_institution: string | null;
  highest_graduated: string | null;
  initial_description: string | null;
  initial_institution: string | null;
  initial_graduated: string | null;
};

type CvUpload = {
  id: string;
  storage_path: string;
  original_filename: string;
  mode: "as_is" | "ai_extract";
  status: string;
  created_at: string;
};

type GeneratedCv = {
  id: string;
  format: "sanral_keyperson" | "world_bank";
  detail: "summary" | "detailed";
  status: string;
  storage_path_docx: string | null;
  storage_path_pdf: string | null;
  error_message: string | null;
  tender_id: string | null;
  requested_at: string;
};

const CV_UPLOAD_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  uploaded: { label: "Uploaded - used as-is", bg: "#DCFCE7", color: "#15803D" },
  extraction_requested: { label: "AI extraction requested", bg: "#FEF3C7", color: "#B45309" },
  extracting: { label: "Extracting…", bg: "#FEF3C7", color: "#B45309" },
  extracted: { label: "Extracted - review fields above", bg: "#DCFCE7", color: "#15803D" },
  extraction_failed: { label: "Extraction failed", bg: "#FEE2E2", color: "#B91C1C" },
};

const GENERATED_CV_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  requested: { label: "Requested", bg: "#FEF3C7", color: "#B45309" },
  generating: { label: "Generating…", bg: "#FEF3C7", color: "#B45309" },
  ready: { label: "Ready", bg: "#DCFCE7", color: "#15803D" },
  failed: { label: "Failed", bg: "#FEE2E2", color: "#B91C1C" },
};

const CV_FORMAT_LABEL: Record<string, string> = {
  sanral_keyperson: "SANRAL key-person (Form B1.1/B2.1 shape)",
  world_bank: "World Bank format",
};

type Project = {
  id: string;
  client_and_number: string;
  client_type: string | null;
  project_type: string | null;
  position_code: string | null;
  position_held: string | null;
  value_rm: number | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  start_date: string | null;
  end_date: string | null;
  contact_match_confidence: string | null;
  source_note: string | null;
};

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "0 12px",
  borderRadius: 9, border: "1px solid #E5E1D5", fontSize: 14, fontFamily: "system-ui, sans-serif",
  color: "#16233B", background: "#FFFFFF",
};
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B6758", marginBottom: 4, display: "block" };

function Field({ children }: { children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}>{children}</div>;
}

// Computed on demand, as of today - never stored. Mirrors
// engine/pack_generator/suggest_pack.py's years_experience_at(), which computes it
// relative to a specific tender's closing date instead; this is just "as of today"
// for display on this page, and is labelled as such.
function yearsSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24 * 365.25));
}

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; roles_saved?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, roles_saved: rolesSaved } = await searchParams;
  const isNew = id === "new";
  const supabase = await createClient();

  let person: Person | null = null;
  let projects: Project[] = [];
  let cvUploads: CvUpload[] = [];
  let generatedCvs: GeneratedCv[] = [];
  let signedUrls: Record<string, string> = {};
  let roleCatalog: TenderRole[] = [];
  let taggedRoles = new Set<string>();
  let rolesError: string | null = null;

  if (!isNew) {
    const { data } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
    person = data as Person | null;

    // Tender role catalog + this person's tags (migration 0016).
    const [{ data: roleRows, error: roleErr }, { data: tagRows }] = await Promise.all([
      supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS).order("sort_order"),
      supabase.from("person_role_eligibility").select("role_code").eq("person_id", id),
    ]);
    roleCatalog = (roleRows ?? []) as TenderRole[];
    taggedRoles = new Set((tagRows ?? []).map((r) => r.role_code as string));
    rolesError = roleErr?.message ?? null;

    const { data: projectRows } = await supabase
      .from("projects")
      .select("*")
      .eq("person_id", id)
      .order("start_date", { ascending: false });
    projects = (projectRows ?? []) as Project[];

    const { data: uploadRows } = await supabase
      .from("cv_uploads")
      .select("id, storage_path, original_filename, mode, status, created_at")
      .eq("person_id", id)
      .order("created_at", { ascending: false });
    cvUploads = (uploadRows ?? []) as CvUpload[];

    // Standard (non-tender-specific) CVs only here - tender_id is null.
    // Tender-customized CVs are requested and shown on that tender's own
    // Workspace page (app/app/tenders/[id]/page.tsx), not duplicated here.
    const { data: genRows } = await supabase
      .from("generated_cvs")
      .select("id, format, detail, status, storage_path_docx, storage_path_pdf, error_message, tender_id, requested_at")
      .eq("person_id", id)
      .is("tender_id", null)
      .order("requested_at", { ascending: false });
    generatedCvs = (genRows ?? []) as GeneratedCv[];

    // Signed URLs for anything actually downloadable (private bucket) -
    // generated once at render time, short-lived, never stored.
    const paths = [
      ...cvUploads.map((u) => u.storage_path),
      ...generatedCvs.flatMap((g) => [g.storage_path_docx, g.storage_path_pdf].filter((p): p is string => !!p)),
    ];
    if (paths.length > 0) {
      const results = await Promise.all(
        paths.map((p) => supabase.storage.from("cv-documents").createSignedUrl(p, 600))
      );
      signedUrls = Object.fromEntries(
        results.map((r, i) => [paths[i], r.data?.signedUrl ?? ""]).filter(([, url]) => url)
      );
    }
  }

  if (!isNew && !person) {
    return (
      <div style={{ padding: 32, fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#B91C1C" }}>Person not found, or you don&apos;t have access to this record.</p>
        <Link href="/people">← Back to People</Link>
      </div>
    );
  }

  const yearsFromInitial = yearsSince(person?.initial_graduated ?? null);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <style>{`
        @media (max-width: 600px) {
          .person-grid-2 { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <SiteNav active="people" />

      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>
          {isNew ? "Add person" : person!.name}
        </h1>
        <div style={{ fontSize: 13, color: "#6B6758", marginBottom: 16 }}>
          Real ID and registration numbers are stored for official SANRAL forms only - handle with care.
        </div>

        {errorParam && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            {decodeURIComponent(errorParam)}
          </div>
        )}

        <form action={savePerson} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "18px 16px", marginBottom: 20 }}>
          <input type="hidden" name="id" value={isNew ? "new" : person!.id} />

          <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
            Identity
          </div>
          <div className="person-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>Full name *</label><input style={field} name="name" defaultValue={person?.name ?? ""} required /></Field>
            <Field>
              <label style={label}>ID number (PII - masked)</label>
              <input style={field} type="password" autoComplete="off" name="id_number" defaultValue={person?.id_number ?? ""} />
            </Field>
            <Field><label style={label}>Role / job title</label><input style={field} name="role" defaultValue={person?.role ?? ""} placeholder="e.g. Contracts Engineer" /></Field>
            <Field><label style={label}>Description (position type)</label><input style={field} name="description" defaultValue={person?.description ?? ""} /></Field>
            <Field><label style={label}>Signatory capacity</label><input style={field} name="signatory_capacity" defaultValue={person?.signatory_capacity ?? ""} /></Field>
            <Field><label style={label}>Phone</label><input style={field} name="phone" defaultValue={person?.phone ?? ""} /></Field>
            <Field><label style={label}>Email</label><input style={field} type="email" name="email" defaultValue={person?.email ?? ""} /></Field>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 10px" }}>
            Registrations
          </div>
          <div className="person-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>ECSA level</label><input style={field} name="ecsa_level" defaultValue={person?.ecsa_level ?? ""} placeholder="e.g. Professional Engineer" /></Field>
            <Field><label style={label}>ECSA number</label><input style={field} name="ecsa_number" defaultValue={person?.ecsa_number ?? ""} /></Field>
            <Field><label style={label}>ECSA registration date</label><input style={field} type="date" name="ecsa_date" defaultValue={person?.ecsa_date ?? ""} /></Field>
            <Field><label style={label}>SACPCMP number</label><input style={field} name="sacpcmp_number" defaultValue={person?.sacpcmp_number ?? ""} /></Field>
            <Field><label style={label}>SACPCMP registration date</label><input style={field} type="date" name="sacpcmp_date" defaultValue={person?.sacpcmp_date ?? ""} /></Field>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", margin: "16px 0 10px" }}>
            Qualifications
          </div>
          <div style={{ fontSize: 12, color: "#9A9684", marginBottom: 10 }}>
            Years of experience is never stored here - the pack-matching engine computes it
            from the initial-qualification date relative to each tender&apos;s own closing date.
            {yearsFromInitial !== null && ` (As of today, that would be about ${yearsFromInitial} years.)`}
          </div>
          <div className="person-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field><label style={label}>Highest qualification level</label><input style={field} name="highest_level" defaultValue={person?.highest_level ?? ""} placeholder="e.g. Masters Degree" /></Field>
            <Field><label style={label}>Highest qualification</label><input style={field} name="highest_description" defaultValue={person?.highest_description ?? ""} placeholder="e.g. MEng (Civil Engineering)" /></Field>
            <Field><label style={label}>Institution (highest)</label><input style={field} name="highest_institution" defaultValue={person?.highest_institution ?? ""} /></Field>
            <Field><label style={label}>Date graduated (highest)</label><input style={field} type="date" name="highest_graduated" defaultValue={person?.highest_graduated ?? ""} /></Field>
            <Field><label style={label}>Initial qualification</label><input style={field} name="initial_description" defaultValue={person?.initial_description ?? ""} placeholder="e.g. BEng (Civil Engineering)" /></Field>
            <Field><label style={label}>Institution (initial)</label><input style={field} name="initial_institution" defaultValue={person?.initial_institution ?? ""} /></Field>
            <Field><label style={label}>Date graduated (initial)</label><input style={field} type="date" name="initial_graduated" defaultValue={person?.initial_graduated ?? ""} /></Field>
          </div>

          <button
            type="submit"
            style={{
              marginTop: 8, minHeight: 44, padding: "0 20px", borderRadius: 10,
              background: "#16233B", color: "#FFFFFF", fontWeight: 600, fontSize: 14,
              border: "none", cursor: "pointer",
            }}
          >
            {isNew ? "Add person" : "Save changes"}
          </button>
        </form>

        {!isNew && (
          <form action={deletePerson} style={{ marginBottom: 28 }}>
            <input type="hidden" name="id" value={person!.id} />
            <button
              type="submit"
              style={{
                minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#FEE2E2",
                color: "#B91C1C", fontWeight: 600, fontSize: 13, border: "1px solid #FCA5A5", cursor: "pointer",
              }}
            >
              Remove person
            </button>
          </form>
        )}

        {!isNew && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>
              Tender roles this CV qualifies for
            </h2>
            <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
              Your company decides which tender roles {person!.name}&apos;s CV fits - Tender Tool uses this tag on each
              tender&apos;s compliance check instead of guessing from years of experience or registration. The roles are the
              ones real tenders ask for: SANRAL&apos;s Book 1 key-person codes (a Design Specialist is tendered per
              specialism) and the key personnel other buyers name. Hover a role to see which tender it came from.
            </div>
            {rolesSaved === "1" && (
              <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "9px 14px", marginBottom: 12, fontSize: 13, color: "#15803D" }}>
                Role tags saved.
              </div>
            )}
            {rolesError ? (
              <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "9px 14px", marginBottom: 20, fontSize: 12, color: "#92400E" }}>
                Couldn&apos;t load the role catalog ({rolesError}) - migration 0016 may not be applied yet.
              </div>
            ) : (
              <form action={saveRoleEligibility} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", marginBottom: 24 }}>
                <input type="hidden" name="person_id" value={person!.id} />
                <div style={{ fontSize: 12, color: "#16233B", marginBottom: 8 }}>
                  {taggedRoles.size === 0
                    ? "Not tagged for any role yet."
                    : `Tagged for: ${roleCatalog.filter((r) => taggedRoles.has(r.code)).map((r) => r.title).join(", ")}.`}
                </div>
                {ROLE_FAMILY_ORDER.map((family) => {
                  const familyRoles = roleCatalog.filter((r) => r.family === family);
                  if (familyRoles.length === 0) return null;
                  const count = familyRoles.filter((r) => taggedRoles.has(r.code)).length;
                  return (
                    <details key={family} open={count > 0 || family === "sanral_consultant"} style={{ borderTop: "1px solid #F0EEE6", padding: "8px 0" }}>
                      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#16233B" }}>
                        {ROLE_FAMILY_LABEL[family] ?? family}
                        {count > 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#15803D", background: "#DCFCE7", borderRadius: 100, padding: "2px 8px" }}>{count} tagged</span>}
                      </summary>
                      <div className="person-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginTop: 8 }}>
                        {familyRoles.map((r) => (
                          <label key={r.code} title={r.source} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "#16233B", minHeight: 32 }}>
                            <input type="checkbox" name="role_code" value={r.code} defaultChecked={taggedRoles.has(r.code)} style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }} />
                            <span>
                              {r.title}
                              {r.registration_body && <span style={{ color: "#9A9684", fontSize: 11 }}> · {r.registration_body}</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })}
                <button
                  type="submit"
                  style={{ marginTop: 10, minHeight: 44, padding: "0 18px", borderRadius: 10, background: "#16233B", color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
                >
                  Save role tags
                </button>
              </form>
            )}

            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>
              CV documents
            </h2>
            <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
              Upload {person!.name}&apos;s CV once. Choose <strong>use as-is</strong> to attach
              the exact file to submissions with no AI involvement, or{" "}
              <strong>AI-extract</strong> to also queue the standard CV template formats so
              they&apos;re ready to view here any time - see docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md.
            </div>

            <form
              action={uploadCv}
              encType="multipart/form-data"
              style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", marginBottom: 16 }}
            >
              <input type="hidden" name="person_id" value={person!.id} />
              <Field>
                <label style={label}>CV file</label>
                <input style={field} type="file" name="file" required accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
              </Field>
              <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, color: "#16233B", maxWidth: 320 }}>
                  <input type="radio" name="mode" value="ai_extract" defaultChecked style={{ marginTop: 3 }} />
                  <span>
                    <strong>AI-extract</strong> the fields and pre-generate the standard CV
                    formats right away.
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, color: "#16233B", maxWidth: 320 }}>
                  <input type="radio" name="mode" value="as_is" style={{ marginTop: 3 }} />
                  <span>
                    <strong>Use as-is</strong> - attach this exact file to submissions, no AI
                    involvement at all.
                  </span>
                </label>
              </div>
              <button
                type="submit"
                style={{ minHeight: 44, padding: "0 18px", borderRadius: 10, background: "#D97706", color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
              >
                Upload CV
              </button>
            </form>

            {cvUploads.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {cvUploads.map((u) => {
                  const st = CV_UPLOAD_STATUS_LABEL[u.status] ?? { label: u.status, bg: "#F0EEE6", color: "#6B6758" };
                  const url = signedUrls[u.storage_path];
                  return (
                    <div key={u.id} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "10px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>{u.original_filename}</div>
                        <div style={{ fontSize: 11, color: "#9A9684", marginTop: 2 }}>
                          {u.mode === "as_is" ? "Use as-is" : "AI-extract"} · {new Date(u.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                        {url && (
                          <a href={url} style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>
                            Download
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {generatedCvs.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#9A9684", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Standard generated CVs
                </div>
                <div style={{ fontSize: 11, color: "#9A9684", marginBottom: 8 }}>
                  Fulfilled out-of-band by engine/cv/process_cv_jobs.py (the web app cannot run
                  Python/LibreOffice) - status updates here once that process runs.
                </div>
                {generatedCvs.map((g) => {
                  const st = GENERATED_CV_STATUS_LABEL[g.status] ?? { label: g.status, bg: "#F0EEE6", color: "#6B6758" };
                  const docxUrl = g.storage_path_docx ? signedUrls[g.storage_path_docx] : null;
                  const pdfUrl = g.storage_path_pdf ? signedUrls[g.storage_path_pdf] : null;
                  return (
                    <div key={g.id} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "10px 16px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>
                          {CV_FORMAT_LABEL[g.format] ?? g.format} · {g.detail}
                        </div>
                        {g.error_message && (
                          <div style={{ fontSize: 11, color: "#B91C1C", marginTop: 2 }}>{g.error_message}</div>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                        {docxUrl && <a href={docxUrl} style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>Word</a>}
                        {pdfUrl && <a href={pdfUrl} style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>PDF</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <h2 style={{ fontSize: 16, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>
              Project / reference history
            </h2>
            <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
              Used by the pack-matching engine to score this person against a tender&apos;s key positions
              (see engine/pack_generator/suggest_pack.py).
            </div>

            {projects.length === 0 && (
              <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", fontSize: 13, color: "#6B6758", marginBottom: 16 }}>
                No project history on file yet for {person!.name}.
              </div>
            )}

            {projects.map((proj) => (
              <div key={proj.id} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "12px 16px", marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B", whiteSpace: "pre-line" }}>{proj.client_and_number}</div>
                    <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>
                      {proj.position_held || proj.position_code || "Position not set"}
                      {proj.value_rm != null && ` · R${proj.value_rm}m`}
                    </div>
                    <div style={{ fontSize: 11, color: "#9A9684", marginTop: 2 }}>
                      {proj.start_date ?? "?"} – {proj.end_date ?? "ongoing"}
                      {proj.contact_match_confidence && ` · referee match: ${proj.contact_match_confidence}`}
                    </div>
                  </div>
                  <form action={deleteProject}>
                    <input type="hidden" name="project_id" value={proj.id} />
                    <input type="hidden" name="person_id" value={person!.id} />
                    <button type="submit" style={{ minHeight: 36, padding: "0 10px", borderRadius: 8, background: "#FEE2E2", color: "#B91C1C", fontSize: 11, fontWeight: 600, border: "1px solid #FCA5A5", cursor: "pointer" }}>
                      Remove
                    </button>
                  </form>
                </div>
              </div>
            ))}

            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#D97706", padding: "8px 0" }}>
                + Add a project to this person&apos;s history
              </summary>
              <form action={saveProject} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", marginTop: 8 }}>
                <input type="hidden" name="person_id" value={person!.id} />
                <div className="person-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field><label style={label}>Client and contract number *</label><input style={field} name="client_and_number" placeholder={"e.g. ACSA (OR Tambo)\\nORT5737/2018/RFP"} required /></Field>
                  <Field><label style={label}>Client type</label><input style={field} name="client_type" placeholder="e.g. Relevant SOE" /></Field>
                  <Field><label style={label}>Project type</label><input style={field} name="project_type" placeholder="e.g. DS" /></Field>
                  <Field><label style={label}>Position code</label><input style={field} name="position_code" placeholder="e.g. CE" /></Field>
                  <Field><label style={label}>Position held</label><input style={field} name="position_held" placeholder="e.g. Contract Engineer" /></Field>
                  <Field><label style={label}>Value (R million)</label><input style={field} type="number" step="0.01" name="value_rm" /></Field>
                  <Field><label style={label}>Referee name</label><input style={field} name="contact_name" /></Field>
                  <Field><label style={label}>Referee phone</label><input style={field} name="contact_phone" /></Field>
                  <Field><label style={label}>Referee email</label><input style={field} type="email" name="contact_email" /></Field>
                  <Field><label style={label}>Start date</label><input style={field} type="date" name="start_date" /></Field>
                  <Field><label style={label}>End date</label><input style={field} type="date" name="end_date" /></Field>
                  <Field>
                    <label style={label}>Referee match confidence</label>
                    <select style={field} name="contact_match_confidence" defaultValue="unconfirmed">
                      <option value="confirmed">Confirmed</option>
                      <option value="partially_confirmed">Partially confirmed</option>
                      <option value="unconfirmed">Unconfirmed</option>
                      <option value="missing">Missing</option>
                    </select>
                  </Field>
                </div>
                <Field><label style={label}>Source note</label><input style={field} name="source_note" placeholder="Where this was confirmed from" /></Field>
                <button
                  type="submit"
                  style={{ minHeight: 44, padding: "0 18px", borderRadius: 10, background: "#16233B", color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
                >
                  Add project
                </button>
              </form>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
