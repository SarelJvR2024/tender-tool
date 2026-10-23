import Link from "next/link";
import { AlertTriangle, UserX } from "lucide-react";
import { expiryStatus } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { savePerson, deletePerson, saveProject, deleteProject, uploadCv, retryCvExtraction, saveRoleEligibility, addPersonCatalogRegistration, addSignatoryScope, deleteSignatoryScope } from "../actions";
import { loadDisciplineTaxonomy, taxonomyGroups, taxonomyLabel } from "@/lib/disciplineTaxonomy";
import { AppShell } from "../../_components/AppShell";
import { ConfirmSubmitButton } from "../../_components/ConfirmSubmitButton";
import { CvExtractionReview } from "./cv-review";
import { CvLedAddPerson } from "../_components/cv-led-add-person";
import type { CvExtractionResult } from "@/lib/cvExtraction";
import { EmptyState } from "@/components/tt/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  CATALOG_BODIES,
  catalogSlug,
  loadHeldCatalogRegistrations,
  type HeldCatalogRegistration,
  CONDITIONAL_BODIES,
  REGISTRATION_BODY_INFO,
  credentialExpiries,
  holdsRegistration,
  registrationsAskedFor,
  type AskedFor,
  type ConditionalBody,
} from "@/lib/personCredentials";
import { ROLE_FAMILY_LABEL, ROLE_FAMILY_ORDER, TENDER_ROLE_COLUMNS, type TenderRole } from "@/lib/tenderRoles";
import { CLIENT_TYPES, SANRAL_PROJECT_TYPES } from "@/lib/experience";
import { SANRAL_POSITION_CODES } from "@/lib/sanralMatrices";

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
  employment_status?: string | null; // 0036
  phone: string | null;
  email: string | null;
  ecsa_level: string | null;
  ecsa_number: string | null;
  ecsa_date: string | null;
  sacpcmp_number: string | null;
  sacpcmp_date: string | null;
  ecsa_expiry: string | null; // 0035
  sacpcmp_expiry: string | null; // 0035
  // 0040 - optional, shown only when held or a tender asks (audit Q5)
  sacnasp_category?: string | null;
  sacnasp_number?: string | null;
  sacnasp_expiry?: string | null;
  sagc_category?: string | null;
  sagc_number?: string | null;
  sagc_expiry?: string | null;
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
  extraction_error: string | null;
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

// Soft-tint tone, not a literal hex pair - the same 4-tone convention
// app/company/_components/shared.tsx's ChipBadge uses, duplicated locally
// rather than imported (People is its own feature folder; a cross-folder
// import of Company's private _components would be an odd coupling for 4
// lines of Tailwind class strings - same reasoning general-pack-review-logic.ts
// gives for duplicating pack-review-logic.ts's own STATUS_STYLE map).
type Tone = "success" | "warning" | "destructive" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const CV_UPLOAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Uploaded - used as-is", tone: "success" },
  extraction_requested: { label: "Waiting for AI extraction", tone: "warning" },
  extracting: { label: "Reading the CV…", tone: "warning" },
  extracted: { label: "Fields read - see above", tone: "success" },
  extraction_failed: { label: "Extraction failed", tone: "destructive" },
};

const GENERATED_CV_STATUS: Record<string, { label: string; tone: Tone }> = {
  requested: { label: "Requested", tone: "warning" },
  generating: { label: "Generating…", tone: "warning" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
};

const CV_FORMAT_LABEL: Record<string, string> = {
  sanral_keyperson: "SANRAL key-person (Form B1.1/B2.1 shape)",
  world_bank: "World Bank format",
};

type SignatoryScope = {
  id: string;
  region: string | null;
  industry_tag: string | null;
  discipline_tag: string | null;
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

const fieldClass =
  "min-h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const labelClass = "mb-1 block text-xs font-semibold text-muted-foreground";
const gridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2";
const cardClass = "mb-5 rounded-xl border border-border bg-card p-4";
const sectionLabelClass = "mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase";

// Same badge shape and colours as the Document Vault (app/app/company/page.tsx).
function ExpiryBadge({ status }: { status?: { label: string; tone: Tone } }) {
  if (!status) return null;
  return (
    <span className="ml-1.5 inline-block align-middle">
      <Pill tone={status.tone}>{status.label}</Pill>
    </span>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="mb-3">{children}</div>;
}

function PersonJumpLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold whitespace-nowrap text-foreground no-underline"
    >
      {label}
    </a>
  );
}

// SACNASP / SAGC (0040): the same number / category / renewal-date shape as
// ECSA, rendered only when held or asked for by a tender (see the caller).
function ConditionalRegistration({
  body,
  person,
  askedBy,
  status,
}: {
  body: ConditionalBody;
  person: Person | null;
  askedBy: string[];
  status?: { label: string; tone: Tone };
}) {
  const info = REGISTRATION_BODY_INFO[body];
  const key = body.toLowerCase() as "sacnasp" | "sagc";
  const listId = `${key}-categories`;
  return (
    <div className="mb-3 rounded-lg border border-border p-3">
      <div className="text-sm font-semibold text-foreground">
        {body} <span className="font-normal text-muted-foreground">- {info.name}</span>
      </div>
      <div className={`mb-2 text-[11px] ${askedBy.length ? "text-warning" : "text-muted-foreground"}`}>
        {askedBy.length
          ? `Asked for by ${askedBy.slice(0, 4).join(", ")}${askedBy.length > 4 ? ` and ${askedBy.length - 4} more` : ""}.`
          : `Only some tenders ask for this, ${info.example}.`}
      </div>
      <div className={gridClass}>
        <Field>
          <label className={labelClass}>{body} category</label>
          <input className={fieldClass} name={`${key}_category`} list={listId} defaultValue={person?.[`${key}_category`] ?? ""} />
          <datalist id={listId}>{info.categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field><label className={labelClass}>{body} number</label><input className={fieldClass} name={`${key}_number`} defaultValue={person?.[`${key}_number`] ?? ""} /></Field>
        <Field>
          <label className={labelClass}>{body} valid until / renewal due <ExpiryBadge status={status} /></label>
          <input className={fieldClass} type="date" name={`${key}_expiry`} defaultValue={person?.[`${key}_expiry`] ?? ""} />
        </Field>
      </div>
    </div>
  );
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
  searchParams: Promise<{ error?: string; roles_saved?: string; cv_applied?: string }>;
}) {
  const { id } = await params;
  const { error: errorParam, roles_saved: rolesSaved, cv_applied: cvApplied } = await searchParams;
  const isNew = id === "new";
  const supabase = await createClient();

  let person: Person | null = null;
  // A real query failure (RLS/session hiccup, network blip) is a different
  // situation from the record genuinely not existing/not being accessible -
  // the old code read only `{ data }`, so any failed read silently became
  // "not found", which is misleading. Captured separately so the not-found
  // screen below can tell the two apart.
  let personLoadError: string | null = null;
  let projects: Project[] = [];
  let cvUploads: CvUpload[] = [];
  let generatedCvs: GeneratedCv[] = [];
  let signedUrls: Record<string, string> = {};
  let roleCatalog: TenderRole[] = [];
  let taggedRoles = new Set<string>();
  let rolesError: string | null = null;
  let pendingExtractions: CvExtractionResult[] = [];
  let signatoryScopes: SignatoryScope[] = [];
  // 0061: optional region/industry/discipline tags shown on the "Signatory
  // capacity" field - reuses discipline_categories (0040), same taxonomy
  // the Experience Library and pricing form already read.
  const taxonomy = await loadDisciplineTaxonomy(supabase);
  const disciplineGroups = taxonomyGroups(taxonomy);
  // Which conditional registrations (SACNASP, SAGC) a tender on the system
  // asks for - the fields are shown only then, or when already held.
  const askedFor: AskedFor = await registrationsAskedFor(supabase);
  // 0050 catalog registrations this person holds (SACAP, SACPLAN, SACQSP,
  // SACPVP, PSIRA ...) - shown below only for a body a tender asks for, or
  // one already held.
  const heldCatalog: HeldCatalogRegistration[] = isNew ? [] : await loadHeldCatalogRegistrations(supabase, [id]);
  // Hoisted out of the "Other registrations" block below so the jump-nav can
  // know whether that section will actually render, without duplicating the
  // same filter twice.
  const catalogBodiesShown = CATALOG_BODIES.filter((b) => askedFor[b].length > 0 || heldCatalog.some((h) => h.slug === catalogSlug(b)));

  if (!isNew) {
    const { data, error } = await supabase.from("people").select("*").eq("id", id).maybeSingle();
    person = data as Person | null;
    if (error) {
      console.error("people select failed for person detail", error);
      personLoadError = error.message;
    }

    // Tender role catalog + this person's tags (migration 0016).
    const [{ data: roleRows, error: roleErr }, { data: tagRows }] = await Promise.all([
      supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS).order("sort_order"),
      supabase.from("person_role_eligibility").select("role_code").eq("person_id", id),
    ]);
    roleCatalog = (roleRows ?? []) as TenderRole[];
    taggedRoles = new Set((tagRows ?? []).map((r) => r.role_code as string));
    if (roleErr) console.error("Failed to load tender_roles catalog:", roleErr.message);
    rolesError = roleErr?.message ?? null;

    const { data: projectRows } = await supabase
      .from("projects")
      .select("*")
      .eq("person_id", id)
      .order("start_date", { ascending: false });
    projects = (projectRows ?? []) as Project[];

    const { data: uploadRows } = await supabase
      .from("cv_uploads")
      .select("id, storage_path, original_filename, mode, status, created_at, extraction_error")
      .eq("person_id", id)
      .order("created_at", { ascending: false });
    cvUploads = (uploadRows ?? []) as CvUpload[];

    // AI-extracted fields waiting for a person to confirm/correct (0023).
    const { data: extractionRows } = await supabase
      .from("cv_extraction_results")
      .select("id, cv_upload_id, proposed, warnings, text_method, source_pages, model, created_at")
      .eq("person_id", id)
      .eq("review_status", "pending_review")
      .order("created_at", { ascending: false });
    pendingExtractions = (extractionRows ?? []) as CvExtractionResult[];

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

    const { data: scopeRows } = await supabase
      .from("signatory_scopes")
      .select("id, region, industry_tag, discipline_tag")
      .eq("person_id", id)
      .order("created_at");
    signatoryScopes = (scopeRows ?? []) as SignatoryScope[];

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
      <AppShell>
        <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-10">
          <EmptyState
            icon={personLoadError ? AlertTriangle : UserX}
            title={personLoadError ? "Couldn't load this person" : "Person not found"}
            description={
              personLoadError
                ? "Something went wrong reading this record - try refreshing. If it keeps happening, let us know."
                : "This person may have been removed, or you don't have access to this record."
            }
            action={
              <Link href="/people" className={buttonVariants({ variant: "outline" })}>
                Back to People
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }

  const yearsFromInitial = yearsSince(person?.initial_graduated ?? null);
  const expiryByBody = Object.fromEntries(
    credentialExpiries(person ?? {}).map((c) => [c.body, { label: c.status.label, tone: c.status.tone as Tone }]),
  );

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6">
        <h1 className="mb-1 font-display text-xl font-medium text-foreground">
          {isNew ? "Add person" : person!.name}
        </h1>
        <div className="mb-4 text-sm text-muted-foreground">
          Real ID and registration numbers are stored for official SANRAL forms only - handle with care.
        </div>

        {/* Jump nav - this page now runs edit form -> registrations ->
            role tags -> CV documents -> project history, a long scroll on a
            phone. Same sticky-anchor idea as the Tender Workspace page. */}
        {!isNew && (
          <div className="sticky top-0 z-5 mb-3 flex gap-1.5 overflow-x-auto bg-background py-2">
            {catalogBodiesShown.length > 0 && <PersonJumpLink href="#registrations-asked" label="Registrations" />}
            <PersonJumpLink href="#roles" label="Roles" />
            <PersonJumpLink href="#cv-documents" label="CV documents" />
            <PersonJumpLink href="#projects" label="Projects" />
          </div>
        )}

        {errorParam && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {decodeURIComponent(errorParam)}
          </div>
        )}

        {cvApplied && (
          <div className="mb-4 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
            {(() => {
              const [f, p] = cvApplied.split("-").map((n) => Number(n) || 0);
              return `Saved from the CV: ${f} field${f === 1 ? "" : "s"}${p ? ` and ${p} project${p === 1 ? "" : "s"}` : ""}. The standard CV formats are queued.`;
            })()}
          </div>
        )}

        {!isNew && pendingExtractions.map((r) => (
          <CvExtractionReview
            key={r.id}
            result={r}
            filename={cvUploads.find((u) => u.id === r.cv_upload_id)?.original_filename ?? "uploaded CV"}
            personId={person!.id}
            current={person as unknown as Record<string, string | null>}
            existingProjects={projects.map((p) => p.client_and_number)}
          />
        ))}

        {isNew && <CvLedAddPerson />}
        {isNew && (
          <div className="mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Or enter details manually
          </div>
        )}

        <form action={savePerson} className={cardClass}>
          <input type="hidden" name="id" value={isNew ? "new" : person!.id} />

          <div className={sectionLabelClass}>Identity</div>
          <div className={gridClass}>
            <Field><label className={labelClass}>Full name *</label><input className={fieldClass} name="name" defaultValue={person?.name ?? ""} required /></Field>
            <Field>
              <label className={labelClass}>ID number (PII - masked)</label>
              <input className={fieldClass} type="text" autoComplete="off" name="id_number" defaultValue={person?.id_number ?? ""} />
            </Field>
            <Field><label className={labelClass}>Role / job title</label><input className={fieldClass} name="role" defaultValue={person?.role ?? ""} placeholder="e.g. Contracts Engineer" /></Field>
            <Field><label className={labelClass}>Description (position type)</label><input className={fieldClass} name="description" defaultValue={person?.description ?? ""} /></Field>
            <Field><label className={labelClass}>Signatory capacity</label><input className={fieldClass} name="signatory_capacity" defaultValue={person?.signatory_capacity ?? ""} /></Field>
            <Field>
              <label className={labelClass}>Employment (SANRAL Form B1)</label>
              <select className={fieldClass} name="employment_status" defaultValue={person?.employment_status ?? ""}>
                <option value="">Not recorded</option>
                <option value="full_time_employee">Full-time employee of the company</option>
                <option value="not_full_time_employee">Not a full-time employee (e.g. subconsultant, JV partner)</option>
              </select>
            </Field>
            <Field><label className={labelClass}>Phone</label><input className={fieldClass} name="phone" defaultValue={person?.phone ?? ""} /></Field>
            <Field><label className={labelClass}>Email</label><input className={fieldClass} type="email" name="email" defaultValue={person?.email ?? ""} /></Field>
          </div>

          <div className={`${sectionLabelClass} mt-4`}>Memberships and professional registrations</div>
          {(() => {
            // Spec v3 O23: ECSA/SACPCMP used to render unconditionally on
            // every person, the exact "ECSA as the universal category"
            // problem the spec calls out - a non-engineering company's staff
            // saw two engineering-only registration bodies forced on them by
            // default, same as SANRAL's ECSA requirement, even with nothing
            // to enter. SACNASP/SAGC/the catalog bodies already solved this
            // correctly (shown only if held or a tender asks); ECSA/SACPCMP
            // now follow the same "shown if already held, else collapsed"
            // rule. expiryByBody already carries an entry only when held or
            // an expiry is on file (credentialExpiries(), line ~385) - the
            // exact signal this needs, no new lookup required. Deliberately
            // NOT wired to registrationsAskedFor() like SACNASP/SAGC are -
            // that needs its own tender-side "does this position need an
            // engineer" signal, a separate piece of work, not silently
            // bundled into this one.
            const ecsaOrSacpcmpHeld = "ECSA" in expiryByBody || "SACPCMP" in expiryByBody;
            const fields = (
              <div className={gridClass}>
                <Field><label className={labelClass}>ECSA level</label><input className={fieldClass} name="ecsa_level" defaultValue={person?.ecsa_level ?? ""} placeholder="e.g. Professional Engineer" /></Field>
                <Field><label className={labelClass}>ECSA number</label><input className={fieldClass} name="ecsa_number" defaultValue={person?.ecsa_number ?? ""} /></Field>
                <Field><label className={labelClass}>ECSA registration date</label><input className={fieldClass} type="date" name="ecsa_date" defaultValue={person?.ecsa_date ?? ""} /></Field>
                <Field>
                  <label className={labelClass}>ECSA valid until / renewal due <ExpiryBadge status={expiryByBody.ECSA} /></label>
                  <input className={fieldClass} type="date" name="ecsa_expiry" defaultValue={person?.ecsa_expiry ?? ""} />
                </Field>
                <Field><label className={labelClass}>SACPCMP number</label><input className={fieldClass} name="sacpcmp_number" defaultValue={person?.sacpcmp_number ?? ""} /></Field>
                <Field><label className={labelClass}>SACPCMP registration date</label><input className={fieldClass} type="date" name="sacpcmp_date" defaultValue={person?.sacpcmp_date ?? ""} /></Field>
                <Field>
                  <label className={labelClass}>SACPCMP valid until / renewal due <ExpiryBadge status={expiryByBody.SACPCMP} /></label>
                  <input className={fieldClass} type="date" name="sacpcmp_expiry" defaultValue={person?.sacpcmp_expiry ?? ""} />
                </Field>
              </div>
            );
            if (ecsaOrSacpcmpHeld) return fields;
            return (
              <details className="mb-2.5">
                <summary className="flex min-h-11 cursor-pointer items-center py-1.5 text-xs font-semibold text-accent">
                  + Add an ECSA or SACPCMP registration - only engineering-registered staff need these
                </summary>
                {fields}
              </details>
            );
          })()}
          {(() => {
            const shown = CONDITIONAL_BODIES.filter((b) => (person && holdsRegistration(person, b)) || askedFor[b].length > 0);
            const hidden = CONDITIONAL_BODIES.filter((b) => !shown.includes(b));
            return (
              <>
                {shown.map((b) => (
                  <ConditionalRegistration key={b} body={b} person={person} askedBy={askedFor[b]} status={expiryByBody[b]} />
                ))}
                {hidden.length > 0 && (
                  // Not asked for by any tender and not held: kept out of the
                  // way, one click to add (the fields still submit, empty).
                  <details className="mb-2.5">
                    <summary className="flex min-h-11 cursor-pointer items-center py-1.5 text-xs font-semibold text-accent">
                      + Add another registration ({hidden.join(", ")}) - only some tenders ask for these
                    </summary>
                    {hidden.map((b) => (
                      <ConditionalRegistration key={b} body={b} person={person} askedBy={[]} status={expiryByBody[b]} />
                    ))}
                  </details>
                )}
              </>
            );
          })()}
          <div className="mb-2.5 text-xs text-muted-foreground">
            Enter the date from the registration certificate or renewal notice. It drives the expiry
            badge here and the renewal reminder (60 days ahead, and again if it lapses).
          </div>

          <div className={`${sectionLabelClass} mt-4`}>Qualifications</div>
          <div className="mb-2.5 text-xs text-muted-foreground">
            Years of experience is never stored here - the pack-matching engine computes it
            from the initial-qualification date relative to each tender&apos;s own closing date.
            {yearsFromInitial !== null && ` (As of today, that would be about ${yearsFromInitial} years.)`}
          </div>
          <div className={gridClass}>
            <Field><label className={labelClass}>Highest qualification level</label><input className={fieldClass} name="highest_level" defaultValue={person?.highest_level ?? ""} placeholder="e.g. Masters Degree" /></Field>
            <Field><label className={labelClass}>Highest qualification</label><input className={fieldClass} name="highest_description" defaultValue={person?.highest_description ?? ""} placeholder="e.g. MEng (Civil Engineering)" /></Field>
            <Field><label className={labelClass}>Institution (highest)</label><input className={fieldClass} name="highest_institution" defaultValue={person?.highest_institution ?? ""} /></Field>
            <Field><label className={labelClass}>Date graduated (highest)</label><input className={fieldClass} type="date" name="highest_graduated" defaultValue={person?.highest_graduated ?? ""} /></Field>
            <Field><label className={labelClass}>Initial qualification</label><input className={fieldClass} name="initial_description" defaultValue={person?.initial_description ?? ""} placeholder="e.g. BEng (Civil Engineering)" /></Field>
            <Field><label className={labelClass}>Institution (initial)</label><input className={fieldClass} name="initial_institution" defaultValue={person?.initial_institution ?? ""} /></Field>
            <Field><label className={labelClass}>Date graduated (initial)</label><input className={fieldClass} type="date" name="initial_graduated" defaultValue={person?.initial_graduated ?? ""} /></Field>
          </div>

          <Button type="submit" variant="accent" size="lg" className="mt-2 min-h-11 px-5">
            {isNew ? "Add person" : "Save changes"}
          </Button>
        </form>

        {!isNew && person?.signatory_capacity && (
          <div id="signatory-scope" className={cardClass}>
            <div className="mb-0.5 font-display text-base font-medium text-foreground">Signatory scope (optional)</div>
            <div className="mb-3 text-xs text-muted-foreground">
              A region and/or industry/discipline this person usually signs for - e.g. &quot;Western Cape&quot;, or a
              discipline such as roads/civil. This only SUGGESTS {person!.name} as the default pick on a matching
              tender&apos;s &quot;Who signs this bid&quot; selector - the company can still choose anyone with a
              signatory capacity for any tender. Leave it blank if this person signs across the board.
            </div>
            {signatoryScopes.length > 0 && (
              <div className="mb-3 flex flex-col gap-1.5">
                {signatoryScopes.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground">
                    <span className="flex-1">
                      {[s.region, s.industry_tag ? taxonomyLabel(taxonomy, s.industry_tag) : null, s.discipline_tag ? taxonomyLabel(taxonomy, s.discipline_tag) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <form action={deleteSignatoryScope}>
                      <input type="hidden" name="person_id" value={person!.id} />
                      <input type="hidden" name="scope_id" value={s.id} />
                      <ConfirmSubmitButton
                        confirmMessage="Remove this signatory scope? This can't be undone."
                        className="flex min-h-11 cursor-pointer items-center bg-transparent text-xs font-semibold text-destructive"
                      >
                        Remove
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                ))}
              </div>
            )}
            <form action={addSignatoryScope} className="flex flex-wrap items-end gap-2.5">
              <input type="hidden" name="person_id" value={person!.id} />
              <Field>
                <label className={labelClass}>Region</label>
                <input className={fieldClass} name="region" placeholder="e.g. Western Cape" />
              </Field>
              <Field>
                <label className={labelClass}>Industry</label>
                <select className={fieldClass} name="industry_tag" defaultValue="">
                  <option value="">Not scoped by industry</option>
                  {disciplineGroups.map(({ group }) => (
                    <option key={group.slug} value={group.slug}>{group.label}</option>
                  ))}
                </select>
              </Field>
              <Field>
                <label className={labelClass}>Discipline</label>
                <select className={fieldClass} name="discipline_tag" defaultValue="">
                  <option value="">Not scoped by discipline</option>
                  {disciplineGroups.map(({ group, children }) => (
                    <optgroup key={group.slug} label={group.label}>
                      {children.map((c) => (
                        <option key={c.slug} value={c.slug}>{c.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
              <Button type="submit" variant="default" size="lg" className="min-h-11 px-4">
                Add scope
              </Button>
            </form>
          </div>
        )}

        {!isNew &&
          catalogBodiesShown.length > 0 &&
          (() => {
            const shown = catalogBodiesShown;
            return (
              <div id="registrations-asked" className={cardClass}>
                <div className={sectionLabelClass}>Other registrations a tender asks for</div>
                <div className="mb-2.5 text-xs text-muted-foreground">
                  Shown only because a tender on the system asks for the body, or {person!.name} already holds it. Kept in the
                  company&apos;s registrations list (<Link href="/company/registrations" className="text-accent">Company &gt; Registrations</Link>),
                  which also sends the renewal reminder.
                </div>
                {shown.map((b) => {
                  const info = REGISTRATION_BODY_INFO[b];
                  const mine = heldCatalog.filter((h) => h.slug === catalogSlug(b));
                  const asked = askedFor[b];
                  return (
                    <div key={b} className="mb-2.5 rounded-lg border border-border p-3">
                      <div className="text-sm font-semibold text-foreground">
                        {b} <span className="font-normal text-muted-foreground">- {info.name}</span>
                      </div>
                      <div className={`mb-2 text-[11px] ${asked.length ? "text-warning" : "text-muted-foreground"}`}>
                        {asked.length
                          ? `Asked for by ${asked.slice(0, 4).join(", ")}${asked.length > 4 ? ` and ${asked.length - 4} more` : ""}.`
                          : `Held - no open tender asks for it right now.`}
                      </div>
                      {mine.map((h) => {
                        // expiryStatus() only ever returns the 4-value subset Tone covers here (never "accent").
                        const st = h.expiry_date ? (expiryStatus(h.expiry_date).tone as Tone) : "muted";
                        const stLabel = h.expiry_date ? expiryStatus(h.expiry_date).label : "Renewal date not on file";
                        return (
                          <div key={h.id} className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-foreground">
                            <span>{h.category || "Registration"}{h.registration_number ? ` ${h.registration_number}` : ""}{h.expiry_date ? `, valid to ${h.expiry_date}` : ""}</span>
                            <Pill tone={st}>{stLabel}</Pill>
                          </div>
                        );
                      })}
                      <details open={mine.length === 0}>
                        <summary className="flex min-h-11 cursor-pointer items-center py-1 text-xs font-semibold text-accent">
                          {mine.length ? `+ Add another ${b} registration` : `+ Add ${person!.name}'s ${b} registration`}
                        </summary>
                        <form action={addPersonCatalogRegistration}>
                          <input type="hidden" name="person_id" value={person!.id} />
                          <input type="hidden" name="slug" value={catalogSlug(b)} />
                          <div className={gridClass}>
                            <Field>
                              <label className={labelClass}>{b === "PSIRA" ? "Grade" : "Category"}</label>
                              <input className={fieldClass} name="category" list={`${b}-cats`} />
                              <datalist id={`${b}-cats`}>{info.categories.map((c) => <option key={c} value={c} />)}</datalist>
                            </Field>
                            <Field><label className={labelClass}>{b} number</label><input className={fieldClass} name="registration_number" /></Field>
                            <Field><label className={labelClass}>Valid until / renewal due</label><input className={fieldClass} type="date" name="expiry_date" /></Field>
                          </div>
                          <Button type="submit" variant="default" size="default" className="min-h-10 px-4 text-xs">
                            Add {b} registration
                          </Button>
                        </form>
                      </details>
                    </div>
                  );
                })}
              </div>
            );
          })()}

        {!isNew && (
          <form action={deletePerson} className="mb-7">
            <input type="hidden" name="id" value={person!.id} />
            <ConfirmSubmitButton
              confirmMessage={`Remove ${person!.name}? Their CVs and project history will also be removed. This can't be undone.`}
              className="min-h-11 cursor-pointer rounded-lg border border-destructive/30 bg-destructive/10 px-4 text-xs font-semibold text-destructive"
            >
              Remove person
            </ConfirmSubmitButton>
          </form>
        )}

        {!isNew && (
          <>
            <h2 id="roles" className="mb-1 font-display text-base font-medium text-foreground">
              Tender roles this CV qualifies for
            </h2>
            <div className="mb-3 text-xs text-muted-foreground">
              Your company decides which tender roles {person!.name}&apos;s CV fits - Tender Ready uses this tag on each
              tender&apos;s compliance check instead of guessing from years of experience or registration. The roles are the
              ones real tenders ask for: SANRAL&apos;s Book 1 key-person codes (a Design Specialist is tendered per
              specialism) and the key personnel other buyers name. Hover a role to see which tender it came from.
            </div>
            {rolesSaved === "1" && (
              <div className="mb-3 rounded-lg border border-success/20 bg-success/10 px-3.5 py-2 text-sm text-success">
                Role tags saved.
              </div>
            )}
            {rolesError ? (
              <div className="mb-5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2 text-xs text-warning">
                Couldn&apos;t load role options — try again shortly.
              </div>
            ) : (
              <form action={saveRoleEligibility} className={cardClass}>
                <input type="hidden" name="person_id" value={person!.id} />
                <div className="mb-2 text-xs text-foreground">
                  {taggedRoles.size === 0
                    ? "Not tagged for any role yet."
                    : `Tagged for: ${roleCatalog.filter((r) => taggedRoles.has(r.code)).map((r) => r.title).join(", ")}.`}
                </div>
                {ROLE_FAMILY_ORDER.map((family) => {
                  const familyRoles = roleCatalog.filter((r) => r.family === family);
                  if (familyRoles.length === 0) return null;
                  const count = familyRoles.filter((r) => taggedRoles.has(r.code)).length;
                  return (
                    <details key={family} open={count > 0 || family === "sanral_consultant"} className="border-t border-border py-2 first:border-t-0">
                      <summary className="cursor-pointer text-sm font-semibold text-foreground">
                        {ROLE_FAMILY_LABEL[family] ?? family}
                        {count > 0 && <span className="ml-2 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">{count} tagged</span>}
                      </summary>
                      <div className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2">
                        {familyRoles.map((r) => (
                          <label key={r.code} title={r.source} className="flex min-h-8 items-start gap-2 text-sm text-foreground">
                            <input type="checkbox" name="role_code" value={r.code} defaultChecked={taggedRoles.has(r.code)} className="mt-0.5 size-4 shrink-0" />
                            <span>
                              {r.title}
                              {r.registration_body && <span className="text-[11px] text-muted-foreground"> · {r.registration_body}</span>}
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })}
                <Button type="submit" variant="default" size="lg" className="mt-2.5 min-h-11 px-5">
                  Save role tags
                </Button>
              </form>
            )}

            <h2 id="cv-documents" className="mb-1 font-display text-base font-medium text-foreground">
              CV documents
            </h2>
            <div className="mb-3 text-xs text-muted-foreground">
              Upload {person!.name}&apos;s CV once. Choose <strong>use as-is</strong> to attach
              the exact file to submissions with no AI involvement, or{" "}
              <strong>AI-extract</strong> to have the qualifications, registrations and projects read off the CV for
              you to check here - nothing is saved until you confirm it. Works on Word and PDF CVs that contain
              text; a scanned/photographed CV can only be used as-is.
            </div>

            <form action={uploadCv} encType="multipart/form-data" className={cardClass}>
              <input type="hidden" name="person_id" value={person!.id} />
              <Field>
                <label className={labelClass}>CV file</label>
                <input className={fieldClass} type="file" name="file" required accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" />
              </Field>
              <div className="mb-3 flex flex-wrap gap-4">
                <label className="flex max-w-[320px] items-start gap-1.5 text-sm text-foreground">
                  <input type="radio" name="mode" value="ai_extract" defaultChecked className="mt-0.5" />
                  <span>
                    <strong>AI-extract</strong> the fields for you to check, then build the
                    standard CV formats from them.
                  </span>
                </label>
                <label className="flex max-w-[320px] items-start gap-1.5 text-sm text-foreground">
                  <input type="radio" name="mode" value="as_is" className="mt-0.5" />
                  <span>
                    <strong>Use as-is</strong> - attach this exact file to submissions, no AI
                    involvement at all.
                  </span>
                </label>
              </div>
              <Button type="submit" variant="accent" size="lg" className="min-h-11 px-5">
                Upload CV
              </Button>
            </form>

            {cvUploads.length > 0 && (
              <div className="mb-4">
                {cvUploads.map((u) => {
                  const st = CV_UPLOAD_STATUS[u.status] ?? { label: u.status, tone: "muted" as Tone };
                  const url = signedUrls[u.storage_path];
                  return (
                    <div key={u.id} className="mb-2 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5">
                      <div>
                        <div className="text-sm font-semibold text-foreground">{u.original_filename}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {u.mode === "as_is" ? "Use as-is" : "AI-extract"} · {new Date(u.created_at).toLocaleDateString()}
                        </div>
                        {u.status === "extraction_failed" && (
                          // UX audit re-review 2026-10-23, item 3: this used to render
                          // u.extraction_error verbatim - a raw provider error and
                          // request id for anything that failed at the AI call itself
                          // (engine/cv/extract_cv_fields.py now keeps that detail out of
                          // the stored message, but this stays a fixed, generic line
                          // regardless, rather than trusting whatever's in the column).
                          <div className="mt-1 max-w-[480px] text-xs text-destructive">
                            We couldn&apos;t read this file automatically. The original file is safe - retry, or
                            upload the original Word/PDF export.
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Pill tone={st.tone}>{st.label}</Pill>
                        {u.status === "extraction_failed" && (
                          <form action={retryCvExtraction}>
                            <input type="hidden" name="cv_upload_id" value={u.id} />
                            <input type="hidden" name="person_id" value={person!.id} />
                            <button type="submit" className="text-xs font-semibold text-accent">
                              Retry
                            </button>
                          </form>
                        )}
                        {url && (
                          <a href={url} className="text-xs font-semibold text-accent">
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
              <div className="mb-5">
                <div className={sectionLabelClass}>Standard generated CVs</div>
                <div className="mb-2 text-[11px] text-muted-foreground">
                  Generated automatically, usually within a few minutes — refresh to check.
                </div>
                {generatedCvs.map((g) => {
                  const st = GENERATED_CV_STATUS[g.status] ?? { label: g.status, tone: "muted" as Tone };
                  const docxUrl = g.storage_path_docx ? signedUrls[g.storage_path_docx] : null;
                  const pdfUrl = g.storage_path_pdf ? signedUrls[g.storage_path_pdf] : null;
                  return (
                    <div key={g.id} className="mb-2 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card px-4 py-2.5">
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {CV_FORMAT_LABEL[g.format] ?? g.format} · {g.detail}
                        </div>
                        {g.error_message && (
                          <div className="mt-0.5 text-xs text-destructive">{g.error_message}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5">
                        <Pill tone={st.tone}>{st.label}</Pill>
                        {docxUrl && <a href={docxUrl} className="text-xs font-semibold text-accent">Word</a>}
                        {pdfUrl && <a href={pdfUrl} className="text-xs font-semibold text-accent">PDF</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <h2 id="projects" className="mb-1 font-display text-base font-medium text-foreground">
              Project / reference history
            </h2>
            <div className="mb-3 text-xs text-muted-foreground">
              Used to match this person against a tender&apos;s key positions and suggest the best fit for each role.
            </div>

            {projects.length === 0 && (
              <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
                No project history on file yet for {person!.name}.
              </div>
            )}

            {projects.map((proj) => (
              <div key={proj.id} className="mb-2.5 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex flex-wrap justify-between gap-2.5">
                  <div>
                    <div className="text-sm font-bold whitespace-pre-line text-foreground">{proj.client_and_number}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {proj.position_held || proj.position_code || "Position not set"}
                      {proj.value_rm != null && ` · R${proj.value_rm}m`}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {proj.start_date ?? "?"} – {proj.end_date ?? "ongoing"}
                      {proj.contact_match_confidence && ` · referee match: ${proj.contact_match_confidence}`}
                    </div>
                  </div>
                  <form action={deleteProject}>
                    <input type="hidden" name="project_id" value={proj.id} />
                    <input type="hidden" name="person_id" value={person!.id} />
                    <ConfirmSubmitButton
                      confirmMessage="Remove this project from this person's history? This can't be undone."
                      className="min-h-10 cursor-pointer rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 text-[11px] font-semibold text-destructive"
                    >
                      Remove
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>
            ))}

            <details className="mt-2">
              <summary className="cursor-pointer py-2 text-sm font-semibold text-accent">
                + Add a project to this person&apos;s history
              </summary>
              <form action={saveProject} className={`${cardClass} mt-2`}>
                <input type="hidden" name="person_id" value={person!.id} />
                <div className={gridClass}>
                  <Field><label className={labelClass}>Client and contract number *</label><input className={fieldClass} name="client_and_number" placeholder={"e.g. ACSA (OR Tambo)\\nORT5737/2018/RFP"} required /></Field>
                  {/* Suggestions are SANRAL's complete published code lists (Book 1 /
                      the Technical Submission workbook), not values seen in one
                      company's data. Free text: other buyers code differently. */}
                  <Field>
                    <label className={labelClass}>Client type</label>
                    <input className={fieldClass} name="client_type" list="sanral-client-types" placeholder="e.g. Relevant SOE" />
                    <datalist id="sanral-client-types">{CLIENT_TYPES.map((c) => <option key={c} value={c} />)}</datalist>
                  </Field>
                  <Field>
                    <label className={labelClass}>Project type</label>
                    <input className={fieldClass} name="project_type" list="sanral-project-types" placeholder="e.g. DS" />
                    <datalist id="sanral-project-types">
                      {SANRAL_PROJECT_TYPES.map((p) => <option key={p.code} value={p.code}>{`${p.label} (${p.appliesTo.join("; ")})`}</option>)}
                    </datalist>
                  </Field>
                  <Field>
                    <label className={labelClass}>Position code</label>
                    <input className={fieldClass} name="position_code" list="sanral-position-codes" placeholder="e.g. CE" />
                    <datalist id="sanral-position-codes">{SANRAL_POSITION_CODES.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}</datalist>
                  </Field>
                  <Field><label className={labelClass}>Position held</label><input className={fieldClass} name="position_held" placeholder="e.g. Contract Engineer" /></Field>
                  <Field><label className={labelClass}>Value (R million)</label><input className={fieldClass} type="number" step="0.01" name="value_rm" /></Field>
                  <Field><label className={labelClass}>Referee name</label><input className={fieldClass} name="contact_name" /></Field>
                  <Field><label className={labelClass}>Referee phone</label><input className={fieldClass} name="contact_phone" /></Field>
                  <Field><label className={labelClass}>Referee email</label><input className={fieldClass} type="email" name="contact_email" /></Field>
                  <Field><label className={labelClass}>Start date</label><input className={fieldClass} type="date" name="start_date" /></Field>
                  <Field><label className={labelClass}>End date</label><input className={fieldClass} type="date" name="end_date" /></Field>
                  <Field>
                    <label className={labelClass}>Referee match confidence</label>
                    <select className={fieldClass} name="contact_match_confidence" defaultValue="unconfirmed">
                      <option value="confirmed">Confirmed</option>
                      <option value="partially_confirmed">Partially confirmed</option>
                      <option value="unconfirmed">Unconfirmed</option>
                      <option value="missing">Missing</option>
                    </select>
                  </Field>
                </div>
                <Field><label className={labelClass}>Source note</label><input className={fieldClass} name="source_note" placeholder="Where this was confirmed from" /></Field>
                <Button type="submit" variant="default" size="lg" className="min-h-11 px-5">
                  Add project
                </Button>
              </form>
            </details>
          </>
        )}
      </div>
    </AppShell>
  );
}
