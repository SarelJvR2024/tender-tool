import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { ConfirmSubmitButton } from "../_components/ConfirmSubmitButton";
import { saveMyDetails, uploadMyCv, applyMyCvExtraction, discardMyCvExtraction } from "./actions";
import { ECSA_LEVELS, EXTRACTED_PERSON_FIELDS, needsSelectFallbackOption, personFieldDefaultTick, QUALIFICATION_LEVELS } from "@/lib/cvExtraction";

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

// Finding 467: ecsa_level/highest_level on this page's own separate manual
// "My details" form used to be plain Field() <input>s, same gap Finding 466
// closed on people/[id]/page.tsx's manual edit form, and the exact helper
// that fix introduced (needsSelectFallbackOption) to keep a pre-existing
// non-canonical stored value round-tripping unchanged on save instead of
// being silently swapped for the <select>'s first real option.
function SelectField({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  options: readonly string[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[11.5px] font-semibold text-foreground">{label}</label>
      <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
        <option value="">- not recorded -</option>
        {needsSelectFallbackOption(defaultValue, options) && (
          <option value={defaultValue!}>{defaultValue} (not a SANRAL option - please update)</option>
        )}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
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

  const { data: membership, error: membershipError } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (membershipError) console.error("my-cv: company_members read failed", membershipError);
  const companyId = membership?.company_id as string | undefined;

  const { data: person, error: personError } = companyId
    ? await supabase.from("people").select(
        // Finding 445: id_number/role/ecsa_date/sacpcmp_date/initial_* added
        // so the review card below (same data cv-review.tsx's `current`
        // prop already gets from a plain `select("*")`) can tell a verified
        // CV value apart from one that would silently replace a different
        // value already on file - this page had no "current" value at all
        // for those columns before, so it couldn't make that check either.
        "id, name, id_number, role, phone, email, ecsa_level, ecsa_number, ecsa_date, ecsa_expiry, sacpcmp_number, sacpcmp_date, sacpcmp_expiry, highest_level, highest_description, highest_institution, highest_graduated, initial_description, initial_institution, initial_graduated",
      ).eq("company_id", companyId).eq("linked_user_id", user.id).maybeSingle()
    : { data: null, error: null };
  if (personError) console.error("my-cv: people read failed", personError);

  if (!person) {
    // A failed read (membershipError/personError) is indistinguishable from
    // the genuine "no roster record linked" case below unless flagged
    // explicitly - telling an already-linked person to go ask an admin to
    // re-link them, when nothing is actually wrong with their link, is a
    // false and actively misleading claim, the same established bug class
    // this doc has already fixed repeatedly elsewhere, just worse here
    // since it points the reader at the wrong fix entirely.
    const loadFailed = Boolean(membershipError || personError);
    return (
      <AppShell>
        <div className="mx-auto box-border w-full max-w-[760px] flex-1 px-4 pt-5 pb-10">
          <h1 className="text-xl font-bold text-foreground">My CV</h1>
          {loadFailed ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
              Couldn&apos;t load your CV record - try refreshing. If it keeps happening, let us know.
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              No roster record is linked to your account yet. Ask an owner or admin of your company to link your account to your
              CV record (Company &rarr; Team), or to send you an invite tied to your name.
            </p>
          )}
        </div>
      </AppShell>
    );
  }

  const personId = person.id as string;
  const [
    { data: uploads, error: uploadsError },
    { data: extractions, error: extractionsError },
    { data: generated, error: generatedError },
    { data: projects, error: projectsError },
  ] = await Promise.all([
    supabase.from("cv_uploads").select("id, storage_path, original_filename, mode, status, created_at").eq("person_id", personId).order("created_at", { ascending: false }),
    supabase.from("cv_extraction_results").select("id, proposed, review_status, created_at").eq("person_id", personId).eq("review_status", "pending_review").order("created_at", { ascending: false }),
    supabase.from("generated_cvs").select("id, format, detail, status, storage_path_pdf, requested_at").eq("person_id", personId).order("requested_at", { ascending: false }),
    supabase.from("projects").select("id, client_and_number, position_held, start_date, end_date").eq("person_id", personId).order("start_date", { ascending: false }),
  ]);
  if (uploadsError) console.error("my-cv: cv_uploads read failed", uploadsError);
  if (extractionsError) console.error("my-cv: cv_extraction_results read failed", extractionsError);
  if (generatedError) console.error("my-cv: generated_cvs read failed", generatedError);
  if (projectsError) console.error("my-cv: projects read failed", projectsError);
  const secondaryLoadError = Boolean(uploadsError || extractionsError || generatedError || projectsError);

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
        {secondaryLoadError && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            Some of your CV details (uploads, generated CVs or project history) couldn&apos;t be loaded - the sections below may
            be incomplete. Try refreshing.
          </div>
        )}

        <Card title="My details">
          <form action={saveMyDetails} autoComplete="off">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
              <Field name="phone" label="Phone" defaultValue={person.phone} />
              <Field name="email" label="Email" defaultValue={person.email} />
              <SelectField name="ecsa_level" label="ECSA level" defaultValue={person.ecsa_level} options={ECSA_LEVELS} />
              <Field name="ecsa_number" label="ECSA number" defaultValue={person.ecsa_number} />
              <Field name="ecsa_expiry" label="ECSA expiry" type="date" defaultValue={person.ecsa_expiry} />
              <Field name="sacpcmp_number" label="SACPCMP number" defaultValue={person.sacpcmp_number} />
              <Field name="sacpcmp_expiry" label="SACPCMP expiry" type="date" defaultValue={person.sacpcmp_expiry} />
              <SelectField name="highest_level" label="Highest qualification level" defaultValue={person.highest_level} options={QUALIFICATION_LEVELS} />
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
          const proposal = (ex.proposed as { person?: Record<string, { value: string | null; evidence: string | null; verified: boolean; warnings: string[] }> }).person ?? {};
          // Finding 431: was a hand-typed subset of 10 keys, out of step with
          // lib/cvExtraction.ts's own canonical EXTRACTED_PERSON_FIELDS (17) -
          // see actions.ts applyMyCvExtraction()'s own header for the full
          // write-up. Using the same list the apply action now uses means
          // every field a checkbox is offered for here is one the action will
          // actually save.
          const fields = EXTRACTED_PERSON_FIELDS.filter((f) => proposal[f.key]);
          return (
            <Card key={ex.id} title="Review your AI-extracted CV">
              <p className="mb-2 text-[11.5px] text-muted-foreground">
                A field already ticked was traced to the CV&apos;s own text and nothing on file would be overwritten. A field
                marked <strong className="text-warning">check this</strong> starts UNTICKED - AI couldn&apos;t confirm it, or
                saving it would replace what&apos;s on file - look at it before ticking it yourself.
              </p>
              <form action={applyMyCvExtraction}>
                <input type="hidden" name="extraction_id" value={ex.id} />
                {fields.map((f) => {
                  const p = proposal[f.key];
                  // Finding 445: this checkbox used to be unconditionally
                  // `defaultChecked` - every proposed value, verified or not,
                  // and with no check at all against what's already on file,
                  // started ticked to save. people/[id]/cv-review.tsx's own
                  // identical review card (the full People page, reviewing
                  // the exact same cv_extraction_results row shape) already
                  // guarded this with a verified+not-replacing check - this
                  // self-service page silently had none of it, so an
                  // employee who just clicked "Save ticked fields" (the
                  // obvious action, with nothing here to suggest otherwise)
                  // would save every low-confidence/unverified AI guess
                  // straight into their own record, including one that
                  // silently overwrote a different, possibly correct, value
                  // already on file. Now shares cv-review.tsx's own formula
                  // (lib/cvExtraction.ts personFieldDefaultTick()).
                  const now = (person as unknown as Record<string, string | null>)[f.key] ?? null;
                  const defaultTick = personFieldDefaultTick(p, now);
                  const replaces = now != null && now !== "" && now !== (p.value ?? "");
                  const reasons = [...(replaces ? ["Would replace what's on file."] : []), ...p.warnings];
                  return (
                    <div key={f.key} className="flex flex-col gap-0.5 border-t border-border py-1.5 first:border-t-0">
                      <div className="flex items-center gap-2.5">
                        <input type="checkbox" name={`use_${f.key}`} defaultChecked={defaultTick} aria-label={`Save ${f.label}`} />
                        <div className="w-40 shrink-0 text-xs text-muted-foreground">{f.key.replace(/_/g, " ")}</div>
                        {/* Finding 432: used to be one plain text <input> for
                            every field regardless of kind - a "select" field
                            (ecsa_level/highest_level) could be retyped to any
                            string at all, even though SANRAL's own form only
                            accepts its exact dropdown label
                            (engine/fill_conventional.py refuses any other one)
                            and applyMyCvExtraction() now enforces that same
                            option list server-side. Mirrors
                            people/[id]/cv-review.tsx's own ValueInput: a real
                            <select> for "select", password-masked for "secret",
                            a date input for "date", plain text otherwise. */}
                        {f.kind === "select" ? (
                          <select className={`${inputClass} min-h-9`} name={`f_${f.key}`} defaultValue={p.value ?? ""}>
                            <option value="">- choose -</option>
                            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            name={`f_${f.key}`}
                            defaultValue={p.value ?? ""}
                            type={f.kind === "date" ? "date" : f.kind === "secret" ? "password" : "text"}
                            autoComplete="off"
                            className={`${inputClass} min-h-9`}
                          />
                        )}
                        {!p.verified && <span className="text-[11px] font-semibold whitespace-nowrap text-warning">check this</span>}
                      </div>
                      {reasons.map((r, i) => (
                        <div key={i} className="pl-[26px] text-[11px] text-warning">{r}</div>
                      ))}
                    </div>
                  );
                })}
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
