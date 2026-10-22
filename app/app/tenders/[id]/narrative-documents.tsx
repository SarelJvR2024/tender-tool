import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { requestNarrativeDocument, uploadNarrativeFinal } from "./narrative-actions";

/**
 * Cover letter / methodology statement generator (migration 0085) -
 * AI-drafted, grounded in this company's own profile, people, past projects
 * and how they describe their own approach (how_we_work), plus this
 * tender's own facts. Every draft is mechanically checked
 * (engine/narrative/uniqueness.py) against every other company's ready
 * draft of the same kind for the SAME tender, so two submissions can't read
 * the same. The AI draft is a starting point, not the final word - export
 * to Word, edit it, upload the real final version back before using it.
 *
 * See migration 0085's own header comment and docs/specs/Company-Voice-Audit.md
 * for why this directly reopens an earlier, deliberate decision to cut
 * AI-drafted executive summaries/methodology from scope, and what mitigates
 * the same risk this time (Sarel, 2026-10-22).
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
  final_storage_path: string | null;
  final_original_filename: string | null;
  final_uploaded_at: string | null;
  error_message: string | null;
};

const KINDS: { value: NarrativeKind; label: string; blurb: string }[] = [
  { value: "cover_letter", label: "Cover letter", blurb: "A short, tender-specific covering letter." },
  { value: "methodology", label: "Methodology statement", blurb: "How you'll deliver this specific scope of work." },
];

const STATUS: Record<NarrativeStatus, { label: string; bg: string; color: string }> = {
  requested: { label: "Requested - waiting for the AI writer", bg: "#FEF3C7", color: "#B45309" },
  generating: { label: "Writing…", bg: "#FEF3C7", color: "#B45309" },
  ready: { label: "Draft ready", bg: "#DCFCE7", color: "#15803D" },
  failed: { label: "Failed", bg: "#FEE2E2", color: "#B91C1C" },
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
// these two in sync if either changes.
const COLOR_OPTIONS: { value: string; label: string; hex: string }[] = [
  { value: "navy", label: "Navy", hex: "#1A2E4C" },
  { value: "charcoal", label: "Charcoal", hex: "#333333" },
  { value: "forest", label: "Forest", hex: "#1E4D2B" },
  { value: "burgundy", label: "Burgundy", hex: "#6B1E2B" },
  { value: "slate", label: "Slate", hex: "#3C4A5C" },
];

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

export async function NarrativeDocuments({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("narrative_documents")
    .select(
      "id, kind, status, requested_at, generated_storage_path, similarity_flagged, final_storage_path, final_original_filename, final_uploaded_at, error_message",
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
    <div id="narrative-documents" style={card}>
      <AutoRefresh active={active} />
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Cover letter &amp; methodology statement</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 14 }}>
        AI-drafted from your company&apos;s own profile, people, past projects and how you describe your own
        approach - never a generic template. Every draft for this tender is mechanically checked against every
        other company&apos;s draft for the same tender, so two submissions can&apos;t end up reading the same.
        Review it, export to Word, edit it as your own, then upload the final version back here.
      </div>

      {KINDS.map((kind) => {
        const kindDocs = docs.filter((d) => d.kind === kind.value);
        const kindActive = kindDocs.some((d) => d.status === "requested" || d.status === "generating");

        return (
          <div key={kind.value} style={{ borderTop: "1px solid #ECEEF1", paddingTop: 14, marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{kind.label}</div>
            <div style={{ fontSize: 11, color: "#8A93A0", marginBottom: 10 }}>{kind.blurb}</div>

            {!kindActive && (
              <form action={requestNarrativeDocument} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <input type="hidden" name="tender_id" value={tenderId} />
                <input type="hidden" name="kind" value={kind.value} />

                <textarea
                  name="user_guidance"
                  placeholder="Anything specific you want this to cover or emphasise (optional) - e.g. 'focus on our bridge experience' or 'keep it to one page'."
                  rows={2}
                  style={{ fontSize: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid #E3E6EA", resize: "vertical", fontFamily: "inherit" }}
                />

                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#5B6472" }}>
                    Length
                    <select name="style_length" defaultValue="standard" style={{ minHeight: 32, borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12, padding: "0 6px" }}>
                      {LENGTH_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#5B6472" }}>
                    Detail
                    <select name="style_detail" defaultValue="detailed" style={{ minHeight: 32, borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12, padding: "0 6px" }}>
                      {DETAIL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#5B6472" }}>
                    Visual style
                    <select name="style_visual" defaultValue="structured" style={{ minHeight: 32, borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12, padding: "0 6px" }}>
                      {VISUAL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#5B6472" }}>Color</span>
                  {COLOR_OPTIONS.map((c, i) => (
                    <label key={c.value} style={{ display: "inline-flex", cursor: "pointer" }} title={c.label}>
                      <input
                        type="radio"
                        name="style_color"
                        value={c.value}
                        defaultChecked={i === 0}
                        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{ width: 18, height: 18, borderRadius: "50%", background: c.hex, border: "2px solid #FFFFFF", boxShadow: "0 0 0 1px #E3E6EA" }} />
                    </label>
                  ))}
                </fieldset>

                <button
                  type="submit"
                  style={{ alignSelf: "flex-start", minHeight: 36, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}
                >
                  {kindDocs.length > 0 ? "Generate another draft" : `Generate ${kind.label.toLowerCase()}`}
                </button>
              </form>
            )}

            {kindDocs.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {kindDocs.slice(0, 3).map((d) => {
                  const st = STATUS[d.status] ?? { label: d.status, bg: "#ECEEF1", color: "#5B6472" };
                  return (
                    <div key={d.id} style={{ fontSize: 12, color: "#4B5563" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: st.bg, color: st.color }}>
                          {st.label}
                        </span>
                        <span style={{ color: "#8A93A0" }}>requested {new Date(d.requested_at).toLocaleString()}</span>
                        {d.status === "ready" && d.generated_storage_path && signed[d.generated_storage_path] && (
                          <a href={signed[d.generated_storage_path]} style={{ color: "#D97706", fontWeight: 700 }}>
                            Download draft (Word)
                          </a>
                        )}
                      </div>

                      {d.status === "failed" && d.error_message && (
                        <div style={{ color: "#B91C1C", marginTop: 4 }}>{d.error_message}</div>
                      )}

                      {d.status === "ready" && d.similarity_flagged && (
                        <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 8, padding: "8px 10px", marginTop: 6, color: "#B91C1C" }}>
                          This draft reads similar to another submission for this tender, even after being
                          rewritten once for distinctness. Read it carefully and put it in your own words before
                          using it - two similar submissions risk disqualification.
                        </div>
                      )}

                      {d.status === "ready" && !d.final_storage_path && (
                        <form
                          action={uploadNarrativeFinal}
                          encType="multipart/form-data"
                          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}
                        >
                          <input type="hidden" name="tender_id" value={tenderId} />
                          <input type="hidden" name="narrative_document_id" value={d.id} />
                          <input type="file" name="file" required accept=".doc,.docx" style={{ fontSize: 11, maxWidth: 200 }} />
                          <button
                            type="submit"
                            style={{ minHeight: 30, padding: "0 10px", borderRadius: 7, background: "#FFFFFF", color: "#16233B", border: "1px solid #E3E6EA", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                          >
                            Upload your edited version
                          </button>
                        </form>
                      )}

                      {d.final_storage_path && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                          <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "#DCFCE7", color: "#15803D" }}>
                            Final version uploaded
                          </span>
                          {signed[d.final_storage_path] && (
                            <a href={signed[d.final_storage_path]} style={{ color: "#D97706", fontWeight: 700 }}>
                              {d.final_original_filename ?? "Download"}
                            </a>
                          )}
                          {d.final_uploaded_at && (
                            <span style={{ color: "#8A93A0" }}>{new Date(d.final_uploaded_at).toLocaleDateString()}</span>
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
