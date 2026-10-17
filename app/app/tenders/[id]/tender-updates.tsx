import { createClient } from "@/lib/supabase/server";
import {
  UPDATE_KIND_LABEL,
  URGENCY_STYLE,
  appliedLine,
  closingDateLine,
  formatDay,
  mostUrgent,
  sortUpdates,
  type TenderUpdate,
} from "@/lib/tenderUpdates";
import { formatActivityTime } from "@/lib/tenderActivity";

/**
 * "This tender has been updated" - documents the buyer added after the tender
 * was found (addenda, clarifications, a changed closing or briefing date, a
 * cancellation), read and classified by engine/discovery/watch_tender_updates.py
 * (migration 0039). Renders nothing when there are none. Every change shown
 * carries the line it was read from, so nobody has to trust a summary.
 */

const OTHER_KIND_LABEL: Record<string, string> = {
  scope: "Scope",
  requirement_removed: "Requirement removed",
  wording_replaced: "Wording changed",
  pricing: "Pricing",
  evaluation: "Evaluation criteria",
  cidb: "CIDB grading",
  validity: "Bid validity",
};

const BASIS_LABEL: Record<string, string> = {
  text: "Read from the document",
  ocr: "Read by OCR from a scan - check dates against the document",
  title_only: "Judged from the file name only",
};

export async function TenderUpdates({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tender_watched_documents")
    .select("id, title, url, source, first_seen_at, kind, read_basis, urgency, summary, changes, read_error")
    .eq("tender_id", tenderId)
    .eq("baseline", false)
    .order("first_seen_at", { ascending: false });

  if (error) {
    return (
      <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#B91C1C" }}>
        Could not check this tender for addenda and updates: {error.message}
      </div>
    );
  }
  const updates = sortUpdates((data ?? []) as TenderUpdate[]);
  if (updates.length === 0) return null;

  const top = URGENCY_STYLE[mostUrgent(updates) ?? "info"];
  const addenda = updates.filter((u) => u.kind === "addendum").length;

  return (
    <div id="tender-updates" style={{ background: "#FFFFFF", border: `2px solid ${top.border}`, borderRadius: 12, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>This tender has been updated since it was found</div>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: top.bg, color: top.color, whiteSpace: "nowrap" }}>
          {updates.length} new document{updates.length === 1 ? "" : "s"}
          {addenda > 0 ? ` · ${addenda} addend${addenda === 1 ? "um" : "a"}` : ""}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#6B6758", margin: "4px 0 10px" }}>
        The buyer published these after this tender was first found. Read each one before you submit - an addendum
        usually has to be acknowledged in the bid.
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {updates.map((u) => {
          const style = URGENCY_STYLE[u.urgency ?? "info"];
          const changes = u.changes ?? {};
          const closing = closingDateLine(changes.closing_date);
          const applied = appliedLine(changes.closing_date);
          const briefing = changes.briefing;
          return (
            <li key={u.id} style={{ borderTop: "1px solid #F0EEE6", padding: "10px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color }}>
                  {u.kind ? UPDATE_KIND_LABEL[u.kind] : "New document"} · {style.label}
                </span>
                <span style={{ fontSize: 11, color: "#9A9684" }}>
                  Found {formatActivityTime(u.first_seen_at)} · {u.source === "sanral_page" ? "SANRAL tender page" : "eTenders"}
                </span>
              </div>
              <div style={{ fontSize: 13, color: "#16233B", fontWeight: 600, wordBreak: "break-word" }}>
                {u.url ? (
                  <a href={u.url} target="_blank" rel="noopener noreferrer" style={{ color: "#16233B" }}>
                    {u.title ?? "Untitled document"}
                  </a>
                ) : (
                  (u.title ?? "Untitled document")
                )}
              </div>

              {closing && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "8px 11px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    background: closing.tone === "good" ? "#DCFCE7" : closing.tone === "bad" ? "#FEE2E2" : "#F6F5F1",
                    color: closing.tone === "good" ? "#15803D" : closing.tone === "bad" ? "#B91C1C" : "#16233B",
                  }}
                >
                  {closing.text}
                  {applied && <div style={{ fontSize: 12, fontWeight: 400, marginTop: 3 }}>{applied}</div>}
                </div>
              )}
              {briefing && (
                <div style={{ marginTop: 6, fontSize: 13, color: "#16233B" }}>
                  {briefing.cancelled
                    ? "Briefing session cancelled or no longer compulsory."
                    : `Briefing moved${briefing.previous_date ? ` from ${formatDay(briefing.previous_date)}` : ""} to ${formatDay(briefing.date)}${briefing.time ? ` ${briefing.time}` : ""}.`}
                </div>
              )}
              {!closing && !briefing && u.summary && (
                <div style={{ marginTop: 4, fontSize: 13, color: "#16233B" }}>
                  {/* A summary that is only the file name again says nothing new. */}
                  {u.title && u.summary.includes(u.title) ? "Open it to see what changed." : u.summary}
                </div>
              )}

              {[changes.closing_date?.quote, briefing?.quote].filter(Boolean).map((q) => (
                <Quote key={q} text={q as string} />
              ))}
              {(changes.other_changes ?? []).map((o) => (
                <Quote key={o.quote} label={OTHER_KIND_LABEL[o.kind] ?? o.kind} text={o.quote} />
              ))}

              <div style={{ marginTop: 6, fontSize: 11, color: "#9A9684" }}>
                {u.read_basis ? BASIS_LABEL[u.read_basis] : null}
                {u.read_error ? ` · ${u.read_error}` : null}
              </div>
              {(changes.caveats ?? []).map((c) => (
                <div key={c} style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>
                  {c}
                </div>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Quote({ text, label }: { text: string; label?: string }) {
  return (
    <div style={{ marginTop: 5, padding: "6px 10px", borderLeft: "3px solid #E5E1D5", background: "#FAFAF7", fontSize: 12, color: "#6B6758", wordBreak: "break-word" }}>
      {label && <span style={{ fontWeight: 700, color: "#16233B" }}>{label}: </span>}
      &ldquo;{text}&rdquo;
    </div>
  );
}
