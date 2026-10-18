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

// Confirm-or-correct card for one AI-classified onboarding document
// (onboarding_document_results, 0063). Deliberately the same shape as
// app/app/people/[id]/cv-review.tsx: per field, a tick (default-checked
// only when traced to the document and not flagged), an editable value,
// the source quote, and any warning - nothing is saved until Confirm, and
// only the ticked fields are used (see each action in actions.ts).

const NAVY = "#16233B";
const MUTED = "#6B6758";
const FAINT = "#9A9684";
const BORDER = "#E5E1D5";

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 40, padding: "0 10px",
  borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13, fontFamily: "system-ui, sans-serif",
  color: NAVY, background: "#FFFFFF",
};
const chip = (bg: string, color: string): React.CSSProperties => ({
  display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color,
});
const btnPrimary: React.CSSProperties = { minHeight: 44, padding: "0 18px", borderRadius: 10, background: NAVY, color: "#FFFFFF", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" };
const btnGhost: React.CSSProperties = { minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#FFFFFF", color: "#6B6758", fontWeight: 600, fontSize: 13, border: `1px solid ${BORDER}`, cursor: "pointer" };
const btnDanger: React.CSSProperties = { minHeight: 44, padding: "0 16px", borderRadius: 10, background: "#FFFFFF", color: "#B91C1C", fontWeight: 600, fontSize: 13, border: "1px solid #FCA5A5", cursor: "pointer" };

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
    <div className="obx-row" style={{ display: "grid", gridTemplateColumns: "28px 150px 1fr", gap: 8, alignItems: "start", padding: "8px 0", borderTop: "1px solid #F0EEE6" }}>
      <input type="checkbox" name={`use_${field}`} defaultChecked={defaultTick} aria-label={`Use ${label}`} style={{ width: 18, height: 18, marginTop: 10 }} />
      <div style={{ fontSize: 13, fontWeight: 600, color: NAVY, paddingTop: 10 }}>{label}</div>
      <div>
        <div style={{ fontSize: 11, color: FAINT, marginBottom: 2 }}>
          {!item.verified && <span style={chip("#FEF3C7", "#B45309")}>check this</span>}
        </div>
        <input
          style={input}
          name={`f_${field}`}
          type={isDate ? "date" : isNumber ? "number" : "text"}
          step={isNumber ? "any" : undefined}
          defaultValue={item.value ?? ""}
        />
        {item.evidence && (
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3, fontStyle: "italic", wordBreak: "break-word" }}>Document says: &ldquo;{item.evidence}&rdquo;</div>
        )}
        {item.warnings.map((w, i) => (
          <div key={i} style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>{w}</div>
        ))}
      </div>
    </div>
  );
}

function ReadOnlyFields({ kind, fields }: { kind: DocumentKind; fields: OnboardingFields }) {
  const names = KIND_FIELDS[kind].filter((f) => READ_ONLY_FIELDS.has(f) && fields[f]);
  if (names.length === 0) return null;
  return (
    <div style={{ background: "#F6F5F1", borderRadius: 9, padding: "9px 12px", margin: "8px 0", fontSize: 12, color: MUTED }}>
      {names.map((f) => (
        <div key={f}><strong style={{ color: NAVY }}>{FIELD_LABELS[f] ?? f}:</strong> {String(fields[f].value)}</div>
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
    <div style={{ background: "#F6F5F1", borderRadius: 9, padding: "9px 12px", margin: "8px 0", fontSize: 12, color: MUTED }}>
      <div style={{ fontWeight: 600, color: NAVY, marginBottom: 4 }}>Also read from this document (not saved anywhere - for your own check only):</div>
      {names.map((f) => (
        <div key={f} style={{ marginTop: 3 }}>
          <strong style={{ color: NAVY }}>{FIELD_LABELS[f] ?? f}:</strong> {String(fields[f].value ?? "-")}
          {fields[f].evidence && <span style={{ fontStyle: "italic" }}> - &ldquo;{fields[f].evidence}&rdquo;</span>}
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
}: {
  result: OnboardingResult;
  filename: string;
  principals: { id: string; full_name: string }[];
  people: { id: string; name: string }[];
}) {
  const kind = result.document_kind;
  const editableFields = KIND_FIELDS[kind].filter((f) => !READ_ONLY_FIELDS.has(f) && result.fields[f]);
  const persistedFields = editableFields.filter((f) => isFieldPersisted(kind, f));
  const notSavedFields = editableFields.filter((f) => !isFieldPersisted(kind, f));
  const unrouted = UNROUTED_KINDS.includes(kind);
  const manualLink = MANUAL_REVIEW_LINK[kind];

  let confirmAction = confirmVaultDocument;
  if (kind === "experience_reference_letter") confirmAction = confirmExperienceReferenceLetter;
  if (kind === "id_document") confirmAction = confirmIdDocument;
  if (kind === "cv") confirmAction = confirmCvHandoff;

  return (
    <div style={{ background: "#FFFFFF", border: `2px solid ${unrouted ? "#9A9684" : "#D97706"}`, borderRadius: 12, padding: "16px 16px 14px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: NAVY, margin: "0 0 2px" }}>{filename}</h3>
          <div style={{ fontSize: 12, color: MUTED }}>
            Detected as <strong>{KIND_LABELS[kind]}</strong>
            {result.document_kind_reason ? ` - ${result.document_kind_reason}` : ""}. Read {new Date(result.created_at).toLocaleDateString()}
            {result.model ? ` by ${result.model}` : ""}.
          </div>
        </div>
        <span style={chip(unrouted ? "#F0EEE6" : "#FEF3C7", unrouted ? MUTED : "#B45309")}>
          {unrouted ? "Needs manual review" : "Waiting for your check"}
        </span>
      </div>

      {result.text_method?.includes("OCR") && (
        <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "9px 12px", margin: "12px 0 0", fontSize: 12, color: "#1E3A8A" }}>
          <strong>Read by OCR from a scan.</strong> Values read from it start unticked - check each one against the original before confirming.
        </div>
      )}
      {result.warnings.length > 0 && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "9px 12px", margin: "12px 0 0", fontSize: 12, color: "#92400E" }}>
          {result.warnings.map((w, i) => <div key={i}>{w}</div>)}
        </div>
      )}

      {unrouted ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>
            {kind === "professional_registration_other"
              ? "This looks like a professional-body registration (ECSA, SACPCMP, PSIRA or similar). These have their own page with higher-stakes, per-person detail, so this tool won't guess which person or body it belongs to - add it there instead."
              : "This file couldn't be confidently matched to a document type this tool recognises."}
          </div>
          <ReadOnlyFields kind={kind} fields={result.fields} />
          {editableFields.length > 0 && (
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>
              What was read: {editableFields.map((f) => `${FIELD_LABELS[f] ?? f}: ${result.fields[f].value ?? "-"}`).join("; ")}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {manualLink && (
              <Link href={manualLink.href} style={{ ...btnPrimary, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                {manualLink.label} →
              </Link>
            )}
            <form action={discardOnboardingDocument} style={{ display: "inline" }}>
              <input type="hidden" name="result_id" value={result.id} />
              <button type="submit" style={btnDanger}>Discard - not needed</button>
            </form>
          </div>
        </div>
      ) : (
        <form action={confirmAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="result_id" value={result.id} />
          <ReadOnlyFields kind={kind} fields={result.fields} />

          {kind === "id_document" && (
            <div style={{ margin: "8px 0 12px" }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: NAVY, display: "block", marginBottom: 4 }}>
                Which director / shareholder is this ID for? *
              </label>
              <select name="principal_id" required style={input}>
                <option value="">- choose -</option>
                {principals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              {principals.length === 0 && (
                <div style={{ fontSize: 11, color: "#B45309", marginTop: 4 }}>
                  Nobody is on your directors/shareholders register yet - <Link href="/company/principals" style={{ color: "#D97706" }}>add them first</Link>, then come back and file this ID.
                </div>
              )}
            </div>
          )}
          {kind === "cv" && (
            <div style={{ margin: "8px 0 12px" }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: NAVY, display: "block", marginBottom: 4 }}>
                Who is this CV for? *
              </label>
              <select name="person_id" required style={input}>
                <option value="">- choose -</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                This hands the file to the existing CV upload pipeline for that person (AI field extraction, then their own review card on the People page) - it isn&apos;t extracted again here.
                {people.length === 0 && (
                  <> Nobody is on your People page yet - <Link href="/people" style={{ color: "#D97706" }}>add them first</Link>.</>
                )}
              </div>
            </div>
          )}

          {editableFields.length === 0 && kind !== "cv" && (
            <div style={{ fontSize: 13, color: MUTED, margin: "8px 0" }}>No fields to confirm - the document itself will still be filed.</div>
          )}
          {kind !== "cv" && persistedFields.map((f) => (
            <FieldRow key={f} field={f} item={result.fields[f]} />
          ))}
          {kind !== "cv" && <NotSavedFields fields={result.fields} names={notSavedFields} />}

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button type="submit" style={btnPrimary}>
              {kind === "cv" ? "Send to the CV pipeline" : "Confirm and file"}
            </button>
            <button formAction={skipOnboardingDocument} type="submit" style={btnGhost}>Needs manual review instead</button>
            <button formAction={discardOnboardingDocument} type="submit" style={btnDanger}>Discard</button>
          </div>
          {ROUTABLE_KINDS.includes(kind) && kind !== "cv" && kind !== "id_document" && kind !== "experience_reference_letter" && (
            <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Files to your Company profile vault.</div>
          )}
        </form>
      )}
    </div>
  );
}
