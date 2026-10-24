// Tier 3 - Founder & Quality Scout Alerts (notification engine brief,
// section 3, Tier 3). Sent to Sarel / the platform admin.
import { formatDateTime } from "./dates.ts";
import { button, escapeHtml, infoCard, layout, pill } from "./emailBrand.ts";
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
      <p style="margin:0;">${button(`${opts.appUrl}/admin`, "Inspect Job in Admin Triage Queue")}</p>
    `,
    opts.message
  );
  const text = `[${opts.severity.toUpperCase()}] ${opts.message}\nSource: ${opts.source} (${opts.occurrences}x since ${formatDateTime(opts.firstSeenAt)})\n${opts.detail ?? ""}\n\n${opts.appUrl}/admin`;
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
  newSignupsLast24h: number;
  activeSubscriptions: number;
  closingWithin48h: number;
  scoutBacklogCount: number;
  appUrl: string;
}): NotificationEmail {
  const subject = adminSubject({ summary: `Daily digest - ${opts.closingWithin48h} closing in 48h, ${opts.scoutBacklogCount} flagged` });
  const successPct = opts.workerJobSuccessRate && opts.workerJobSuccessRate.total > 0 ? Math.round((opts.workerJobSuccessRate.succeeded / opts.workerJobSuccessRate.total) * 100) : null;

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill("FOUNDER DIGEST", "info")}</p>
      <p style="margin:0 0 20px;font-size:17px;font-weight:700;">Platform summary - ${escapeHtml(opts.date)}</p>
      ${infoCard([
        { label: "Worker job success (24h)", value: successPct !== null ? `${successPct}% (${opts.workerJobSuccessRate!.succeeded}/${opts.workerJobSuccessRate!.total})` : "No jobs ran" },
        { label: "New company signups (24h)", value: String(opts.newSignupsLast24h) },
        { label: "Active paid subscriptions", value: String(opts.activeSubscriptions) },
        { label: "Active bids closing within 48h", value: String(opts.closingWithin48h), emphasis: opts.closingWithin48h > 0 ? "warning" : undefined },
        { label: "Scout backlog (flagged items)", value: String(opts.scoutBacklogCount), emphasis: opts.scoutBacklogCount > 0 ? "warning" : undefined },
      ])}
      <p style="margin:0;">${button(`${opts.appUrl}/admin`, "Open Admin Console")}</p>
    `,
    `${opts.closingWithin48h} active bids closing within 48h, ${opts.scoutBacklogCount} flagged items.`
  );
  const text = `Daily digest - ${opts.date}\nWorker success: ${successPct !== null ? `${successPct}%` : "no jobs"}\nNew signups (24h): ${opts.newSignupsLast24h}\nActive subscriptions: ${opts.activeSubscriptions}\nClosing within 48h: ${opts.closingWithin48h}\nScout backlog: ${opts.scoutBacklogCount}\n\n${opts.appUrl}/admin`;
  return { subject, html, text };
}
