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
      <div className="mb-px text-[10.5px] text-muted-foreground/70">{label}</div>
      <div>{children}</div>
    </div>
  );
}

// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout - navy/muted/border/gold hex -> foreground/muted-foreground/
// border/accent tokens. The confidence pill (every row on this page is
// already below the review threshold) reads destructive under 30, warning
// otherwise - there's no "good" band to show here, by definition of the
// page. The post-submit confirmation row reads the success soft tint.
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
      <div className="border-t border-border bg-success/10 px-4.5 py-2.5 text-xs text-success first:border-t-0">
        Reviewed - marked <strong>{reviewedAs}</strong>: {row.tenderTitle || row.tenderContractNo || "(untitled tender)"} - {itemTitle(row.itemType, row.item)}
      </div>
    );
  }

  const confidence = typeof row.item.confidence === "number" ? row.item.confidence : null;
  const reason = typeof row.item.confidence_reason === "string" ? row.item.confidence_reason : null;
  const quote = typeof row.item.quote === "string" ? row.item.quote : null;
  const document = typeof row.item.document === "string" ? row.item.document : null;
  const lowConfidence = confidence !== null && confidence < 30;

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
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4.5 py-3 text-left font-[inherit] ${open ? "bg-card" : "bg-transparent"}`}
      >
        <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {ITEM_TYPE_LABEL[row.itemType]}
        </span>
        <span className="min-w-0 flex-[1_1_220px] overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold text-foreground">
          {row.tenderTitle || row.tenderContractNo || "(untitled tender)"}
        </span>
        <span className="flex-[0_1_180px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
          {row.tenderBuyer || "-"}
        </span>
        <span className="text-[11px] text-muted-foreground/70">{row.companyId ? "private override" : "shared manifest"}</span>
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
            lowConfidence ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
          }`}
        >
          {confidence ?? "-"}/100
        </span>
        <span className="text-[11px] text-muted-foreground/70">{open ? "hide ▲" : "open ▼"}</span>
      </button>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1 text-[12.5px] text-foreground">
          <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
            <Field label="Contract / reference">{row.tenderContractNo || "-"}</Field>
            <Field label="Buyer">{row.tenderBuyer || "-"}</Field>
            <Field label="Item">{itemTitle(row.itemType, row.item)}</Field>
            <Field label="Document">{document || "-"}</Field>
            <Field label="Confidence">{confidence ?? "-"}/100</Field>
            <Field label="Scope">{row.companyId ? `Company ${row.companyId}'s private documents` : "Shared manifest (every company)"}</Field>
          </div>

          <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <div className="mb-1 font-semibold">Why this confidence</div>
            <div className="text-muted-foreground">{reason || "(no reason recorded)"}</div>
            {quote && (
              <>
                <div className="mt-2 mb-1 font-semibold">Quote from the document</div>
                <div className="whitespace-pre-wrap text-muted-foreground italic">&quot;{quote}&quot;</div>
              </>
            )}
          </div>

          <details className="mb-3">
            <summary className="cursor-pointer text-[11.5px] text-muted-foreground/70">Full extracted item (raw)</summary>
            <pre className="mt-1.5 overflow-x-auto rounded-md border border-border bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
              {JSON.stringify(row.item, null, 2)}
            </pre>
          </details>

          <div className="flex flex-wrap items-end gap-2.5">
            <label className="text-[11px] text-muted-foreground">
              Verdict
              <select
                value={verdict}
                onChange={(e) => setVerdict(e.target.value as typeof verdict)}
                className="mt-0.5 block min-h-11 rounded-md border border-border px-2 text-[12.5px]"
              >
                <option value="correct">Correct - this reading is right</option>
                <option value="corrected">Corrected - the value should be different</option>
                <option value="false_positive">False positive - shouldn&apos;t have been flagged at all</option>
              </select>
            </label>

            {verdict === "corrected" && (
              <label className="flex-[1_1_260px] text-[11px] text-muted-foreground">
                Corrected value (plain text, or JSON for a structured change)
                <textarea
                  value={correctedValueRaw}
                  onChange={(e) => setCorrectedValueRaw(e.target.value)}
                  rows={2}
                  className="mt-0.5 block w-full rounded-md border border-border px-2 py-1.5 font-mono text-[12.5px]"
                />
              </label>
            )}

            <label className="flex-[1_1_220px] text-[11px] text-muted-foreground">
              Note (optional)
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth recording about this call"
                className="mt-0.5 block min-h-11 w-full rounded-md border border-border px-2 text-[12.5px]"
              />
            </label>

            <button
              onClick={submit}
              disabled={pending}
              className={`min-h-11 rounded-md border border-border px-3 text-xs text-white ${pending ? "bg-muted-foreground" : "bg-foreground"}`}
            >
              {pending ? "Saving..." : "Save review"}
            </button>
          </div>

          {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
        </div>
      )}
    </div>
  );
}
