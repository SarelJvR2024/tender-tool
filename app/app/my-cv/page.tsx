import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { ConfirmSubmitButton } from "../_components/ConfirmSubmitButton";
import { saveMyDetails, uploadMyCv, applyMyCvExtraction, discardMyCvExtraction } from "./actions";

export const instant = false;

const SAVED: Record<string, string> = {
  details: "Your details were saved.",
  cv: "CV uploaded.",
  extracted: "Fields saved to your record.",
};

const CV_UPLOAD_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  uploaded: { label: "Uploaded - used as-is", className: "bg-success/10 text-success" },
  extraction_requested: { label: "Waiting for AI extraction", className: "bg-warning/10 text-warning" },
  extracting: { label: "Reading the CV…", className: "bg-warning/10 text-warning" },
  extracted: { label: "Fields read - see below", className: "bg-success/10 text-success" },
  extraction_failed: { label: "Extraction failed", className: "bg-destructive/10 text-destructive" },
};

const GENERATED_CV_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  requested: { label: "Requested", className: "bg-warning/10 text-warning" },
  generating: { label: "Generating…", className: "bg-warning/10 text-warning" },
  ready: { label: "Ready", className: "bg-success/10 text-success" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};

function Chip({ status }: { status?: { label: string; className: string } }) {
  if (!status) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${status.className}`}>
      {status.label}
    </span>
  );
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5 rounded-xl border border-border bg-card px-[18px] py-4">
      {title && <h2 className="m-0 mb-3 text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">{title}</h2>}
      {children}
    </div>
  );
}

const inputClass = "box-border w-full min-h-11 rounded-lg border border-border bg-card px-3 py-2.5 font-sans text-sm text-foreground";

function Field({ name, label, defaultValue, type = "text" }: { name: string; label: string; defaultValue?: string | null; type?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] font-semibold text-foreground">{label}</label>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} className={inputClass} />
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
      <AppShell>
        <div className="mx-auto box-border w-full max-w-[760px] flex-1 px-4 pt-5 pb-10">
          <h1 className="text-xl font-bold text-foreground">My CV</h1>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            No roster record is linked to your account yet. Ask an owner or admin of your company to link your account to your
            CV record (Company &rarr; Team), or to send you an invite tied to your name.
          </p>
        </div>
      </AppShell>
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
    <AppShell>
      <div className="mx-auto box-border w-full max-w-[760px] flex-1 px-4 pt-5 pb-10">
        <h1 className="mb-1.5 text-xl font-bold text-foreground">My CV</h1>
        <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
          Your own record only - {person.name}. Update your details, upload a CV, and see your generated CVs and project
          history below.
        </p>
        {saved && (
          <div className="mb-4 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-[13px] text-success">
            {SAVED[saved] ?? "Saved."}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            Could not save: {error}
          </div>
        )}

        <Card title="My details">
          <form action={saveMyDetails} autoComplete="off">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
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
            <div className="mt-3">
              <button type="submit" className="min-h-11 cursor-pointer rounded-lg border-none bg-accent px-[18px] text-sm font-semibold text-accent-foreground">
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
                  <div key={f} className="flex items-center gap-2.5 py-1.5">
                    <input type="checkbox" name={`use_${f}`} defaultChecked />
                    <div className="w-40 shrink-0 text-xs text-muted-foreground">{f.replace(/_/g, " ")}</div>
                    <input name={`f_${f}`} defaultValue={proposal[f]?.value ?? ""} className={`${inputClass} min-h-9`} />
                  </div>
                ))}
                <div className="mt-2.5 flex gap-2.5">
                  <button type="submit" className="min-h-10 cursor-pointer rounded-lg border-none bg-accent px-4 text-[13px] font-semibold text-accent-foreground">
                    Save ticked fields
                  </button>
                </div>
              </form>
              <form action={discardMyCvExtraction} className="mt-2">
                <input type="hidden" name="extraction_id" value={ex.id} />
                <ConfirmSubmitButton
                  confirmMessage="Discard this extraction? Nothing will be saved."
                  className="min-h-9 cursor-pointer rounded-lg border border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground"
                >
                  Discard
                </ConfirmSubmitButton>
              </form>
            </Card>
          );
        })}

        <Card title="Upload a CV">
          <form action={uploadMyCv} encType="multipart/form-data">
            <div className="flex flex-wrap items-center gap-3.5">
              <label className="text-[13px] text-foreground">
                <input type="radio" name="mode" value="as_is" defaultChecked /> Use this file as-is
              </label>
              <label className="text-[13px] text-foreground">
                <input type="radio" name="mode" value="ai_extract" /> Read my fields from it (AI-extract)
              </label>
            </div>
            <div className="mt-2.5">
              <input type="file" name="file" required accept=".pdf,.doc,.docx" className="text-xs text-foreground" />
            </div>
            <div className="mt-2.5">
              <button type="submit" className="min-h-10 cursor-pointer rounded-lg border-none bg-accent px-4 text-[13px] font-semibold text-accent-foreground">
                Upload
              </button>
            </div>
          </form>

          {(uploads ?? []).length > 0 && (
            <div className="mt-3.5">
              {(uploads ?? []).map((u) => (
                <div key={u.id} className="flex items-center justify-between border-b border-border py-2">
                  <div className="text-[13px] text-foreground">{u.original_filename}</div>
                  <Chip status={CV_UPLOAD_STATUS_LABEL[u.status]} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="My generated CVs (read-only)">
          {(generated ?? []).length === 0 ? (
            <div className="text-[13px] text-muted-foreground">None generated yet.</div>
          ) : (
            (generated ?? []).map((g) => (
              <div key={g.id} className="flex items-center justify-between border-b border-border py-2">
                <div className="text-[13px] text-foreground">
                  {g.format === "sanral_keyperson" ? "SANRAL key-person" : "World Bank"} - {g.detail}
                </div>
                <Chip status={GENERATED_CV_STATUS_LABEL[g.status]} />
              </div>
            ))
          )}
        </Card>

        <Card title="My project history (read-only)">
          {(projects ?? []).length === 0 ? (
            <div className="text-[13px] text-muted-foreground">No projects on file yet.</div>
          ) : (
            (projects ?? []).map((p) => (
              <div key={p.id} className="border-b border-border py-2">
                <div className="text-[13px] font-semibold text-foreground">{p.client_and_number}</div>
                <div className="text-xs text-muted-foreground">
                  {p.position_held ?? "—"} · {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
    </AppShell>
  );
}
