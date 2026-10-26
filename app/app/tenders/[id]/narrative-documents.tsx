import { Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { requestNarrativeDocument, uploadNarrativeFinal } from "./narrative-actions";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Cover letter / methodology statement generator (migration 0087) -
 * AI-drafted, grounded in this company's own profile, people, past projects
 * and how they describe their own approach (how_we_work), plus this
 * tender's own facts. Every draft is mechanically checked
 * (engine/narrative/uniqueness.py) against every other company's ready
 * draft of the same kind for the SAME tender, so two submissions can't read
 * the same. The AI draft is a starting point, not the final word - export
 * to Word, edit it, upload the real final version back before using it.
 *
 * See migration 0087's own header comment and docs/specs/Company-Voice-Audit.md
 * for why this directly reopens an earlier, deliberate decision to cut
 * AI-drafted executive summaries/methodology from scope, and what mitigates
 * the same risk this time (Sarel, 2026-10-22).
 *
 * Color-token migration (Tender Workspace overhaul, 2026-10-25): this file
 * was missed by the earlier design-system color-migration initiative
 * (app/AGENTS.md's own "batch 1-5" history) and was still on the pre-
 * 2026-10-21 literal-hex scheme throughout - converted to the same
 * Tailwind token classes every other migrated file in this directory uses.
 * COLOR_OPTIONS below is the one deliberate exception: those 5 hex values
 * are the actual generated-document theme colors (kept in sync with
 * engine/narrative/build_docx.py's own COLOR_THEMES), not UI chrome - a
 * color swatch picker's own swatches are real content, same exception this
 * app's email-template hex already has for the identical reason.
 */

type NarrativeKind = "cover_letter" | "methodology";
type NarrativeStatus = "requested" | "generating" | "ready" | "failed";

type NarrativeDoc = {
  id: string;
  kind: NarrativeKind;
  status: NarrativeStatus;
  requested_at: string;
  generated_storage_path: string | null;
  similarity_flagged: boolean;
  quality_flagged: boolean;
  final_storage_path: string | null;
  final_original_filename: string | null;
  final_uploaded_at: string | null;
  error_message: string | null;
};

const KINDS: { value: NarrativeKind; label: string; blurb: string }[] = [
  { value: "cover_letter", label: "Cover letter", blurb: "A short, tender-specific covering letter." },
  { value: "methodology", label: "Methodology statement", blurb: "How you'll deliver this specific scope of work." },
];

const STATUS: Record<NarrativeStatus, { label: string; className: string }> = {
  requested: { label: "Requested - waiting for the AI writer", className: "bg-warning/10 text-warning" },
  generating: { label: "Writing…", className: "bg-warning/10 text-warning" },
  ready: { label: "Draft ready", className: "bg-success/10 text-success" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};

const LENGTH_OPTIONS = [
  { value: "concise", label: "Concise" },
  { value: "standard", label: "Standard" },
  { value: "thorough", label: "Thorough" },
];
const DETAIL_OPTIONS = [
  { value: "high_level", label: "High-level" },
  { value: "detailed", label: "Detailed" },
  { value: "highly_technical", label: "Highly technical" },
];
const VISUAL_OPTIONS = [
  { value: "plain", label: "Plain" },
  { value: "structured", label: "Structured" },
  { value: "visual_rich", label: "Visually rich" },
];
// Same hex values as engine/narrative/build_docx.py's own COLOR_THEMES - keep
// these two in sync if either changes. Deliberately literal, not tokens -
// see this file's own header comment.
const COLOR_OPTIONS: { value: string; label: string; hex: string }[] = [
  { value: "navy", label: "Navy", hex: "#1A2E4C" },
  { value: "charcoal", label: "Charcoal", hex: "#333333" },
  { value: "forest", label: "Forest", hex: "#1E4D2B" },
  { value: "burgundy", label: "Burgundy", hex: "#6B1E2B" },
  { value: "slate", label: "Slate", hex: "#3C4A5C" },
];

export async function NarrativeDocuments({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("narrative_documents")
    .select(
      "id, kind, status, requested_at, generated_storage_path, similarity_flagged, quality_flagged, final_storage_path, final_original_filename, final_uploaded_at, error_message",
    )
    .eq("tender_id", tenderId)
    .order("requested_at", { ascending: false })
    .limit(20);
  const docs = (rows ?? []) as NarrativeDoc[];
  const active = docs.some((d) => d.status === "requested" || d.status === "generating");

  // Signed links for ready drafts and uploaded finals (private bucket, 10
  // min - same TTL submission-pack.tsx uses for the same reason).
  const paths = docs.flatMap((d) => [d.generated_storage_path, d.final_storage_path]).filter((p): p is string => !!p);
  const signed: Record<string, string> = {};
  if (paths.length > 0) {
    const results = await Promise.all(paths.map((p) => supabase.storage.from("narrative-documents").createSignedUrl(p, 600)));
    results.forEach((r, i) => {
      if (r.data?.signedUrl) signed[paths[i]] = r.data.signedUrl;
    });
  }

  return (
    <div id="narrative-documents" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <AutoRefresh active={active} />
      <div className="mb-0.5 flex items-center gap-1.5">
        <div className="text-[15px] font-bold text-foreground">Cover letter &amp; methodology statement</div>
        <Tooltip>
          <TooltipTrigger
            aria-label="How these drafts are written"
            className="inline-flex size-4 flex-none items-center justify-center rounded-full text-muted-foreground"
          >
            <Info size={14} aria-hidden />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-left font-normal">
            AI-drafted from your company&apos;s own profile, people, past projects and how you describe your own
            approach - never a generic template. Every draft for this tender is mechanically checked against every
            other company&apos;s draft for the same tender, so two submissions can&apos;t end up reading the same.
            Review it, export to Word, edit it as your own, then upload the final version back here.
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="mb-3.5 text-xs text-muted-foreground">
        AI-drafted from your own profile and past work - review, edit, then upload the final version.
      </div>

      {KINDS.map((kind) => {
        const kindDocs = docs.filter((d) => d.kind === kind.value);
        const kindActive = kindDocs.some((d) => d.status === "requested" || d.status === "generating");

        return (
          <div key={kind.value} className="mt-3.5 border-t border-border pt-3.5">
            <div className="text-[13px] font-bold text-foreground">{kind.label}</div>
            <div className="mb-2.5 text-[11px] text-muted-foreground">{kind.blurb}</div>

            {!kindActive && (
              <form action={requestNarrativeDocument} className="flex flex-col gap-2.5">
                <input type="hidden" name="tender_id" value={tenderId} />
                <input type="hidden" name="kind" value={kind.value} />

                <textarea
                  name="user_guidance"
                  placeholder="Anything specific you want this to cover or emphasise (optional) - e.g. 'focus on our bridge experience' or 'keep it to one page'."
                  rows={2}
                  className="resize-y rounded-lg border border-border px-2.5 py-2 font-[inherit] text-xs"
                />

                <div className="flex flex-wrap gap-3.5">
                  <label className="flex flex-col gap-[3px] text-[11px] text-muted-foreground">
                    Length
                    <select name="style_length" defaultValue="standard" className="min-h-8 rounded-[7px] border border-border px-1.5 text-xs">
                      {LENGTH_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-[3px] text-[11px] text-muted-foreground">
                    Detail
                    <select name="style_detail" defaultValue="detailed" className="min-h-8 rounded-[7px] border border-border px-1.5 text-xs">
                      {DETAIL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-[3px] text-[11px] text-muted-foreground">
                    Visual style
                    <select name="style_visual" defaultValue="structured" className="min-h-8 rounded-[7px] border border-border px-1.5 text-xs">
                      {VISUAL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <fieldset className="flex items-center gap-2 border-none p-0">
                  <span className="text-[11px] text-muted-foreground">Color</span>
                  {COLOR_OPTIONS.map((c, i) => (
                    <label key={c.value} className="inline-flex cursor-pointer" title={c.label}>
                      <input
                        type="radio"
                        name="style_color"
                        value={c.value}
                        defaultChecked={i === 0}
                        className="absolute h-0 w-0 opacity-0"
                      />
                      <span
                        className="h-[18px] w-[18px] rounded-full border-2 border-card shadow-[0_0_0_1px_var(--border)]"
                        style={{ background: c.hex }}
                      />
                    </label>
                  ))}
                </fieldset>

                <button
                  type="submit"
                  className="min-h-9 cursor-pointer self-start rounded-lg border-none bg-foreground px-4 text-xs font-semibold whitespace-nowrap text-white"
                >
                  {kindDocs.length > 0 ? "Generate another draft" : `Generate ${kind.label.toLowerCase()}`}
                </button>
              </form>
            )}

            {kindDocs.length > 0 && (
              <div className="mt-3 flex flex-col gap-2.5">
                {kindDocs.slice(0, 3).map((d) => {
                  const st = STATUS[d.status] ?? { label: d.status, className: "bg-muted text-muted-foreground" };
                  return (
                    <div key={d.id} className="text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-full px-[9px] py-0.5 text-[11px] font-semibold ${st.className}`}>
                          {st.label}
                        </span>
                        <span className="text-muted-foreground">requested {(formatDateTime(d.requested_at) ?? "—")}</span>
                        {d.status === "ready" && d.generated_storage_path && signed[d.generated_storage_path] && (
                          <a href={signed[d.generated_storage_path]} className="font-bold text-accent">
                            Download draft (Word)
                          </a>
                        )}
                      </div>

                      {d.status === "failed" && d.error_message && (
                        <div className="mt-1 text-destructive">{d.error_message}</div>
                      )}

                      {d.status === "ready" && d.similarity_flagged && (
                        <div className="mt-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-destructive">
                          This draft reads similar to another submission for this tender, even after being
                          rewritten once for distinctness. Read it carefully and put it in your own words before
                          using it - two similar submissions risk disqualification.
                        </div>
                      )}

                      {d.status === "ready" && d.quality_flagged && (
                        <div className="mt-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-warning">
                          This draft still had issues on its own final review pass - read it closely before
                          using it. It&apos;s a starting point for you to correct, not a finished document.
                        </div>
                      )}

                      {d.status === "ready" && !d.final_storage_path && (
                        <form
                          action={uploadNarrativeFinal}
                          encType="multipart/form-data"
                          className="mt-1.5 flex flex-wrap items-center gap-2"
                        >
                          <input type="hidden" name="tender_id" value={tenderId} />
                          <input type="hidden" name="narrative_document_id" value={d.id} />
                          <input type="file" name="file" required accept=".doc,.docx" className="max-w-[200px] text-[11px]" />
                          <button
                            type="submit"
                            className="min-h-[30px] cursor-pointer rounded-md border border-border bg-card px-2.5 text-[11px] font-semibold text-foreground"
                          >
                            Upload your edited version
                          </button>
                        </form>
                      )}

                      {d.final_storage_path && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full bg-success/10 px-[9px] py-0.5 text-[11px] font-semibold text-success">
                            Final version uploaded
                          </span>
                          {signed[d.final_storage_path] && (
                            <a href={signed[d.final_storage_path]} className="font-bold text-accent">
                              {d.final_original_filename ?? "Download"}
                            </a>
                          )}
                          {d.final_uploaded_at && (
                            <span className="text-muted-foreground">{(formatDate(d.final_uploaded_at) ?? "—")}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
