import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../_components/SiteNav";
import { ConfirmSubmitButton } from "../_components/ConfirmSubmitButton";
import { saveMyDetails, uploadMyCv, applyMyCvExtraction, discardMyCvExtraction } from "./actions";

export const instant = false;

const NAVY = "#16233B";
const AMBER = "#D97706";
const CREAM = "#F6F5F1";
const BORDER = "#E5E1D5";
const MUTED = "#6B6758";
const FAINT = "#9A9684";

const SAVED: Record<string, string> = {
  details: "Your details were saved.",
  cv: "CV uploaded.",
  extracted: "Fields saved to your record.",
};

const CV_UPLOAD_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  uploaded: { label: "Uploaded - used as-is", bg: "#DCFCE7", color: "#15803D" },
  extraction_requested: { label: "Waiting for AI extraction", bg: "#FEF3C7", color: "#B45309" },
  extracting: { label: "Reading the CV…", bg: "#FEF3C7", color: "#B45309" },
  extracted: { label: "Fields read - see below", bg: "#DCFCE7", color: "#15803D" },
  extraction_failed: { label: "Extraction failed", bg: "#FEE2E2", color: "#B91C1C" },
};

const GENERATED_CV_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  requested: { label: "Requested", bg: "#FEF3C7", color: "#B45309" },
  generating: { label: "Generating…", bg: "#FEF3C7", color: "#B45309" },
  ready: { label: "Ready", bg: "#DCFCE7", color: "#15803D" },
  failed: { label: "Failed", bg: "#FEE2E2", color: "#B91C1C" },
};

function Chip({ status }: { status?: { label: string; bg: string; color: string } }) {
  if (!status) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color, whiteSpace: "nowrap" }}>
      {status.label}
    </span>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#FFFFFF", border: `1px solid ${BORDER}`, borderRadius: 11, padding: "16px 18px", marginBottom: 14 }}>
      {title && <h2 style={{ fontSize: 13, fontWeight: 600, color: FAINT, textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 12px" }}>{title}</h2>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 14, fontFamily: "inherit", background: "#FFFFFF" };

function Field({ name, label, defaultValue, type = "text" }: { name: string; label: string; defaultValue?: string | null; type?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: NAVY, marginBottom: 5 }}>{label}</label>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} style={inputStyle} />
    </div>
  );
}

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default async function MyCvPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return null; // proxy.ts guards this route; this is just a type-safety fallback.
  }

  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  const companyId = membership?.company_id as string | undefined;

  const { data: person } = companyId
    ? await supabase.from("people").select(
        "id, name, phone, email, ecsa_level, ecsa_number, ecsa_expiry, sacpcmp_number, sacpcmp_expiry, highest_level, highest_description, highest_institution, highest_graduated",
      ).eq("company_id", companyId).eq("linked_user_id", user.id).maybeSingle()
    : { data: null };

  if (!person) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: CREAM }}>
        <SiteNav active="my-cv" />
        <div style={{ flex: 1, padding: "20px 16px 40px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: NAVY }}>My CV</h1>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
            No roster record is linked to your account yet. Ask an owner or admin of your company to link your account to your
            CV record (Company &rarr; Team), or to send you an invite tied to your name.
          </p>
        </div>
      </div>
    );
  }

  const personId = person.id as string;
  const [{ data: uploads }, { data: extractions }, { data: generated }, { data: projects }] = await Promise.all([
    supabase.from("cv_uploads").select("id, storage_path, original_filename, mode, status, created_at").eq("person_id", personId).order("created_at", { ascending: false }),
    supabase.from("cv_extraction_results").select("id, proposed, review_status, created_at").eq("person_id", personId).eq("review_status", "pending_review").order("created_at", { ascending: false }),
    supabase.from("generated_cvs").select("id, format, detail, status, storage_path_pdf, requested_at").eq("person_id", personId).order("requested_at", { ascending: false }),
    supabase.from("projects").select("id, client_and_number, position_held, start_date, end_date").eq("person_id", personId).order("start_date", { ascending: false }),
  ]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: CREAM }}>
      <SiteNav active="my-cv" />
      <div style={{ flex: 1, padding: "20px 16px 40px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: NAVY, margin: "0 0 6px" }}>My CV</h1>
        <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.55, marginBottom: 16 }}>
          Your own record only - {person.name}. Update your details, upload a CV, and see your generated CVs and project
          history below.
        </p>
        {saved && (
          <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#15803D" }}>
            {SAVED[saved] ?? "Saved."}
          </div>
        )}
        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            Could not save: {error}
          </div>
        )}

        <Card title="My details">
          <form action={saveMyDetails} autoComplete="off">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <Field name="phone" label="Phone" defaultValue={person.phone} />
              <Field name="email" label="Email" defaultValue={person.email} />
              <Field name="ecsa_level" label="ECSA level" defaultValue={person.ecsa_level} />
              <Field name="ecsa_number" label="ECSA number" defaultValue={person.ecsa_number} />
              <Field name="ecsa_expiry" label="ECSA expiry" type="date" defaultValue={person.ecsa_expiry} />
              <Field name="sacpcmp_number" label="SACPCMP number" defaultValue={person.sacpcmp_number} />
              <Field name="sacpcmp_expiry" label="SACPCMP expiry" type="date" defaultValue={person.sacpcmp_expiry} />
              <Field name="highest_level" label="Highest qualification level" defaultValue={person.highest_level} />
              <Field name="highest_description" label="Qualification" defaultValue={person.highest_description} />
              <Field name="highest_institution" label="Institution" defaultValue={person.highest_institution} />
              <Field name="highest_graduated" label="Graduated" type="date" defaultValue={person.highest_graduated} />
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="submit" style={{ minHeight: 44, padding: "0 18px", borderRadius: 9, background: AMBER, border: "none", color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Save changes
              </button>
            </div>
          </form>
        </Card>

        {(extractions ?? []).map((ex) => {
          const proposal = (ex.proposed as { person?: Record<string, { value: string | null; evidence?: string }> }).person ?? {};
          const fields = ["name", "ecsa_level", "ecsa_number", "ecsa_date", "sacpcmp_number", "sacpcmp_date", "highest_level", "highest_description", "highest_institution", "highest_graduated"];
          return (
            <Card key={ex.id} title="Review your AI-extracted CV">
              <form action={applyMyCvExtraction}>
                <input type="hidden" name="extraction_id" value={ex.id} />
                {fields.filter((f) => proposal[f]).map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                    <input type="checkbox" name={`use_${f}`} defaultChecked />
                    <div style={{ fontSize: 12, color: MUTED, width: 160, flexShrink: 0 }}>{f.replace(/_/g, " ")}</div>
                    <input name={`f_${f}`} defaultValue={proposal[f]?.value ?? ""} style={{ ...inputStyle, minHeight: 36 }} />
                  </div>
                ))}
                <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                  <button type="submit" style={{ minHeight: 40, padding: "0 16px", borderRadius: 9, background: AMBER, border: "none", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Save ticked fields
                  </button>
                </div>
              </form>
              <form action={discardMyCvExtraction} style={{ marginTop: 8 }}>
                <input type="hidden" name="extraction_id" value={ex.id} />
                <ConfirmSubmitButton
                  confirmMessage="Discard this extraction? Nothing will be saved."
                  style={{ minHeight: 36, padding: "0 14px", borderRadius: 9, background: "#FFFFFF", border: `1px solid ${BORDER}`, color: NAVY, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                >
                  Discard
                </ConfirmSubmitButton>
              </form>
            </Card>
          );
        })}

        <Card title="Upload a CV">
          <form action={uploadMyCv} encType="multipart/form-data">
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ fontSize: 13, color: NAVY }}>
                <input type="radio" name="mode" value="as_is" defaultChecked /> Use this file as-is
              </label>
              <label style={{ fontSize: 13, color: NAVY }}>
                <input type="radio" name="mode" value="ai_extract" /> Read my fields from it (AI-extract)
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <input type="file" name="file" required accept=".pdf,.doc,.docx" style={{ fontSize: 12, color: NAVY }} />
            </div>
            <div style={{ marginTop: 10 }}>
              <button type="submit" style={{ minHeight: 40, padding: "0 16px", borderRadius: 9, background: AMBER, border: "none", color: "#FFFFFF", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Upload
              </button>
            </div>
          </form>

          {(uploads ?? []).length > 0 && (
            <div style={{ marginTop: 14 }}>
              {(uploads ?? []).map((u) => (
                <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 13, color: NAVY }}>{u.original_filename}</div>
                  <Chip status={CV_UPLOAD_STATUS_LABEL[u.status]} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="My generated CVs (read-only)">
          {(generated ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: MUTED }}>None generated yet.</div>
          ) : (
            (generated ?? []).map((g) => (
              <div key={g.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 13, color: NAVY }}>
                  {g.format === "sanral_keyperson" ? "SANRAL key-person" : "World Bank"} - {g.detail}
                </div>
                <Chip status={GENERATED_CV_STATUS_LABEL[g.status]} />
              </div>
            ))
          )}
        </Card>

        <Card title="My project history (read-only)">
          {(projects ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: MUTED }}>No projects on file yet.</div>
          ) : (
            (projects ?? []).map((p) => (
              <div key={p.id} style={{ padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>{p.client_and_number}</div>
                <div style={{ fontSize: 12, color: MUTED }}>
                  {p.position_held ?? "—"} · {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}
