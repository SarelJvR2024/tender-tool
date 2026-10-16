import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { savePerson, deletePerson, saveProject, deleteProject } from "../actions";

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
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam } = await searchParams;
  const isNew = id === "new";
  const supabase = await createClient();

  let person: Person | null = null;
  let projects: Project[] = [];

  if (!isNew) {
    const { data } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
    person = data as Person | null;

    const { data: projectRows } = await supabase
      .from("projects")
      .select("*")
      .eq("person_id", id)
      .order("start_date", { ascending: false });
    projects = (projectRows ?? []) as Project[];
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 32px", background: "#16233B", color: "#FFFFFF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#16233B" }}>T</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Tender Tool</div>
        </div>
        <Link href="/people" style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", textDecoration: "none" }}>
          ← People
        </Link>
      </div>

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
