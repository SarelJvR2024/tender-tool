// Shared visual system for every transactional email this app sends -
// the "professional SaaS, zero marketing fluff" layer the Resend
// notification engine's brief (2026-10-24) asks for. Replaces the one bare
// layout() helper that used to live in emailTemplates.ts with a small set of
// composable building blocks (pill, infoCard, checklist, calendar, footer)
// so every one of the engine's templates looks like it belongs to the same
// product, not 17 one-off designs.
//
// Hex colors are LITERAL on purpose, copied from app/globals.css's own
// light-mode tokens (--foreground #0B1F3A, --accent #1D4ED8, --background
// #F4F5F7, --border #DDE0E3, --muted-foreground #5C6374, --warning
// #B5590E, --destructive #B3261E) - email HTML has no stylesheet to read a
// CSS variable from, so there is nothing else these values could be. If
// those tokens change, this file needs a matching manual update.
//
// Deliberately table-based, inline-styled HTML with no external image and
// no @media/@supports reliance beyond what's already safe everywhere
// (Gmail, Outlook desktop/web, Apple Mail all strip <style> blocks or
// mis-render flexbox/grid) - the same reason the original layout() was
// table-based. No external logo image either: a raster logo is one more
// thing that renders broken with "images blocked" (the default in Outlook
// and many corporate inboxes) - the monogram badge below is built from
// inline-styled table cells, so it always renders.

export const INK = "#0B1F3A";
export const ACCENT = "#1D4ED8";
export const BACKGROUND = "#F4F5F7";
export const BORDER = "#DDE0E3";
export const MUTED = "#5C6374";
export const WARNING = "#B5590E";
export const DESTRUCTIVE = "#B3261E";
// A calmer, positive tone for "resolved"/"confirmed" content - distinct
// from ACCENT (which is reserved for the one primary action button, so a
// body never has two different blues competing for attention) and from
// WARNING/DESTRUCTIVE (which this file's pill() already owns for urgency).
export const SUCCESS = "#1E7A3D";
// Footer-only color (Sarel's own explicit spec, 2026-10-24), deliberately
// NOT the same as MUTED (#5C6374) - a touch lighter, for the one region of
// the email that should read as the quietest thing on the page (legal
// text, links a recipient reads maybe once). Scoped to the footer only;
// everything else keeps using MUTED.
export const FOOTER_MUTED = "#64748B";
export const FOOTER_BORDER = "#E2E8F0";

export type Tone = "urgent" | "warning" | "info" | "neutral" | "success";

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  // Each pair is a light tint of the tone color behind its own full-strength
  // text color - readable at the small size a pill is set in, and distinct
  // enough from each other at a glance that "URGENT" vs "COMPLIANCE" never
  // need the label re-read to tell apart.
  urgent: { bg: "#FBE7E5", fg: DESTRUCTIVE },
  warning: { bg: "#FCEEDF", fg: WARNING },
  info: { bg: "#E3EAFC", fg: ACCENT },
  neutral: { bg: "#EEF0F2", fg: MUTED },
  success: { bg: "#E2F3E7", fg: SUCCESS },
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A small uppercase status badge - "[URGENT]", "[48H CUTOFF]", "[COMPLIANCE]" rendered as a real pill, not literal bracket text (the brief's subject-line brackets stay in the subject; the body gets a visual pill instead). */
export function pill(label: string, tone: Tone = "info"): string {
  const { bg, fg } = TONE_COLORS[tone];
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:4px 10px;border-radius:999px;">${escapeHtml(label)}</span>`;
}

/** The primary call-to-action - exactly one per email, bold Trust Blue, rounded, an explicit action verb per the brief's own copy rule. Centered in its own block (a table, not text-align on a <p>, for Outlook's sake) so every template's CTA sits the same way without each one having to wrap it itself. */
export function button(href: string, label: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0;">
      <tr>
        <td align="center">
          <a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:6px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
}

/** A bordered key/value detail box - "Closing Date", "Physical Cutoff", "Venue" etc. as clean two-column rows, instead of the same facts buried in a paragraph. */
export function infoCard(rows: { label: string; value: string; emphasis?: Tone }[]): string {
  const rowsHtml = rows
    .map(({ label, value, emphasis }) => {
      const color = emphasis ? TONE_COLORS[emphasis].fg : INK;
      const weight = emphasis ? "700" : "400";
      return `
        <tr>
          <td style="padding:8px 0;color:${MUTED};font-size:12px;width:44%;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;color:${color};font-size:13px;font-weight:${weight};vertical-align:top;">${value}</td>
        </tr>`;
    })
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BACKGROUND};border:1px solid ${BORDER};border-radius:8px;padding:4px 16px;margin:0 0 20px;">
      ${rowsHtml}
    </table>`;
}

export type ChecklistItem = { label: string; done: boolean };

/** ONE consolidated list of outstanding/complete items - the brief's own anti-noise rule #2: never a separate email per missing item. */
export function checklist(items: ChecklistItem[]): string {
  const rows = items
    .map((item) => {
      const markColor = item.done ? SUCCESS : DESTRUCTIVE;
      const mark = item.done ? "&#10003;" : "&#10007;"; // check / cross, not an emoji - matches "zero marketing fluff"
      const textColor = item.done ? MUTED : INK;
      const textDecoration = item.done ? "line-through" : "none";
      return `
        <tr>
          <td style="padding:6px 0;width:22px;vertical-align:top;color:${markColor};font-weight:700;font-size:13px;">${mark}</td>
          <td style="padding:6px 0;color:${textColor};font-size:13px;text-decoration:${textDecoration};vertical-align:top;">${escapeHtml(item.label)}</td>
        </tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">${rows}</table>`;
}

/** Builds a minimal, valid .ics file for "Add to Calendar" - returned as a named attachment for sendNotification(), never a data: URI link (widely stripped/blocked by mail clients). */
export function buildIcs(opts: { uid: string; title: string; description: string; startIso: string; durationMinutes?: number; location?: string }): { filename: string; content: string } {
  const start = new Date(opts.startIso);
  const end = new Date(start.getTime() + (opts.durationMinutes ?? 60) * 60 * 1000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const escapeIcs = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tender Ready//Notification Engine//EN",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeIcs(opts.title)}`,
    `DESCRIPTION:${escapeIcs(opts.description)}`,
    opts.location ? `LOCATION:${escapeIcs(opts.location)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((l): l is string => l !== null);
  return { filename: "briefing.ics", content: lines.join("\r\n") };
}

/** Why this recipient is getting this email - the footer's own "contextual notification explanation" (Sarel's own spec, 2026-10-24): a tender-scoped alert names the tender and company; an account-level alert (compliance, admin) names just the company. Callers pass whichever shape matches what the email is actually about - never guessed inside layout() itself. */
export type RecipientContext =
  | { kind: "tender"; tenderReference: string; companyName: string }
  | { kind: "account"; companyName: string };

function recipientContextLine(context: RecipientContext): string {
  if (context.kind === "tender") {
    return `You received this because you are assigned to tender ${escapeHtml(context.tenderReference)} at ${escapeHtml(context.companyName)} on Tender Ready.`;
  }
  return `You received this because you are an admin on the ${escapeHtml(context.companyName)} account on Tender Ready.`;
}

/** The shared page shell every template renders its body into - wordmark header (+ optional tier badge), white card, and the full footer: a help callout, why-you-got-this, a links row, and the legal/POPIA block. */
export function layout(
  bodyHtml: string,
  preheader: string,
  opts?: {
    appUrl: string;
    badgeText?: string;
    recipientContext?: RecipientContext;
    /** Tier 0 (lifecycle) mail only - set to app/api/unsubscribe's own one-click URL (already carrying ?token=...) to show the Unsubscribe link. Every other tier is non-optional and must leave this unset - see migration 0093's own comment on why. */
    unsubscribeUrl?: string;
  }
): string {
  const badge = opts?.badgeText
    ? `<td align="right"><span style="display:inline-block;background:${TONE_COLORS.neutral.bg};color:${TONE_COLORS.neutral.fg};font-size:12px;font-weight:600;padding:4px 8px;border-radius:4px;">${escapeHtml(opts.badgeText)}</span></td>`
    : "";

  const appUrl = opts?.appUrl ?? "https://tenderready.app";
  // Each link gets its own padding (not just a gap between them) so the
  // TAPPABLE area, not just the visible text, clears 8px on all sides -
  // "link has 8px of space around it" is what actually matters for a
  // thumb on a phone screen, not just the gap between two link labels.
  const linkStyle = `color:${FOOTER_MUTED};text-decoration:none;font-size:12px;padding:4px 8px;display:inline-block;`;
  const footerLinks = [
    `<a href="${appUrl}/company" style="${linkStyle}">Notification Settings</a>`,
    `<a href="${appUrl}/privacy" style="${linkStyle}">Privacy Policy</a>`,
    opts?.unsubscribeUrl ? `<a href="${escapeHtml(opts.unsubscribeUrl)}" style="${linkStyle}">Unsubscribe</a>` : null,
  ]
    .filter((l): l is string => l !== null)
    .join("");

  const contextLine = opts?.recipientContext
    ? `<p style="margin:0 0 10px;font-size:12px;line-height:18px;color:${FOOTER_MUTED};">${recipientContextLine(opts.recipientContext)}</p>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Tender Ready</title>
  </head>
  <body style="margin:0;padding:0;background:${BACKGROUND};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BACKGROUND};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:20px 28px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:${ACCENT};font-size:18px;font-weight:700;">Tender Ready</td>
                    ${badge}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 28px;color:${INK};font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 20px;">
                <p style="margin:0 0 16px;font-size:12px;line-height:18px;color:${FOOTER_MUTED};">
                  Need help? Reply directly to this email or contact us at <a href="mailto:support@tenderready.app" style="color:${FOOTER_MUTED};">support@tenderready.app</a>
                </p>
                <hr style="border:none;border-top:1px solid ${FOOTER_BORDER};margin:0 0 16px;" />
                ${contextLine}
                <p style="margin:0 0 12px;">${footerLinks}</p>
                <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:${FOOTER_MUTED};">Tender Ready (Pty) Ltd &middot; Cape Town, South Africa</p>
                <p style="margin:0;font-size:12px;line-height:18px;color:${FOOTER_MUTED};">POPIA-compliant tender compilation. Bid documents, pricing schedules, and proprietary company assets remain private and strictly confidential.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
