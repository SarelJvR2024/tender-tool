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
    console.error("tender_watched_documents select failed", tenderId, error);
    return (
      <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-xs text-destructive">
        Couldn&apos;t check this tender for addenda and updates - try refreshing. If it keeps happening, let us know.
      </div>
    );
  }
  const updates = sortUpdates((data ?? []) as TenderUpdate[]);
  if (updates.length === 0) return null;

  const top = URGENCY_STYLE[mostUrgent(updates) ?? "info"];
  const addenda = updates.filter((u) => u.kind === "addendum").length;

  return (
    <div id="tender-updates" className={`mb-4 rounded-xl border-2 bg-card px-[18px] py-4 ${top.cardBorderClassName}`}>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="text-[15px] font-bold text-foreground">This tender has been updated since it was found</div>
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${top.badgeClassName}`}>
          {updates.length} new document{updates.length === 1 ? "" : "s"}
          {addenda > 0 ? ` · ${addenda} addend${addenda === 1 ? "um" : "a"}` : ""}
        </span>
      </div>
      <div className="my-1 mb-2.5 text-xs text-muted-foreground">
        The buyer published these after this tender was first found. Read each one before you submit - an addendum
        usually has to be acknowledged in the bid.
      </div>

      <ol className="m-0 list-none p-0">
        {updates.map((u) => {
          const style = URGENCY_STYLE[u.urgency ?? "info"];
          const changes = u.changes ?? {};
          const closing = closingDateLine(changes.closing_date);
          const applied = appliedLine(changes.closing_date);
          const briefing = changes.briefing;
          return (
            <li key={u.id} className="border-t border-border py-2.5">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${style.badgeClassName}`}>
                  {u.kind ? UPDATE_KIND_LABEL[u.kind] : "New document"} · {style.label}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Found {formatActivityTime(u.first_seen_at)} · {u.source === "sanral_page" ? "SANRAL tender page" : "eTenders"}
                </span>
              </div>
              <div className="text-[13px] font-semibold break-words text-foreground">
                {u.url ? (
                  <a href={u.url} target="_blank" rel="noopener noreferrer" className="text-foreground">
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
                    className={`mt-1.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold ${
                      closing.tone === "good" ? "bg-success/10 text-success" : closing.tone === "bad" ? "bg-destructive/10 text-destructive" : "bg-card text-foreground"
                    }`}
                  >
                    {closing.text}
                    {applied && <div className="mt-0.5 text-xs font-normal">{applied}</div>}
                    {changes.closing_date?.accepted_at && (
                      <div className="mt-0.5 text-xs font-normal">
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
                  <div className="mt-1.5 text-[13px] text-foreground">
                    {briefing.cancelled
                      ? "Briefing session cancelled or no longer compulsory."
                      : `Briefing moved${briefing.previous_date ? ` from ${formatDay(briefing.previous_date)}` : ""} to ${formatDay(briefing.date)}${briefing.time ? ` ${briefing.time}` : ""}.`}
                    {briefing.applied && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {briefing.accepted_at
                          ? `Accepted by ${acceptedBy(briefing)} on ${formatActivityTime(briefing.accepted_at)} - the briefing date and the “Briefing session” task now show it.`
                          : "The briefing date on file and the “Briefing session” task have been updated."}
                      </div>
                    )}
                  </div>
                )
              )}
              {!closing && !briefing && u.summary && (
                <div className="mt-1 text-[13px] text-foreground">
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

              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {u.read_basis ? BASIS_LABEL[u.read_basis] : null}
                {u.read_error ? ` · ${u.read_error}` : null}
              </div>
              {(changes.caveats ?? [])
                // Once a person accepted the document's date, "confirm with the
                // buyer" is history - the accepted line above says what was done.
                .filter((c) => !(changes.closing_date?.accepted_at && c.startsWith("The listing still shows")))
                .filter((c) => !(changes.briefing?.accepted_at && c.startsWith("The briefing date on file is")))
                .map((c) => (
                <div key={c} className="mt-0.5 text-[11px] text-warning">
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
    <div className="mt-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5">
      <div className="mb-2 text-[13px] font-bold text-warning">&#9888; {heading}</div>
      <div className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <div
            key={r.label}
            className={`min-w-0 flex-[1_1_150px] rounded-lg border bg-card px-2.5 py-[7px] ${r.strong ? "border-accent" : "border-border"}`}
          >
            <div className="text-[11px] text-muted-foreground">{r.label}</div>
            <div className="text-sm font-bold text-foreground">{r.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{note}</div>
      {form ? (
        <form action={acceptTenderUpdateDate} className="mt-2">
          <input type="hidden" name="tender_id" value={form.tenderId} />
          <input type="hidden" name="watched_document_id" value={form.documentId} />
          <input type="hidden" name="change" value={form.change} />
          <button
            type="submit"
            className="min-h-10 cursor-pointer rounded-lg border-none bg-accent px-4 text-[13px] font-semibold text-accent-foreground"
          >
            {form.label}
          </button>
        </form>
      ) : (
        <div className="mt-1.5 text-xs text-muted-foreground">Only a company working on this tender can accept this date.</div>
      )}
    </div>
  );
}

function Quote({ text, label }: { text: string; label?: string }) {
  return (
    <div className="mt-1 border-l-[3px] border-border bg-card px-2.5 py-1.5 text-xs break-words text-muted-foreground">
      {label && <span className="font-bold text-foreground">{label}: </span>}
      &ldquo;{text}&rdquo;
    </div>
  );
}
