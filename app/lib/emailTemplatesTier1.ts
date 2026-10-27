// Tier 1 - Tender Operational Alerts (notification engine brief, section 3,
// Tier 1). Sent to the active bidding team. Every fact rendered here comes
// from a column or computation that already exists in this schema - no new
// "briefing venue" or "checklist" source was invented for this file (see
// each function's own comment for exactly where its data comes from).
import { closingCountdown, formatDate } from "./dates.ts";
import {
  briefingDetailCard,
  button,
  buildIcs,
  checklist,
  type ChecklistItem,
  escapeHtml,
  formatSastDateTime,
  infoCard,
  layout,
  pill,
  tenderHeader,
} from "./emailBrand.ts";
import { discoveredTendersSubject, tenderSubject } from "./emailSubjects.ts";
import { printSignDeadline, type DispatchLogisticsInput } from "./dispatchTriage.ts";
import type { NotificationEmail } from "./notificationEngine.ts";

// 1.1 Compulsory Briefing / Clarification Meeting Alert
// --------------------------------------------------------------------------
// Data source: tenders.briefing_date / briefing_time (migration 0048,
// written by engine/discovery/watch_tender_updates.py from a real buyer
// addendum, or accepted by a person). There is NO briefing venue/meeting-
// link column on `tenders` itself - the only place a venue is ever
// captured is discovered_opportunities.briefing->>'venue' (migration 0051,
// the pre-pursuit discovery snapshot), which nothing currently copies onto
// `tenders` once a company pursues it. venueOrLink is therefore an
// honestly OPTIONAL input here: a caller that still has the
// discovered_opportunities row can pass it through; one that doesn't gets
// a fallback line pointing at the tender's own documents rather than a
// fabricated address. tenderTitle is likewise optional - tenders.description
// has it, but no live caller depends on this signature yet so it's free to
// add without a "zero changes" constraint; omitted, the header still shows
// the reference and buyer, just not a title line (never "reference alone").
export function briefingReminderDetailedEmail(opts: {
  reference: string;
  tenderTitle?: string | null;
  buyerShortName: string;
  companyName: string;
  briefingDate: string; // tenders.briefing_date, YYYY-MM-DD
  briefingTime: string | null; // tenders.briefing_time, "HH:MM", null = date known, time not
  venueOrLink: string | null;
  isVirtual: boolean;
  appUrl: string;
  tenderId: string;
  window: "5_days" | "24_hours";
}): NotificationEmail {
  const briefingIso = opts.briefingTime ? `${opts.briefingDate}T${opts.briefingTime}:00+02:00` : `${opts.briefingDate}T00:00:00+02:00`;
  const when = opts.briefingTime ? formatSastDateTime(briefingIso) ?? opts.briefingDate : formatDate(opts.briefingDate) ?? opts.briefingDate;
  const action = opts.window === "24_hours" ? "Briefing Session in 24h" : "Briefing Session in 5 Days";
  const subject = tenderSubject({ reference: opts.reference, action: opts.isVirtual ? `${action} (Virtual Link Attached)` : action, buyer: opts.buyerShortName });
  const tone = opts.window === "24_hours" ? "urgent" : "warning";

  // Honest naming note (see lib/briefingReminders.ts's own header comment for
  // the full reasoning): tenders.briefing_date/briefing_time never records
  // whether a briefing is compulsory once a tender is pursued, so this can't
  // claim it is - a buyer-specific fact this system doesn't reliably have.
  const attendanceLabel = opts.isVirtual
    ? `Virtual${opts.venueOrLink ? ` (${opts.venueOrLink})` : " (link attached)"}`
    : opts.venueOrLink
      ? `Attendance - ${opts.venueOrLink}`
      : `See this tender's documents for the venue - not captured on this tender's record yet.`;

  const ics = opts.briefingTime
    ? buildIcs({
        uid: `briefing-${opts.tenderId}@tenderready.app`,
        title: `Briefing - ${opts.reference}`,
        description: `Briefing session for ${opts.reference} (${opts.buyerShortName}). Check the tender notice for whether attendance is compulsory.`,
        startIso: briefingIso,
        location: opts.venueOrLink ?? undefined,
      })
    : null;

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(opts.window === "24_hours" ? "24H TO BRIEFING" : "BRIEFING IN 5 DAYS", tone)}</p>
      ${tenderHeader({ reference: opts.reference, title: opts.tenderTitle, buyerShortName: opts.buyerShortName })}
      ${briefingDetailCard({ whenLabel: when ?? opts.briefingDate, attendanceLabel })}
      <p style="margin:0 0 20px;font-weight:700;color:#991B1B;">Check the tender notice for whether attendance is compulsory - some buyers disqualify a bid automatically for a missed compulsory briefing.</p>
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "View Briefing Details & RFP")}
      ${ics ? `<p style="margin:12px 0 0;color:#64748B;font-size:12px;">A calendar invite (${escapeHtml(ics.filename)}) is attached to this email.</p>` : ""}
    `,
    `${opts.reference} briefing ${when}.`,
    { appUrl: opts.appUrl, badgeText: opts.buyerShortName, recipientContext: { kind: "tender", tenderReference: opts.reference, companyName: opts.companyName } }
  );
  const text = `${opts.reference} (${opts.buyerShortName}) - briefing session ${when}.\n${opts.isVirtual ? "Link" : "Venue"}: ${opts.venueOrLink ?? "see tender documents"}\n\nCheck the tender notice for whether attendance is compulsory - some buyers disqualify a bid automatically for a missed compulsory briefing.\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text, attachments: ics ? [ics] : undefined };
}

// 1.2 48-Hour & 24-Hour Physical Print & Sign Cutoff
// --------------------------------------------------------------------------
// Data source: tender_packs.submission_type/estimated_print_hours/
// estimated_transit_hours/dispatch_status (migration 0090) and
// tenders.closing_date, run through lib/dispatchTriage.ts's own
// printSignDeadline() - the SAME function the dashboard's Command Center
// uses, so this email can never disagree with what the app itself shows
// for "when do I actually need to print by" (this app's own "never a
// second number that could disagree" rule). The checklist is NOT computed
// here either: outstandingItems is a caller-supplied list built from the
// one real source (lib/tenderNextStep.ts / disqualification-guard.tsx),
// per dispatchTriage.ts's own module header on why this file never
// re-derives blocking_items itself.
export function printSignCutoffEmail(opts: {
  reference: string;
  tenderTitle?: string | null;
  buyerShortName: string;
  companyName: string;
  closingDateTime: string; // tenders.closing_date, full ISO timestamp
  deliveryLocation: string | null;
  outstandingItems: ChecklistItem[];
  appUrl: string;
  tenderId: string;
  dispatch: DispatchLogisticsInput;
}): NotificationEmail {
  const deadline = printSignDeadline(opts.dispatch);
  const hoursLeft = deadline ? (deadline.getTime() - Date.now()) / (60 * 60 * 1000) : null;
  const urgent = hoursLeft !== null && hoursLeft <= 24;
  const action = urgent ? "24h to Physical Cutoff (Print & Sign)" : "48h to Physical Cutoff (Print & Sign)";
  const subject = tenderSubject({ reference: opts.reference, action, buyer: opts.buyerShortName });
  const missing = opts.outstandingItems.filter((i) => !i.done).length;

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(urgent ? "48H CUTOFF" : "PRINT & SIGN CUTOFF", urgent ? "urgent" : "warning")}</p>
      ${tenderHeader({ reference: opts.reference, title: opts.tenderTitle, buyerShortName: opts.buyerShortName })}
      ${infoCard([
        { label: "Official closing", value: escapeHtml(formatSastDateTime(opts.closingDateTime) ?? opts.closingDateTime) },
        { label: "Physical print/sign cutoff", value: deadline ? escapeHtml(formatSastDateTime(deadline.toISOString()) ?? "") : "Not applicable (digital submission)", emphasis: urgent ? "urgent" : "warning" },
        { label: "Delivery address", value: opts.deliveryLocation ? escapeHtml(opts.deliveryLocation) : "Not yet set - open the Tender Workspace" },
      ])}
      <p style="margin:0 0 8px;font-weight:700;">${missing > 0 ? `${missing} item${missing === 1 ? "" : "s"} still outstanding:` : "Everything on this checklist is complete."}</p>
      ${checklist(opts.outstandingItems)}
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open Tender Workspace")}
    `,
    `${opts.reference}: ${missing} item(s) outstanding before the print/sign cutoff.`,
    { appUrl: opts.appUrl, badgeText: opts.buyerShortName, recipientContext: { kind: "tender", tenderReference: opts.reference, companyName: opts.companyName } }
  );
  const text = `${opts.reference} (${opts.buyerShortName})\nClosing: ${formatSastDateTime(opts.closingDateTime)}\nPrint/sign cutoff: ${deadline ? formatSastDateTime(deadline.toISOString()) : "n/a"}\nDelivery: ${opts.deliveryLocation ?? "not set"}\n\nOutstanding (${missing}):\n${opts.outstandingItems.filter((i) => !i.done).map((i) => `- ${i.label}`).join("\n")}\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

// 1.3 Buyer Corrigenda / Addenda Alert
// --------------------------------------------------------------------------
// Data source: tender_watched_documents.changes (migration 0039 -
// {closing_date: {date, previous_date, quote}, briefing: {...}, other_changes:
// [{kind, quote}]}), delivered to companies via tender_update_notifications
// (migration 0048 - one row per (company, watched_document), "pursuers
// only" per engine/discovery/test_tender_updates.py). This function only
// renders; the un-alerted-row scan and alerted_at write happen in the
// sender script, reusing that table's own existing "already notified" flag
// instead of a second dedupe mechanism for the same fact.
export type TenderChange =
  | { kind: "closing_date"; date: string; previousDate: string | null; quote: string }
  | { kind: "briefing"; date: string; previousDate: string | null; quote: string }
  | { kind: "other"; label: string; quote: string };

export function corrigendumAlertEmail(opts: {
  reference: string;
  tenderTitle?: string | null;
  buyerShortName: string;
  companyName: string;
  changes: TenderChange[];
  appUrl: string;
  tenderId: string;
}): NotificationEmail {
  const closingChange = opts.changes.find((c) => c.kind === "closing_date");
  const action = closingChange ? "Closing Date Changed (Addendum)" : "Addendum Published";
  const subject = tenderSubject({ reference: opts.reference, action, buyer: opts.buyerShortName });

  const rows = opts.changes.map((c) => {
    if (c.kind === "closing_date" || c.kind === "briefing") {
      const label = c.kind === "closing_date" ? "Closing date" : "Briefing date";
      const direction = c.previousDate && new Date(c.date) > new Date(c.previousDate) ? "moved later" : c.previousDate ? "moved earlier" : "now set";
      return { label, value: `${escapeHtml(formatDate(c.date) ?? c.date)} (${direction}${c.previousDate ? `, was ${escapeHtml(formatDate(c.previousDate) ?? c.previousDate)}` : ""})`, emphasis: "warning" as const };
    }
    return { label: c.label, value: escapeHtml(c.quote.slice(0, 160)) };
  });

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill("ADDENDUM", "info")}</p>
      ${tenderHeader({ reference: opts.reference, title: opts.tenderTitle, buyerShortName: opts.buyerShortName })}
      <p style="margin:0 0 16px;">The buyer has published an addendum to this tender. Summary of what changed:</p>
      ${infoCard(rows)}
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Review Addendum Changes")}
    `,
    `${opts.reference}: the buyer published an addendum.`,
    { appUrl: opts.appUrl, badgeText: opts.buyerShortName, recipientContext: { kind: "tender", tenderReference: opts.reference, companyName: opts.companyName } }
  );
  const text = `${opts.reference} (${opts.buyerShortName}) - addendum published.\n${rows.map((r) => `${r.label}: ${r.value.replace(/<[^>]+>/g, "")}`).join("\n")}\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

// 1.4 New Discovered Tenders Digest
// --------------------------------------------------------------------------
// Data source: discovered_opportunities (migration 0004/0071), one row per
// (company, release) - already seeded daily by engine/discovery/watch_new_tenders.py
// via .github/workflows/daily-discovery.yml, which writes but never emails.
// This renders a digest of one company's own newly-seeded rows, cards per
// tender (contract number, buyer, category/CIDB signal, closing countdown),
// never one email per tender - the brief's own anti-noise framing, same as
// scoutAnomalyBatchEmail's "a batch of one is just a list with one row" rule
// so there is exactly one template for 1..N tenders, not two drifting ones.
//
// Only ONE button() per email (this file's own established convention,
// see its doc comment: "exactly one per email") - each card gets a plain
// text link to its own tender, the single big CTA at the end goes to the
// in-app Discovery feed where every one of them (and anything this digest's
// own cap left out) can be reviewed.
export type DiscoveredTenderCard = {
  id: string;
  contractNumber: string | null;
  buyer: string | null;
  title: string | null;
  category: string | null;
  cidbGrading: string | null;
  closingDate: string | null;
  verdict: "strong_fit" | "possible" | "needs_review" | string;
};

const MAX_CARDS_SHOWN = 10;

export function discoveredTendersDigestEmail(opts: {
  companyName: string;
  tenders: DiscoveredTenderCard[];
  appUrl: string;
}): NotificationEmail {
  const subject = discoveredTendersSubject({ count: opts.tenders.length, companyName: opts.companyName });
  const shown = opts.tenders.slice(0, MAX_CARDS_SHOWN);
  const remaining = opts.tenders.length - shown.length;

  const cardsHtml = shown
    .map((t) => {
      const countdown = closingCountdown(t.closingDate);
      const rows = [
        { label: "Tender #", value: escapeHtml(t.contractNumber || "—") },
        { label: "Client", value: escapeHtml(t.buyer || "—") },
        { label: "Category / CIDB", value: escapeHtml([t.category, t.cidbGrading].filter(Boolean).join(" · ") || "—") },
        {
          label: "Closing",
          value: countdown ? escapeHtml(countdown.text) : "Not stated",
          emphasis: countdown?.urgent ? ("warning" as const) : undefined,
        },
      ];
      return `
        <div style="margin:0 0 16px;">
          <p style="margin:0 0 6px;">${pill(t.verdict === "strong_fit" ? "STRONG FIT" : t.verdict === "possible" ? "POSSIBLE FIT" : "NEEDS REVIEW", t.verdict === "strong_fit" ? "success" : "info")}</p>
          <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0B1F3A;">${escapeHtml(t.title || "Untitled tender")}</p>
          ${infoCard(rows)}
          <a href="${escapeHtml(`${opts.appUrl}/tenders/${t.id}`)}" style="font-size:13px;color:#1D4ED8;text-decoration:none;">Review this tender &rarr;</a>
        </div>`;
    })
    .join("");

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill("NEW TENDERS FOUND", "info")}</p>
      <p style="margin:0 0 16px;">${opts.tenders.length} new tender${opts.tenders.length === 1 ? "" : "s"} matched your company's profile:</p>
      ${cardsHtml}
      ${remaining > 0 ? `<p style="margin:0 0 16px;font-size:13px;color:#5C6374;">+ ${remaining} more in your Discovery feed.</p>` : ""}
      ${button(`${opts.appUrl}/discovery`, "Open Discovery Feed")}
    `,
    `${opts.tenders.length} new tender${opts.tenders.length === 1 ? "" : "s"} found for you.`,
    { appUrl: opts.appUrl }
  );
  const text = `${opts.tenders.length} new tender(s) found:\n${shown
    .map((t) => `- ${t.contractNumber || t.id} (${t.buyer || "unknown buyer"}): ${t.title || "Untitled"} - ${opts.appUrl}/tenders/${t.id}`)
    .join("\n")}${remaining > 0 ? `\n+ ${remaining} more in your Discovery feed.` : ""}\n\n${opts.appUrl}/discovery`;
  return { subject, html, text };
}

// 1.5 Clarification Window Expiry Reminder
// --------------------------------------------------------------------------
// Data source: tender_tasks where kind='clarification' (migration 0009/
// 0021's own standard-milestone enum) - a MANUALLY-entered due_date, not an
// auto-extracted one (this schema has no question-cutoff field anywhere -
// see lib/clarificationWindowReminders.ts's own header for the full
// reasoning). daysLeft of 10 or 2 ("48h", the closest honest equivalent on
// a date-only column) - never any other value, enforced by
// clarificationThresholdFor() before this function is ever called.
export function clarificationWindowReminderEmail(opts: {
  reference: string;
  tenderTitle?: string | null;
  buyerShortName: string;
  taskDescription: string;
  dueDate: string;
  daysLeft: number;
  appUrl: string;
  tenderId: string;
}): NotificationEmail {
  const action = opts.daysLeft <= 2 ? "Clarification Window Closing (48h)" : "Clarification Window Closing (10 Days)";
  const subject = tenderSubject({ reference: opts.reference, action, buyer: opts.buyerShortName });

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill("CLARIFICATION WINDOW", opts.daysLeft <= 2 ? "warning" : "info")}</p>
      ${tenderHeader({ reference: opts.reference, title: opts.tenderTitle, buyerShortName: opts.buyerShortName })}
      <p style="margin:0 0 16px;">The window to submit clarification questions on this tender closes soon:</p>
      ${infoCard([
        { label: "Task", value: escapeHtml(opts.taskDescription) },
        { label: "Due", value: escapeHtml(formatDate(opts.dueDate) ?? opts.dueDate), emphasis: opts.daysLeft <= 2 ? "warning" : undefined },
      ])}
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open Tender Workspace")}
    `,
    `${opts.reference}: clarification window closes in ${opts.daysLeft} day${opts.daysLeft === 1 ? "" : "s"}.`,
    { appUrl: opts.appUrl, badgeText: opts.buyerShortName }
  );
  const text = `${opts.reference} (${opts.buyerShortName}) - clarification window closes in ${opts.daysLeft} day(s), due ${formatDate(opts.dueDate) ?? opts.dueDate}.\n${opts.taskDescription}\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

// 1.6 Bid Pack Compilation Complete
// --------------------------------------------------------------------------
// Data source: engine/general/process_general_jobs.py's own process_job()
// (generate_pack job kind) - the moment a pack job's status flips to
// "ready". That job runs in the Python worker, not this Next.js app, so
// THIS function is only ever called indirectly: Python invokes
// scripts/render-pack-ready-email.ts (a thin render-only CLI wrapper
// around this exact function) over a subprocess, then sends the result via
// Resend's own HTTP API directly - see that script's own header and
// engine/notify/send_pack_ready_email.py for the full architecture
// reasoning (Sarel's own explicit decision, 2026-10-27: instant delivery
// matters here because teams are often working against tight courier/print
// deadlines, and the one canonical template still lives in TypeScript, not
// duplicated in Python).
export function packReadyEmail(opts: {
  reference: string;
  tenderTitle?: string | null;
  buyerShortName: string;
  companyName: string;
  pageCount: number;
  appUrl: string;
  tenderId: string;
}): NotificationEmail {
  const action = "Bid Pack Compiled & Ready for Print/Review";
  const subject = tenderSubject({ reference: opts.reference, action, buyer: opts.buyerShortName });

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill("PACK READY", "success")}</p>
      ${tenderHeader({ reference: opts.reference, title: opts.tenderTitle, buyerShortName: opts.buyerShortName })}
      <p style="margin:0 0 16px;">Your submission pack has finished compiling and is ready to download, print and review.</p>
      ${infoCard([{ label: "Pages", value: escapeHtml(String(opts.pageCount)) }])}
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open Tender Workspace")}
    `,
    `${opts.reference}: your bid pack is ready.`,
    { appUrl: opts.appUrl, badgeText: opts.buyerShortName, recipientContext: { kind: "tender", tenderReference: opts.reference, companyName: opts.companyName } }
  );
  const text = `${opts.reference} (${opts.buyerShortName}) - bid pack ready, ${opts.pageCount} page(s).\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}
