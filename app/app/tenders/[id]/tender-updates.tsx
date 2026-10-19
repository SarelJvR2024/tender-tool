import { createClient } from "@/lib/supabase/server";
import {
  UPDATE_KIND_LABEL,
  URGENCY_STYLE,
  appliedLine,
  briefingNeedsDecision,
  closingDateLine,
  closingNeedsDecision,
  formatDay,
  mostUrgent,
  sortUpdates,
  type Acceptance,
  type TenderUpdate,
} from "@/lib/tenderUpdates";
import { formatActivityTime } from "@/lib/tenderActivity";
import { closingDayOf } from "@/lib/dates";
import { acceptTenderUpdateDate } from "./update-actions";

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

// Same stages the watch alerts and accept_tender_update_date() (0048) allows.
const ACTIVE_STAGES = ["found", "bidding", "submitted"];

export async function TenderUpdates({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [{ data, error }, { data: tender }, { data: pack }, { data: labelRows }] = await Promise.all([
    supabase
      .from("tender_watched_documents")
      .select("id, title, url, source, first_seen_at, kind, read_basis, urgency, summary, changes, read_error")
      .eq("tender_id", tenderId)
      .eq("baseline", false)
      .order("first_seen_at", { ascending: false }),
    supabase.from("tenders").select("closing_date, briefing_date, briefing_time").eq("id", tenderId).maybeSingle(),
    // RLS: only the signed-in user's own company's pack.
    supabase.from("tender_packs").select("company_id, pipeline_stage").eq("tender_id", tenderId).maybeSingle(),
    supabase.rpc("company_member_labels"),
  ]);
  const canAccept = !!pack && ACTIVE_STAGES.includes(pack.pipeline_stage as string);
  const labels = new Map<string, string>();
  for (const r of (labelRows ?? []) as { user_id: string; label: string }[]) labels.set(r.user_id, r.label);
  const acceptedBy = (a: Acceptance): string => {
    if (pack && a.accepted_by_company && a.accepted_by_company !== pack.company_id) return "another company working on this tender";
    if (a.accepted_by && a.accepted_by === user?.id) return "you";
    return (a.accepted_by && labels.get(a.accepted_by)) || "a former member";
  };
  const closingOnFile = (tender?.closing_date as string | null) ?? null;
  const briefingOnFile = (tender?.briefing_date as string | null) ?? null;

  if (error) {
    return (
      <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 12, color: "#B91C1C" }}>
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
      <div style={{ fontSize: 12, color: "#5B6472", margin: "4px 0 10px" }}>
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
            <li key={u.id} style={{ borderTop: "1px solid #ECEEF1", padding: "10px 0" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                <span style={{ display: "inline-flex", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: style.bg, color: style.color }}>
                  {u.kind ? UPDATE_KIND_LABEL[u.kind] : "New document"} · {style.label}
                </span>
                <span style={{ fontSize: 11, color: "#8A93A0" }}>
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

              {closing && changes.closing_date && closingNeedsDecision(changes.closing_date) ? (
                <DateDisagreement
                  heading="The closing date in this document isn't the one on file"
                  rows={[
                    { label: "This document says", value: `${formatDay(changes.closing_date.date)}${changes.closing_date.time ? ` ${changes.closing_date.time}` : ""}`, strong: true },
                    {
                      label: u.source === "sanral_page" ? "SANRAL's tender page shows" : "The buyer's eTenders listing shows",
                      value: changes.closing_date.listing_date ? formatDay(changes.closing_date.listing_date) : "no closing date",
                    },
                    { label: "On file here", value: closingOnFile ? formatDay(closingDayOf(closingOnFile)) : "no closing date" },
                  ]}
                  note={`${closing.text} Not applied automatically, because the buyer's own listing doesn't show this date. Check the document (and with the buyer if in doubt) before accepting it - accepting moves the closing date, its countdown, every company's “Tender closes” task and the Discovery entry.`}
                  form={canAccept ? { tenderId, documentId: u.id, change: "closing_date", label: `Accept ${formatDay(changes.closing_date.date)} as the closing date` } : null}
                />
              ) : (
                closing && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "8px 11px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      background: closing.tone === "good" ? "#DCFCE7" : closing.tone === "bad" ? "#FEE2E2" : "#FFFFFF",
                      color: closing.tone === "good" ? "#15803D" : closing.tone === "bad" ? "#B91C1C" : "#16233B",
                    }}
                  >
                    {closing.text}
                    {applied && <div style={{ fontSize: 12, fontWeight: 400, marginTop: 3 }}>{applied}</div>}
                    {changes.closing_date?.accepted_at && (
                      <div style={{ fontSize: 12, fontWeight: 400, marginTop: 3 }}>
                        Accepted by {acceptedBy(changes.closing_date)} on {formatActivityTime(changes.closing_date.accepted_at)}
                        {changes.closing_date.listing_date ? ` - the listing showed ${formatDay(changes.closing_date.listing_date)}` : ""}.
                      </div>
                    )}
                  </div>
                )
              )}
              {briefing && briefingNeedsDecision(briefing) ? (
                <DateDisagreement
                  heading="The briefing date in this document doesn't match the one on file"
                  rows={[
                    { label: "This document says", value: `${formatDay(briefing.date)}${briefing.time ? ` ${briefing.time}` : ""}`, strong: true },
                    { label: "It says the original was", value: briefing.previous_date ? formatDay(briefing.previous_date) : "not stated" },
                    { label: "On file here", value: briefingOnFile ? formatDay(briefingOnFile) : "no briefing date" },
                  ]}
                  note="Not applied automatically, because the document's original briefing date isn't the one on file. Accepting it moves the briefing date and every company's “Briefing session” task."
                  form={canAccept ? { tenderId, documentId: u.id, change: "briefing", label: `Accept ${formatDay(briefing.date)} as the briefing date` } : null}
                />
              ) : (
                briefing && (
                  <div style={{ marginTop: 6, fontSize: 13, color: "#16233B" }}>
                    {briefing.cancelled
                      ? "Briefing session cancelled or no longer compulsory."
                      : `Briefing moved${briefing.previous_date ? ` from ${formatDay(briefing.previous_date)}` : ""} to ${formatDay(briefing.date)}${briefing.time ? ` ${briefing.time}` : ""}.`}
                    {briefing.applied && (
                      <div style={{ fontSize: 12, color: "#5B6472", marginTop: 2 }}>
                        {briefing.accepted_at
                          ? `Accepted by ${acceptedBy(briefing)} on ${formatActivityTime(briefing.accepted_at)} - the briefing date and the “Briefing session” task now show it.`
                          : "The briefing date on file and the “Briefing session” task have been updated."}
                      </div>
                    )}
                  </div>
                )
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

              <div style={{ marginTop: 6, fontSize: 11, color: "#8A93A0" }}>
                {u.read_basis ? BASIS_LABEL[u.read_basis] : null}
                {u.read_error ? ` · ${u.read_error}` : null}
              </div>
              {(changes.caveats ?? [])
                // Once a person accepted the document's date, "confirm with the
                // buyer" is history - the accepted line above says what was done.
                .filter((c) => !(changes.closing_date?.accepted_at && c.startsWith("The listing still shows")))
                .filter((c) => !(changes.briefing?.accepted_at && c.startsWith("The briefing date on file is")))
                .map((c) => (
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

/**
 * Two dates that disagree, side by side, flagged - and, for a company working
 * on this tender, the button that accepts the document's date.
 */
function DateDisagreement({
  heading,
  rows,
  note,
  form,
}: {
  heading: string;
  rows: { label: string; value: string; strong?: boolean }[];
  note: string;
  form: { tenderId: string; documentId: string; change: "closing_date" | "briefing"; label: string } | null;
}) {
  return (
    <div style={{ marginTop: 6, padding: "10px 12px", borderRadius: 8, background: "#FEF3C7", border: "1px solid #FCD34D" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309", marginBottom: 8 }}>&#9888; {heading}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {rows.map((r) => (
          <div
            key={r.label}
            style={{ flex: "1 1 150px", minWidth: 0, background: "#FFFFFF", border: `1px solid ${r.strong ? "#D97706" : "#E3E6EA"}`, borderRadius: 8, padding: "7px 10px" }}
          >
            <div style={{ fontSize: 11, color: "#5B6472" }}>{r.label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#16233B" }}>{r.value}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#5B6472", marginTop: 8 }}>{note}</div>
      {form ? (
        <form action={acceptTenderUpdateDate} style={{ marginTop: 8 }}>
          <input type="hidden" name="tender_id" value={form.tenderId} />
          <input type="hidden" name="watched_document_id" value={form.documentId} />
          <input type="hidden" name="change" value={form.change} />
          <button
            type="submit"
            style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#D97706", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
          >
            {form.label}
          </button>
        </form>
      ) : (
        <div style={{ fontSize: 12, color: "#8A93A0", marginTop: 6 }}>Only a company working on this tender can accept this date.</div>
      )}
    </div>
  );
}

function Quote({ text, label }: { text: string; label?: string }) {
  return (
    <div style={{ marginTop: 5, padding: "6px 10px", borderLeft: "3px solid #E3E6EA", background: "#FAFAF7", fontSize: 12, color: "#5B6472", wordBreak: "break-word" }}>
      {label && <span style={{ fontWeight: 700, color: "#16233B" }}>{label}: </span>}
      &ldquo;{text}&rdquo;
    </div>
  );
}
