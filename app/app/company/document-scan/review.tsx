import Link from "next/link";
import {
  confirmCvHandoff,
  confirmExperienceReferenceLetter,
  confirmIdDocument,
  confirmVaultDocument,
  discardOnboardingDocument,
  skipOnboardingDocument,
} from "./actions";
import {
  cidbNameMismatchWarning,
  DATE_FIELDS,
  FIELD_LABELS,
  isFieldPersisted,
  KIND_FIELDS,
  KIND_LABELS,
  MANUAL_REVIEW_LINK,
  NUMBER_FIELDS,
  READ_ONLY_FIELDS,
  ROUTABLE_KINDS,
  UNROUTED_KINDS,
  type DocumentKind,
  type OnboardingFields,
} from "@/lib/onboardingScan";
import { Button } from "@/components/ui/button";

// Confirm-or-correct card for one AI-classified onboarding document
// (onboarding_document_results, 0063). Deliberately the same shape as
// app/app/people/[id]/cv-review.tsx: per field, a tick (default-checked
// only when traced to the document and not flagged), an editable value,
// the source quote, and any warning - nothing is saved until Confirm, and
// only the ticked fields are used (see each action in actions.ts).
//
// Verify/Provide/Fix (app/AGENTS.md's product promise): migrated from the
// ad hoc "Waiting for your check"/"check this" chips to the real
// vocabulary, same mapping as cv-review.tsx's own migration. A field the
// model traced and is confident about (`verified`) needs no pill at all
// once ticked by default; an unticked/low-confidence/OCR-sourced field is
// Provide (amber) - a human look is needed, but nothing here is marked
// mandatory/required in onboardingScan.ts's data model, so Fix (a genuine
// disqualification risk) never applies to a field on this screen. The
// whole-document "Needs manual review" state (an UNROUTED kind - the model
// couldn't confidently classify it at all) is its own, separate situation -
// not a confidence gap on a known field, but "this tool doesn't recognise
// what this file is" - so it stays a neutral/muted pill rather than being
// forced into Provide.

type Tone = "warning" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  warning: "border-warning/20 bg-warning/10 text-warning",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const fieldClass =
  "min-h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type OnboardingResult = {
  id: string;
  document_kind: DocumentKind;
  document_kind_reason: string | null;
  fields: OnboardingFields;
  warnings: string[];
  text_method: string | null;
  model: string | null;
  created_at: string;
};

function FieldRow({ field, item }: { field: string; item: OnboardingFields[string] }) {
  const label = FIELD_LABELS[field] ?? field;
  const isDate = DATE_FIELDS.has(field);
  const isNumber = NUMBER_FIELDS.has(field);
  const defaultTick = item.verified;
  return (
    <div className="obx-row grid grid-cols-[28px_1fr] items-start gap-2 border-t border-border py-2 sm:grid-cols-[28px_150px_1fr]">
      <input type="checkbox" name={`use_${field}`} defaultChecked={defaultTick} aria-label={`Use ${label}`} className="mt-1 size-[18px] sm:mt-2.5" />
      <div className="flex flex-col gap-1 sm:contents">
        <div className="text-sm font-semibold text-foreground sm:pt-2.5">{label}</div>
        <div>
          <div className="mb-0.5 text-[11px] text-muted-foreground">
            {!item.verified && <Pill tone="warning">Provide - check this</Pill>}
          </div>
          <input
            className={fieldClass}
            name={`f_${field}`}
            type={isDate ? "date" : isNumber ? "number" : "text"}
            step={isNumber ? "any" : undefined}
            defaultValue={item.value ?? ""}
          />
          {item.evidence && (
            <div className="mt-1 text-[11px] break-words text-muted-foreground italic">Document says: &ldquo;{item.evidence}&rdquo;</div>
          )}
          {item.warnings.map((w, i) => (
            <div key={i} className="mt-0.5 text-[11px] text-warning">{w}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyFields({ kind, fields }: { kind: DocumentKind; fields: OnboardingFields }) {
  const names = KIND_FIELDS[kind].filter((f) => READ_ONLY_FIELDS.has(f) && fields[f]);
  if (names.length === 0) return null;
  return (
    <div className="my-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      {names.map((f) => (
        <div key={f}><strong className="text-foreground">{FIELD_LABELS[f] ?? f}:</strong> {String(fields[f].value)}</div>
      ))}
    </div>
  );
}

// Fields KIND_FIELDS asks the AI for but that confirmVaultDocument has no
// companies column to write (see onboardingScan.ts's isFieldPersisted) -
// shown so the reviewer still sees what was read, but with no tick-box and
// no editable input, so confirming can never be mistaken for filing them.
function NotSavedFields({ fields, names }: { fields: OnboardingFields; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="my-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <div className="mb-1 font-semibold text-foreground">Also read from this document (not saved anywhere - for your own check only):</div>
      {names.map((f) => (
        <div key={f} className="mt-0.5">
          <strong className="text-foreground">{FIELD_LABELS[f] ?? f}:</strong> {String(fields[f].value ?? "-")}
          {fields[f].evidence && <span className="italic"> - &ldquo;{fields[f].evidence}&rdquo;</span>}
        </div>
      ))}
    </div>
  );
}

export function DocumentReviewCard({
  result,
  filename,
  principals,
  people,
  companyLegalName,
  returnTo,
}: {
  result: OnboardingResult;
  filename: string;
  principals: { id: string; full_name: string }[];
  people: { id: string; name: string }[];
  companyLegalName?: string | null;
  /** Spec v3 Batch 4: when this card is embedded somewhere other than /company/document-scan (e.g. /experience), send the user back there instead of the default page. Omit to keep the existing behaviour exactly as-is. */
  returnTo?: string;
}) {
  const kind = result.document_kind;
  const editableFields = KIND_FIELDS[kind].filter((f) => !READ_ONLY_FIELDS.has(f) && result.fields[f]);
  const persistedFields = editableFields.filter((f) => isFieldPersisted(kind, f));
  const notSavedFields = editableFields.filter((f) => !isFieldPersisted(kind, f));
  const unrouted = UNROUTED_KINDS.includes(kind);
  const manualLink = MANUAL_REVIEW_LINK[kind];

  // CIDB contractor-name vs. the company's own registered name: a real
  // compliance-mismatch signal (QA-Edge-Case-Findings.md, thirteenth run /
  // commit 2d4c124), shown as a warning - never a blocker, the reviewer
  // can still tick and confirm contractor_name as normal.
  const cidbMismatch =
    kind === "cidb_registration"
      ? cidbNameMismatchWarning(
          (result.fields.contractor_name?.value as string | null) ?? null,
          companyLegalName ?? null,
        )
      : null;

  let confirmAction = confirmVaultDocument;
  if (kind === "experience_reference_letter") confirmAction = confirmExperienceReferenceLetter;
  if (kind === "id_document") confirmAction = confirmIdDocument;
  if (kind === "cv") confirmAction = confirmCvHandoff;

  return (
    <div className={`mb-4 rounded-xl border-2 bg-card p-4 pb-3.5 ${unrouted ? "border-muted-foreground/30" : "border-warning/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div>
          <h3 className="mb-0.5 text-[15px] font-bold text-foreground">{filename}</h3>
          <div className="text-xs text-muted-foreground">
            Detected as <strong>{KIND_LABELS[kind]}</strong>
            {result.document_kind_reason ? ` - ${result.document_kind_reason}` : ""}. Read {new Date(result.created_at).toLocaleDateString()}
            {result.model ? ` by ${result.model}` : ""}.
          </div>
        </div>
        {unrouted ? <Pill tone="muted">Needs manual review</Pill> : <Pill tone="warning">Provide - check before confirming</Pill>}
      </div>

      {result.text_method?.includes("OCR") && (
        <div className="mt-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <strong>Read by OCR from a scan.</strong> Values read from it start unticked - check each one against the original before confirming.
        </div>
      )}
      {result.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}
      {cidbMismatch && (
        <div role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <strong>Name mismatch:</strong> {cidbMismatch}
        </div>
      )}

      {unrouted ? (
        <div className="mt-3">
          <div className="mb-2.5 text-sm text-muted-foreground">
            {kind === "professional_registration_other"
              ? "This looks like a professional-body registration (ECSA, SACPCMP, PSIRA or similar). These have their own page with higher-stakes, per-person detail, so this tool won't guess which person or body it belongs to - add it there instead."
              : "This file couldn't be confidently matched to a document type this tool recognises."}
          </div>
          <ReadOnlyFields kind={kind} fields={result.fields} />
          {editableFields.length > 0 && (
            <div className="mb-2 text-xs text-muted-foreground">
              What was read: {editableFields.map((f) => `${FIELD_LABELS[f] ?? f}: ${result.fields[f].value ?? "-"}`).join("; ")}
            </div>
          )}
          <div className="flex flex-wrap gap-2.5">
            {manualLink && (
              <Link href={manualLink.href} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline">
                {manualLink.label} →
              </Link>
            )}
            <form action={discardOnboardingDocument} className="inline">
              <input type="hidden" name="result_id" value={result.id} />
              {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
              <Button type="submit" variant="destructive" size="lg" className="min-h-11 px-4">Discard - not needed</Button>
            </form>
          </div>
        </div>
      ) : (
        <form action={confirmAction} className="mt-3">
          <input type="hidden" name="result_id" value={result.id} />
          {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
          <ReadOnlyFields kind={kind} fields={result.fields} />

          {kind === "id_document" && (
            <div className="my-2 mb-3">
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Which director / shareholder is this ID for? *
              </label>
              <select name="principal_id" required className={fieldClass}>
                <option value="">- choose -</option>
                {principals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              {principals.length === 0 && (
                <div className="mt-1 text-[11px] text-warning">
                  Nobody is on your directors/shareholders register yet - <Link href="/company/principals" className="text-accent">add them first</Link>, then come back and file this ID.
                </div>
              )}
            </div>
          )}
          {kind === "cv" && (
            <div className="my-2 mb-3">
              <label className="mb-1 block text-xs font-semibold text-foreground">
                Who is this CV for? *
              </label>
              <select name="person_id" required className={fieldClass}>
                <option value="">- choose -</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="mt-1 text-[11px] text-muted-foreground">
                This hands the file to the existing CV upload pipeline for that person (AI field extraction, then their own review card on the People page) - it isn&apos;t extracted again here.
                {people.length === 0 && (
                  <> Nobody is on your People page yet - <Link href="/people" className="text-accent">add them first</Link>.</>
                )}
              </div>
            </div>
          )}

          {editableFields.length === 0 && kind !== "cv" && (
            <div className="my-2 text-sm text-muted-foreground">No fields to confirm - the document itself will still be filed.</div>
          )}
          {kind !== "cv" && persistedFields.map((f) => (
            <FieldRow key={f} field={f} item={result.fields[f]} />
          ))}
          {kind !== "cv" && <NotSavedFields fields={result.fields} names={notSavedFields} />}

          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <Button type="submit" variant="default" size="lg" className="min-h-11 px-5">
              {kind === "cv" ? "Send to the CV pipeline" : "Confirm and file"}
            </Button>
            <Button formAction={skipOnboardingDocument} type="submit" variant="outline" size="lg" className="min-h-11 px-4">Needs manual review instead</Button>
            <Button formAction={discardOnboardingDocument} type="submit" variant="destructive" size="lg" className="min-h-11 px-4">Discard</Button>
          </div>
          {ROUTABLE_KINDS.includes(kind) && kind !== "cv" && kind !== "id_document" && kind !== "experience_reference_letter" && (
            <div className="mt-1.5 text-[11px] text-muted-foreground">Files to your Company profile vault.</div>
          )}
        </form>
      )}
    </div>
  );
}
