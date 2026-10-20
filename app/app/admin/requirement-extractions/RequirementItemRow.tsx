"use client";

import { useState, useTransition } from "react";
import { submitRequirementReview } from "./actions";

export type RequirementItemRowData = {
  tenderId: string;
  tenderTitle: string | null;
  tenderContractNo: string | null;
  tenderBuyer: string | null;
  companyId: string | null; // null = the shared manifest; set = one company's private-document override
  itemType: "forms" | "buyer_forms" | "returnables" | "roles" | "person_registrations" | "cidb" | "briefing";
  itemKey: string;
  item: Record<string, unknown>;
};

const ITEM_TYPE_LABEL: Record<RequirementItemRowData["itemType"], string> = {
  forms: "Form",
  buyer_forms: "Buyer form",
  returnables: "Returnable",
  roles: "Role",
  person_registrations: "Person registration",
  cidb: "CIDB",
  briefing: "Briefing",
};

/** This item's own "what is it" label, varying by item_type's own shape. */
function itemTitle(itemType: RequirementItemRowData["itemType"], item: Record<string, unknown>): string {
  switch (itemType) {
    case "forms":
      return (item.label as string) || (item.title as string) || (item.code as string) || "(form)";
    case "buyer_forms":
    case "returnables":
      return (item.label as string) || (item.key as string) || "(item)";
    case "roles":
      return (item.role_code as string) || "(role)";
    case "person_registrations":
      return (item.body as string) || "(registration body)";
    case "cidb":
      return item.grading ? `CIDB grading ${item.grading}` : "CIDB";
    case "briefing":
      return item.compulsory ? "Briefing (compulsory)" : "Briefing";
    default:
      return "(item)";
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "#8A93A0", marginBottom: 1 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

export default function RequirementItemRow({ row }: { row: RequirementItemRowData }) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<"correct" | "corrected" | "false_positive">("correct");
  const [correctedValueRaw, setCorrectedValueRaw] = useState(
    typeof row.item.quote === "string" ? (row.item.quote as string) : "",
  );
  const [note, setNote] = useState("");
  const [reviewedAs, setReviewedAs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (reviewedAs) {
    // Dropped out of the active queue without a full page reload - left as
    // a thin confirmation row rather than vanishing outright, so an admin
    // working down the list can still see what they just did.
    return (
      <div style={{ borderTop: "1px solid #ECEEF1", padding: "10px 18px", fontSize: 12, color: "#15803D", background: "#F8FFFB" }}>
        Reviewed - marked <strong>{reviewedAs}</strong>: {row.tenderTitle || row.tenderContractNo || "(untitled tender)"} - {itemTitle(row.itemType, row.item)}
      </div>
    );
  }

  const confidence = typeof row.item.confidence === "number" ? row.item.confidence : null;
  const reason = typeof row.item.confidence_reason === "string" ? row.item.confidence_reason : null;
  const quote = typeof row.item.quote === "string" ? row.item.quote : null;
  const document = typeof row.item.document === "string" ? row.item.document : null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await submitRequirementReview({
        tenderId: row.tenderId,
        itemKey: row.itemKey,
        itemType: row.itemType,
        itemSnapshot: row.item,
        verdict,
        correctedValueRaw: verdict === "corrected" ? correctedValueRaw : null,
        note: note || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReviewedAs(verdict);
    });
  }

  return (
    <div style={{ borderTop: "1px solid #ECEEF1" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center",
          padding: "12px 18px", background: open ? "#FFFFFF" : "transparent", border: "none",
          textAlign: "left", cursor: "pointer", font: "inherit", boxSizing: "border-box",
        }}
      >
        <span style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "#F1F5F9", color: "#5B6472" }}>
          {ITEM_TYPE_LABEL[row.itemType]}
        </span>
        <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "#16233B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.tenderTitle || row.tenderContractNo || "(untitled tender)"}
        </span>
        <span style={{ fontSize: 12, color: "#5B6472", flex: "0 1 180px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.tenderBuyer || "-"}
        </span>
        <span style={{ fontSize: 11, color: "#8A93A0" }}>{row.companyId ? "private override" : "shared manifest"}</span>
        <span
          style={{
            display: "inline-flex", padding: "3px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600,
            background: confidence !== null && confidence < 30 ? "#FEE2E2" : "#FEF3C7",
            color: confidence !== null && confidence < 30 ? "#B91C1C" : "#B45309",
          }}
        >
          {confidence ?? "-"}/100
        </span>
        <span style={{ fontSize: 11, color: "#8A93A0" }}>{open ? "hide ▲" : "open ▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 18px 18px", background: "#FFFFFF", fontSize: 12.5, color: "#16233B" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 14 }}>
            <Field label="Contract / reference">{row.tenderContractNo || "-"}</Field>
            <Field label="Buyer">{row.tenderBuyer || "-"}</Field>
            <Field label="Item">{itemTitle(row.itemType, row.item)}</Field>
            <Field label="Document">{document || "-"}</Field>
            <Field label="Confidence">{confidence ?? "-"}/100</Field>
            <Field label="Scope">{row.companyId ? `Company ${row.companyId}'s private documents` : "Shared manifest (every company)"}</Field>
          </div>

          <div style={{ background: "#FAFBFC", border: "1px solid #E3E6EA", borderRadius: 9, padding: "11px 14px", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Why this confidence</div>
            <div style={{ color: "#5B6472" }}>{reason || "(no reason recorded)"}</div>
            {quote && (
              <>
                <div style={{ fontWeight: 600, marginTop: 8, marginBottom: 4 }}>Quote from the document</div>
                <div style={{ color: "#5B6472", fontStyle: "italic", whiteSpace: "pre-wrap" }}>&quot;{quote}&quot;</div>
              </>
            )}
          </div>

          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 11.5, color: "#8A93A0" }}>Full extracted item (raw)</summary>
            <pre style={{ fontSize: 11, color: "#5B6472", background: "#FAFBFC", border: "1px solid #E3E6EA", borderRadius: 7, padding: 10, overflowX: "auto", marginTop: 6 }}>
              {JSON.stringify(row.item, null, 2)}
            </pre>
          </details>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
            <label style={{ fontSize: 11, color: "#5B6472" }}>
              Verdict
              <select
                value={verdict}
                onChange={(e) => setVerdict(e.target.value as typeof verdict)}
                style={{ display: "block", marginTop: 2, padding: "6px 8px", borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12.5 }}
              >
                <option value="correct">Correct - this reading is right</option>
                <option value="corrected">Corrected - the value should be different</option>
                <option value="false_positive">False positive - shouldn&apos;t have been flagged at all</option>
              </select>
            </label>

            {verdict === "corrected" && (
              <label style={{ fontSize: 11, color: "#5B6472", flex: "1 1 260px" }}>
                Corrected value (plain text, or JSON for a structured change)
                <textarea
                  value={correctedValueRaw}
                  onChange={(e) => setCorrectedValueRaw(e.target.value)}
                  rows={2}
                  style={{ display: "block", width: "100%", marginTop: 2, padding: "6px 8px", borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12.5, boxSizing: "border-box", fontFamily: "monospace" }}
                />
              </label>
            )}

            <label style={{ fontSize: 11, color: "#5B6472", flex: "1 1 220px" }}>
              Note (optional)
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth recording about this call"
                style={{ display: "block", width: "100%", marginTop: 2, padding: "6px 8px", borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12.5, boxSizing: "border-box" }}
              />
            </label>

            <button
              onClick={submit}
              disabled={pending}
              style={{ fontSize: 12, padding: "7px 12px", borderRadius: 7, border: "1px solid #E3E6EA", background: pending ? "#8A93A0" : "#16233B", color: "#FFFFFF", cursor: pending ? "default" : "pointer" }}
            >
              {pending ? "Saving..." : "Save review"}
            </button>
          </div>

          {error && <div style={{ color: "#B91C1C", fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
