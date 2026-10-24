// Shared visual system for every transactional email this app sends.
// Rebuilt to Sarel's own exact brand-polish spec (2026-10-24, "UI/UX Fix:
// Transactional Email Brand Polish & Typography Standards") - every hex
// value, font-size and spacing number below is copied verbatim from that
// spec, not approximated. Three real defects that spec called out by name
// and that this file's own earlier version actually had: WARNING was a
// muddy brown (#B5590E) used as a badge color ("never use muddy beige or
// brown"), the CTA button was centered (the spec wants left-aligned, "the
// natural reading flow"), and dates rendered as a short "29 Oct 2026, 14:30"
// rather than the full SAST business format this spec requires.
//
// Deliberately table-based, inline-styled HTML with no external image and
// no @media/@supports reliance beyond what's already safe everywhere
// (Gmail, Outlook desktop/web, Apple Mail all strip <style> blocks or
// mis-render flexbox/grid). No external logo image either: a raster logo
// is one more thing that renders broken with "images blocked" (the default
// in Outlook and many corporate inboxes) - the TR monogram below is built
// from inline-styled table cells, so it always renders.

export const INK = "#0B1F3A";
export const ACCENT = "#1D4ED8";
export const BACKGROUND = "#F4F5F7";
export const BORDER = "#DDE0E3";
export const MUTED = "#5C6374";
// A calmer, positive tone for "resolved"/"confirmed" content - distinct
// from ACCENT (the one primary action button's own color, so a body never
// has two different blues competing for attention) and from the
// urgent/warning tones pill() owns.
export const SUCCESS = "#166534";
// Footer colors (Sarel's own explicit spec) - two deliberately different
// shades: FOOTER_MUTED for the support line and links (still legible body
// copy), DISCLAIMER_MUTED one step lighter for the POPIA line only - the
// one piece of text on the page that should read as the quietest.
export const FOOTER_MUTED = "#64748B";
export const DISCLAIMER_MUTED = "#94A3B8";
export const FOOTER_BORDER = "#E2E8F0";
// The briefing/detail card's own background - a touch lighter than the
// page BACKGROUND, not the same token (spec gives it its own value).
export const CARD_BACKGROUND = "#F8FAFC";

export type Tone = "urgent" | "warning" | "info" | "neutral" | "success";

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  // Exact pairs from the spec's own "Elimination of Beige/Brown Badges"
  // section - urgent is soft red, warning is soft amber (both legible,
  // neither is the old muddy brown), info/success are Trust Blue tints.
  urgent: { bg: "#FEF2F2", fg: "#991B1B" },
  warning: { bg: "#FEF3C7", fg: "#92400E" },
  info: { bg: "#EFF6FF", fg: ACCENT },
  neutral: { bg: "#F1F5F9", fg: "#334155" },
  success: { bg: "#DCFCE7", fg: SUCCESS },
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A small uppercase status badge - exact spec: padding 4px 10px, radius 4px (NOT a full pill - "beige/brown badges" section specifies a 4px radius, a softer square-ish chip, not the fully-rounded 999px shape this file used before). */
export function pill(label: string, tone: Tone = "info"): string {
  const { bg, fg } = TONE_COLORS[tone];
  return `<span style="display:inline-block;background:${bg};color:${fg};font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:4px 10px;border-radius:4px;">${escapeHtml(label)}</span>`;
}

/** The primary call-to-action - exactly one per email, left-aligned to match the content card ("natural reading flow", not centered), with a trailing arrow (the spec's own worked example: "Open Tender Workspace →") appended automatically so no call site has to remember to type one. */
export function button(href: string, label: string): string {
  const arrowed = /[\u2192\u279C]\s*$/.test(label) ? label : `${label} \u2192`;
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${ACCENT};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">${escapeHtml(arrowed)}</a>`;
}

/** A bordered key/value detail box - "Closing Date", "Physical Cutoff", "Venue" etc. as clean two-column rows, instead of the same facts buried in a paragraph. Uses the spec's own card colors (CARD_BACKGROUND/FOOTER_BORDER), not the page background. */
export function infoCard(rows: { label: string; value: string; emphasis?: Tone }[]): string {
  const rowsHtml = rows
    .map(({ label, value, emphasis }) => {
      const color = emphasis ? TONE_COLORS[emphasis].fg : INK;
      const weight = emphasis ? "700" : "400";
      return `
        <tr>
          <td style="padding:8px 0;color:${FOOTER_MUTED};font-size:12px;width:40%;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;color:${color};font-size:15px;font-weight:${weight};vertical-align:top;">${value}</td>
        </tr>`;
    })
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BACKGROUND};border:1px solid ${FOOTER_BORDER};border-radius:8px;padding:16px 20px;margin:0 0 20px;">
      ${rowsHtml}
    </table>`;
}

export type ChecklistItem = { label: string; done: boolean };

/** ONE consolidated list of outstanding/complete items - the brief's own anti-noise rule: never a separate email per missing item. */
export function checklist(items: ChecklistItem[]): string {
  const rows = items
    .map((item) => {
      const markColor = item.done ? SUCCESS : TONE_COLORS.urgent.fg;
      const mark = item.done ? "&#10003;" : "&#10007;"; // check / cross, not an emoji - this card is a checklist, not the briefing card (which the spec explicitly wants emoji row-markers on instead)
      const textColor = item.done ? FOOTER_MUTED : INK;
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

/** The briefing-specific detail card (spec section 5): 📅 date row, optional 📍 attendance/venue row - deliberately its own layout, not infoCard() reused, since the spec gives it its own two-row shape with emoji markers infoCard()'s generic rows don't have. */
export function briefingDetailCard(opts: { whenLabel: string; attendanceLabel?: string }): string {
  const rows = [
    `<tr><td style="padding:8px 0;color:${FOOTER_MUTED};font-size:12px;width:40%;vertical-align:top;">&#128197; Briefing Session</td><td style="padding:8px 0;color:${INK};font-size:15px;font-weight:700;vertical-align:top;">${escapeHtml(opts.whenLabel)}</td></tr>`,
    opts.attendanceLabel
      ? `<tr><td style="padding:8px 0;color:${FOOTER_MUTED};font-size:12px;width:40%;vertical-align:top;">&#128205; Attendance</td><td style="padding:8px 0;color:${INK};font-size:14px;vertical-align:top;">${escapeHtml(opts.attendanceLabel)}</td></tr>`
      : "",
  ].join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_BACKGROUND};border:1px solid ${FOOTER_BORDER};border-radius:8px;padding:16px 20px;margin:0 0 20px;">
      ${rows}
    </table>`;
}

/** "Thursday, 29 October 2026 - 10:00 SAST" - the spec's own South African business format, distinct from lib/dates.ts's shorter app-wide "29 Oct 2026" (that function is used across the whole app's UI, not just email, so it stays as-is; email gets its own formatter rather than this file reaching in and changing app-wide date display). SAST has no DST, so appending the literal suffix is always correct, same reasoning lib/dates.ts's own SAST formatting already relies on. Returns null for an unparseable date, never a guess. */
export function formatSastDateTime(isoString: string | null | undefined): string | null {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  const datePart = d.toLocaleDateString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} \u00B7 ${timePart} SAST`;
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

/**
 * Tender reference + title + buyer, rendered above the detail card (spec
 * section 3: "Never show the tender reference number in isolation").
 * title is optional and purely additive - several existing callers
 * (PR #144's already-live operational templates) don't have a tender
 * title available without a signature change that script doesn't make;
 * this renders a correct, if shorter, header without one rather than
 * requiring every caller to supply it.
 */
export function tenderHeader(opts: { reference: string; title?: string | null; buyerShortName?: string | null }): string {
  const truncatedTitle =
    opts.title && opts.title.length > 110 ? `${opts.title.slice(0, 109)}\u2026` : opts.title;
  return `
    <p style="margin:8px 0 4px;font-size:20px;font-weight:700;color:${INK};">${escapeHtml(opts.reference)}</p>
    ${truncatedTitle ? `<p style="margin:0 0 16px;font-size:14px;font-weight:500;color:#475569;line-height:20px;">${escapeHtml(truncatedTitle)}</p>` : ""}
    ${!truncatedTitle && opts.buyerShortName ? `<p style="margin:0 0 16px;font-size:13px;color:${FOOTER_MUTED};">${escapeHtml(opts.buyerShortName)}</p>` : ""}
  `;
}

/** Why this recipient is getting this email - the footer's own "contextual notification explanation": a tender-scoped alert names the tender and company; an account-level alert (compliance, admin) names just the company. Callers pass whichever shape matches what the email is actually about - never guessed inside layout() itself. */
export type RecipientContext =
  | { kind: "tender"; tenderReference: string; companyName: string }
  | { kind: "account"; companyName: string };

function recipientContextLine(context: RecipientContext): string {
  if (context.kind === "tender") {
    return `You received this because you are assigned to tender ${escapeHtml(context.tenderReference)} at ${escapeHtml(context.companyName)} on Tender Ready.`;
  }
  return `You received this because you are an admin on the ${escapeHtml(context.companyName)} account on Tender Ready.`;
}

/** The shared page shell every template renders its body into - TR monogram + wordmark header (+ optional buyer-code badge), white card, and the full footer. */
export function layout(
  bodyHtml: string,
  preheader: string,
  opts?: {
    appUrl: string;
    /** A buyer short-code (SANRAL, CoJ, Transnet...) shown as a badge in the header, top-right - spec section 1's "Optional right-aligned pill". Anything else (a tier name etc.) can go here too; the styling is generic even though the spec's own example is buyer-specific. */
    badgeText?: string;
    recipientContext?: RecipientContext;
    /** Tier 0 (lifecycle) mail only - set to app/api/unsubscribe's own one-click URL (already carrying ?token=...) to show the Unsubscribe link. Every other tier is non-optional and must leave this unset - see migration 0093's own comment on why. */
    unsubscribeUrl?: string;
  }
): string {
  const badge = opts?.badgeText
    ? `<td align="right"><span style="display:inline-block;background:${TONE_COLORS.neutral.bg};color:${TONE_COLORS.neutral.fg};font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;padding:4px 8px;border-radius:4px;">${escapeHtml(opts.badgeText)}</span></td>`
    : "";

  const appUrl = opts?.appUrl ?? "https://tenderready.app";
  // Bullet-separated (spec section 7), each link still padded enough to
  // stay a comfortable tap target on a phone - the bullet itself is a
  // separate, non-tappable character, not part of either link's own hit
  // area, so it doesn't eat into either neighbour's spacing.
  const linkStyle = `color:${FOOTER_MUTED};text-decoration:none;font-size:12px;padding:4px 6px;display:inline-block;`;
  const bullet = `<span style="color:${FOOTER_MUTED};font-size:12px;">&middot;</span>`;
  const footerLinks = [
    `<a href="${appUrl}/company" style="${linkStyle}">Notification Settings</a>`,
    `<a href="${appUrl}/privacy" style="${linkStyle}">Privacy Policy</a>`,
    opts?.unsubscribeUrl ? `<a href="${escapeHtml(opts.unsubscribeUrl)}" style="${linkStyle}">Unsubscribe</a>` : null,
  ]
    .filter((l): l is string => l !== null)
    .join(bullet);

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
              <td style="padding:24px 28px 0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:32px;">
                      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${ACCENT};border-radius:6px;width:32px;height:32px;text-align:center;color:#FFFFFF;font-weight:800;font-size:15px;line-height:32px;">TR</td></tr></table>
                    </td>
                    <td style="padding-left:10px;color:${INK};font-size:18px;font-weight:700;letter-spacing:-0.02em;vertical-align:middle;">Tender Ready</td>
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
                <p style="margin:0 0 12px;font-size:13px;line-height:20px;color:${FOOTER_MUTED};">
                  Need help? Reply directly to this email or contact us at <a href="mailto:support@tenderready.app" style="color:${FOOTER_MUTED};">support@tenderready.app</a>
                </p>
                <hr style="border:none;border-top:1px solid ${FOOTER_BORDER};margin:28px 0 20px;" />
                ${contextLine}
                <p style="margin:0 0 12px;">${footerLinks}</p>
                <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:${FOOTER_MUTED};">Tender Ready (Pty) Ltd &middot; Cape Town, South Africa</p>
                <p style="margin:0;font-size:11px;line-height:16px;color:${DISCLAIMER_MUTED};">POPIA-compliant tender compilation. Bid documents, pricing schedules, and proprietary company assets remain private and strictly confidential.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
