// Tier 3 - Founder & Quality Scout Alerts (notification engine brief,
// section 3, Tier 3). Sent to Sarel / the platform admin.
import { formatDateTime } from "./dates.ts";
import { button, escapeHtml, infoCard, layout, pill, type Tone } from "./emailBrand.ts";
import { adminSubject } from "./emailSubjects.ts";
import type { NotificationEmail } from "./notificationEngine.ts";

// 3.1 Instant Quality Scout Anomaly Alert
// --------------------------------------------------------------------------
// Data source: system_alerts (migration 0042/0086 - source, severity,
// message, detail, context jsonb, fingerprint, occurrences), already
// written by every engine/bridge via engine/alerts/system_alerts.py and
// already shown on /admin. This is NOT a new detection mechanism - it is
// an email rendering of a system_alerts row that already exists; the
// sender script (not this file) is what's new, reading rows where
// reported_at is null (the table's own existing "never reported" marker -
// engine/alerts/check_system_alerts.py already uses exactly this field)
// and emailing them instead of, as today, only ever being read by a human
// who happens to open /admin.
export function scoutAnomalyEmail(opts: {
  source: string; // system_alerts.source - "pack" | "general" | "cv" | "cv_extract" | "ocr" | "discovery" | "deadlines" | "worker" | ...
  severity: "critical" | "error" | "warning";
  message: string;
  detail: string | null;
  occurrences: number;
  firstSeenAt: string;
  context: Record<string, unknown>;
  appUrl: string;
}): NotificationEmail {
  const tone = opts.severity === "critical" ? "urgent" : opts.severity === "error" ? "warning" : "info";
  const subject = adminSubject({ summary: opts.message.slice(0, 120) });

  const contextRows = Object.entries(opts.context)
    .slice(0, 8)
    .map(([key, value]) => ({ label: key, value: escapeHtml(String(value)) }));

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(`SCOUT ALERT - ${opts.severity.toUpperCase()}`, tone)}</p>
      <p style="margin:0 0 4px;font-size:16px;font-weight:700;">${escapeHtml(opts.message)}</p>
      <p style="margin:0 0 20px;color:#5C6374;font-size:12px;">Source: ${escapeHtml(opts.source)} - first seen ${escapeHtml(formatDateTime(opts.firstSeenAt) ?? opts.firstSeenAt)}${opts.occurrences > 1 ? ` - ${opts.occurrences} occurrences` : ""}</p>
      ${opts.detail ? `<pre style="margin:0 0 16px;padding:12px;background:#F4F5F7;border:1px solid #DDE0E3;border-radius:6px;font-size:11px;white-space:pre-wrap;word-break:break-word;color:#0B1F3A;">${escapeHtml(opts.detail.slice(0, 2000))}</pre>` : ""}
      ${contextRows.length > 0 ? infoCard(contextRows) : ""}
      ${button(`${opts.appUrl}/admin`, "Inspect Job in Admin Triage Queue")}
    `,
    opts.message,
    { appUrl: opts.appUrl }
  );
  const text = `[${opts.severity.toUpperCase()}] ${opts.message}\nSource: ${opts.source} (${opts.occurrences}x since ${formatDateTime(opts.firstSeenAt)})\n${opts.detail ?? ""}\n\n${opts.appUrl}/admin`;
  return { subject, html, text };
}

// 3.1b Batched Instant Quality Scout Anomaly Alert (2026-10-25, Sarel's own
// anti-noise ask: "batch multiple simultaneous anomalies into a single
// summary email rather than sending 7 separate emails"). scripts/send-
// scout-alerts.ts now always sends through THIS function, never the single-
// alert scoutAnomalyEmail() above - kept for scripts/render-email-samples.ts's
// own sample set and as a smaller building block, but no longer a live
// sender call site. Renders 1..N alerts the same way (a "batch of one" is
// just a list with one row) so there is exactly one template, not two
// near-duplicate ones to keep in sync.
export type ScoutAlertSummary = {
  source: string;
  severity: "critical" | "error" | "warning";
  message: string;
  occurrences: number;
  firstSeenAt: string;
};

const SEVERITY_TONE: Record<ScoutAlertSummary["severity"], Tone> = { critical: "urgent", error: "warning", warning: "info" };

export function scoutAnomalyBatchEmail(opts: { alerts: ScoutAlertSummary[]; appUrl: string }): NotificationEmail {
  const n = opts.alerts.length;
  const criticalCount = opts.alerts.filter((a) => a.severity === "critical").length;
  const worstTone: Tone = criticalCount > 0 ? "urgent" : "warning";
  const headline = n === 1 ? opts.alerts[0].message : `${n} new Quality Scout exception${n === 1 ? "" : "s"}${criticalCount > 0 ? ` (${criticalCount} critical)` : ""}`;
  const subject = adminSubject({ summary: headline.slice(0, 120) });

  const rows = opts.alerts
    .map(
      (a) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #E2E8F0;vertical-align:top;white-space:nowrap;">${pill(a.severity.toUpperCase(), SEVERITY_TONE[a.severity])}</td>
          <td style="padding:10px 0 10px 12px;border-top:1px solid #E2E8F0;vertical-align:top;">
            <p style="margin:0 0 2px;font-size:14px;font-weight:600;color:#0B1F3A;">${escapeHtml(a.message)}</p>
            <p style="margin:0;font-size:12px;color:#5C6374;">Source: ${escapeHtml(a.source)} - first seen ${escapeHtml(formatDateTime(a.firstSeenAt) ?? a.firstSeenAt)}${a.occurrences > 1 ? ` - ${a.occurrences} occurrences` : ""}</p>
          </td>
        </tr>`
    )
    .join("");

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(n === 1 ? "SCOUT ALERT" : `SCOUT ALERT - ${n} ISSUES`, worstTone)}</p>
      <p style="margin:0 0 16px;font-size:16px;font-weight:700;">${n === 1 ? "An exception needs a look" : `${n} exceptions need a look`}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows}</table>
      ${button(`${opts.appUrl}/admin`, "Open Admin Triage Queue")}
    `,
    headline,
    { appUrl: opts.appUrl }
  );
  const text = `${headline}\n\n${opts.alerts.map((a) => `[${a.severity.toUpperCase()}] ${a.message} - ${a.source} (${a.occurrences}x since ${formatDateTime(a.firstSeenAt)})`).join("\n")}\n\n${opts.appUrl}/admin`;
  return { subject, html, text };
}

// 3.2 Daily Founder Morning Digest (07:00 SAST)
// --------------------------------------------------------------------------
// Deliberately takes a pre-computed summary rather than querying anything
// itself - same reasoning as every other template in this engine (render,
// don't source). A real sender script should build this from data that
// already exists: platform_admin_companies() (0064) for signups/active
// subscriptions, an unresolved-count query on system_alerts for the Scout
// backlog, and a company-wide "closing within 48h" tender query (the same
// shape dispatchTriage.ts's "critical" bucket already uses) for high-stakes
// activity - no new RPC is required to populate every field below, but
// wiring that query is this template's own "next step", not done in this
// pass (see this session's final report).
export function founderDailyDigestEmail(opts: {
  date: string; // ISO date this digest covers
  workerJobSuccessRate: { succeeded: number; total: number } | null;
  // Each of these 4 is `number | null` - `null` means the sender script's
  // own read of that count failed (a real Supabase/RPC error), NOT that the
  // real count is zero. Finding (2026-11-07x, standing review): before this,
  // scripts/send-founder-digest.ts's 4 count*() functions all caught their
  // own read error, logged it with console.error, and then returned a plain
  // `0` anyway - so "0 new signups" / "0 active subscriptions" / "0 flagged"
  // in Sarel's own daily inbox was indistinguishable from a genuine zero,
  // the exact dominant bug class this review tracks (a discarded Supabase
  // error rendered as a false-safe "nothing here" state) - just one hop
  // further downstream than usual, in the rendered business number itself
  // rather than the page/caller that fetched it. Rendered as its own
  // "Couldn't load" value below, same wording convention `app/AGENTS.md`'s
  // own error-banner entries already use, never silently folded into "0".
  newSignupsLast24h: number | null;
  activeSubscriptions: number | null;
  closingWithin48h: number | null;
  scoutBacklogCount: number | null;
  appUrl: string;
}): NotificationEmail {
  const metric = (n: number | null) => (n === null ? "Couldn't load" : String(n));
  const anyMetricFailed = opts.newSignupsLast24h === null || opts.activeSubscriptions === null || opts.closingWithin48h === null || opts.scoutBacklogCount === null;
  const subject = adminSubject({
    summary:
      opts.closingWithin48h === null || opts.scoutBacklogCount === null
        ? "Daily digest - some metrics couldn't load"
        : `Daily digest - ${opts.closingWithin48h} closing in 48h, ${opts.scoutBacklogCount} flagged`,
  });
  const successPct = opts.workerJobSuccessRate && opts.workerJobSuccessRate.total > 0 ? Math.round((opts.workerJobSuccessRate.succeeded / opts.workerJobSuccessRate.total) * 100) : null;

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill("FOUNDER DIGEST", "info")}</p>
      <p style="margin:0 0 20px;font-size:17px;font-weight:700;">Platform summary - ${escapeHtml(opts.date)}</p>
      ${infoCard([
        { label: "Worker job success (24h)", value: successPct !== null ? `${successPct}% (${opts.workerJobSuccessRate!.succeeded}/${opts.workerJobSuccessRate!.total})` : "No jobs ran" },
        { label: "New company signups (24h)", value: metric(opts.newSignupsLast24h), emphasis: opts.newSignupsLast24h === null ? "warning" : undefined },
        { label: "Active paid subscriptions", value: metric(opts.activeSubscriptions), emphasis: opts.activeSubscriptions === null ? "warning" : undefined },
        { label: "Active bids closing within 48h", value: metric(opts.closingWithin48h), emphasis: opts.closingWithin48h === null || opts.closingWithin48h > 0 ? "warning" : undefined },
        { label: "Scout backlog (flagged items)", value: metric(opts.scoutBacklogCount), emphasis: opts.scoutBacklogCount === null || opts.scoutBacklogCount > 0 ? "warning" : undefined },
      ])}
      ${anyMetricFailed ? `<p style="margin:0 0 16px;color:#B42318;font-size:12px;">One or more counts above couldn't be read this run - check the Admin Console and the worker logs rather than trusting "Couldn't load" as zero.</p>` : ""}
      ${button(`${opts.appUrl}/admin`, "Open Admin Console")}
    `,
    anyMetricFailed
      ? "Some of today's metrics couldn't load - see the digest for which."
      : `${opts.closingWithin48h} active bids closing within 48h, ${opts.scoutBacklogCount} flagged items.`,
    { appUrl: opts.appUrl }
  );
  const text = `Daily digest - ${opts.date}\nWorker success: ${successPct !== null ? `${successPct}%` : "no jobs"}\nNew signups (24h): ${metric(opts.newSignupsLast24h)}\nActive subscriptions: ${metric(opts.activeSubscriptions)}\nClosing within 48h: ${metric(opts.closingWithin48h)}\nScout backlog: ${metric(opts.scoutBacklogCount)}\n\n${opts.appUrl}/admin`;
  return { subject, html, text };
}
