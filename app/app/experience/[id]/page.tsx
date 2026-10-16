import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
import { saveExperienceTags, deleteExperience } from "../actions";
import {
  DOCUMENT_TYPES,
  DISCIPLINES,
  CLIENT_TYPES,
  SERVICE_STAGES,
  PERFORMANCE_RATINGS,
  SANRAL_PROJECT_TYPES,
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
  searchParams: Promise<{ error?: string; saved?: string; captured?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, saved, captured } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("experience_items").select("*").eq("id", id).maybeSingle();
  const item = data as ExperienceItem | null;

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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {DISCIPLINES.map((d) => (
              <label key={d.value} style={checkLabel}>
                <input type="checkbox" name="disciplines" value={d.value} defaultChecked={item.disciplines.includes(d.value)} />
                {d.label}
              </label>
            ))}
          </div>
          <div className="exp-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field>
              <label style={label}>Project type</label>
              <input style={field} name="project_type" list="sanral-project-types" defaultValue={item.project_type ?? ""} placeholder="e.g. DS, RRM, MP/MS" />
              <datalist id="sanral-project-types">
                {SANRAL_PROJECT_TYPES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
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
