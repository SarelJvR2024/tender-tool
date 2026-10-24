// Transactional email HTML templates (welcome, deadline reminder). Plain
// South African English, matching the rest of this app's copy rules.
//
// Hex colors here are LITERAL, copied straight from app/globals.css's own
// light-mode token values (--foreground #0B1F3A, --accent #1D4ED8,
// --background #F4F5F7, --border #DDE0E3, --muted-foreground #5C6374,
// --warning #B5590E, --destructive #B3261E) - the one deliberate exception
// to "tokens only, no hardcoded hex" this app's design rules allow: email
// HTML cannot read a CSS custom property or a Tailwind class (no stylesheet
// is loaded in an inbox), so there is nothing else these values COULD be.
// If app/globals.css's tokens ever change, these need a matching manual
// update - flagged here so that's not a surprise later.
//
// Framework-agnostic (no Next.js import) on purpose: both the Next.js app
// (the welcome email, triggered from a Server Action) and the standalone
// scripts/send-deadline-reminders.ts script (run by its own GitHub Actions
// workflow, not through Next.js at all) import this file directly.

const INK = "#0B1F3A";
const ACCENT = "#1D4ED8";
const BACKGROUND = "#F4F5F7";
const BORDER = "#DDE0E3";
const MUTED = "#5C6374";
const WARNING = "#B5590E";
const DESTRUCTIVE = "#B3261E";

function layout(bodyHtml: string, preheader: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tender Ready</title>
  </head>
  <body style="margin:0;padding:0;background:${BACKGROUND};font-family:Arial,Helvetica,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BACKGROUND};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${INK};padding:20px 28px;">
                <span style="color:#FFFFFF;font-size:16px;font-weight:700;">Tender Ready</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:${INK};font-size:14px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid ${BORDER};color:${MUTED};font-size:11px;">
                Tender Ready - your tender department, without hiring one.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${ACCENT};color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:8px;">${label}</a>`;
}

export function welcomeEmail(opts: { companyName: string; appUrl: string }): { subject: string; html: string; text: string } {
  const subject = "Welcome to Tender Ready";
  const html = layout(
    `
      <p style="margin:0 0 16px;font-size:18px;font-weight:700;">Welcome, ${escapeHtml(opts.companyName)}.</p>
      <p style="margin:0 0 16px;">Your 14-day free trial has started, with full access to everything - SANRAL workbook fill, the general pack builder, your Company vault, Discovery and People &amp; CVs.</p>
      <p style="margin:0 0 20px;">Next step: finish setting up your Company vault (CSD, tax, B-BBEE and CIDB details) so your packs can be filled straight from real data, not typed by hand each time.</p>
      <p style="margin:0 0 24px;">${button(`${opts.appUrl}/dashboard`, "Go to your dashboard")}</p>
      <p style="margin:0;color:${MUTED};font-size:12px;">Any questions, just reply to this email.</p>
    `,
    `Your 14-day Tender Ready trial has started.`
  );
  const text = `Welcome to Tender Ready, ${opts.companyName}.\n\nYour 14-day free trial has started, with full access to everything.\n\nNext step: finish setting up your Company vault so your packs can be filled from real data.\n\n${opts.appUrl}/dashboard`;
  return { subject, html, text };
}

export function deadlineReminderEmail(opts: {
  contractLabel: string;
  closingDate: string;
  daysLeft: number;
  appUrl: string;
  tenderId: string;
}): { subject: string; html: string; text: string } {
  const urgent = opts.daysLeft <= 1;
  const color = urgent ? DESTRUCTIVE : WARNING;
  const whenText = opts.daysLeft <= 0 ? "closes today" : opts.daysLeft === 1 ? "closes tomorrow (within 24 hours)" : `closes in ${opts.daysLeft} days`;
  const subject = urgent ? `Closing in 24 hours: ${opts.contractLabel}` : `Closing in 3 days: ${opts.contractLabel}`;
  const html = layout(
    `
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.04em;">Closing soon</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.contractLabel)}</p>
      <p style="margin:0 0 20px;">This tender ${whenText} - ${escapeHtml(opts.closingDate)}. Make sure your submission pack is ready before then.</p>
      <p style="margin:0;">${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open this tender")}</p>
    `,
    `${opts.contractLabel} ${whenText}.`
  );
  const text = `${opts.contractLabel} ${whenText} (${opts.closingDate}).\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Operational Notification Engine (Sarel's own brief): standard subject
// line for all 3 alerts below - "[Tender Ref] - [Level]: [Specific
// Subject]", e.g. "[N.007-030-2026/1F] - ACTION REQUIRED: Physical print &
// sign deadline in 24 hours" (his own example). `refLabel` is the tender
// reference for the 2 tender-scoped alerts; the compliance-expiry alert
// isn't about one tender, so it uses the company's own name in that
// position instead - same bracket format, the one honest adaptation this
// alert type needs.
export type OperationalAlertLevel = "URGENT" | "ACTION REQUIRED" | "NOTICE";

function operationalSubject(refLabel: string, level: OperationalAlertLevel, specific: string): string {
  return `[${refLabel}] - ${level}: ${specific}`;
}

export function printCutoffEmail(opts: {
  contractLabel: string;
  printSignDeadline: string; // ISO datetime - lib/dispatchTriage.ts's own printSignDeadline()
  hoursLeft: number;
  appUrl: string;
  tenderId: string;
}): { subject: string; html: string; text: string } {
  const hoursRounded = Math.max(0, Math.round(opts.hoursLeft));
  const whenText = hoursRounded <= 0 ? "has passed" : `in ${hoursRounded} hour${hoursRounded === 1 ? "" : "s"}`;
  const subject = operationalSubject(opts.contractLabel, "URGENT", `Physical print & sign deadline ${whenText}`);
  const deadlineText = new Date(opts.printSignDeadline).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const html = layout(
    `
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${DESTRUCTIVE};text-transform:uppercase;letter-spacing:0.04em;">Print &amp; transit cutoff</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.contractLabel)}</p>
      <p style="margin:0 0 20px;">This tender&apos;s own print, binding and courier window closes <strong>${deadlineText}</strong> - your own print and transit hour estimates, counted back from the tender box closing time. After that there isn&apos;t enough time left to print, bind and deliver a physical submission before it closes.</p>
      <p style="margin:0;">${button(`${opts.appUrl}/tenders/${opts.tenderId}#pack-compiler`, "Open pack compiler")}</p>
    `,
    `${opts.contractLabel}: print & sign cutoff ${whenText}.`
  );
  const text = `${opts.contractLabel}: print & sign cutoff ${whenText} (${deadlineText}).\n\n${opts.appUrl}/tenders/${opts.tenderId}#pack-compiler`;
  return { subject, html, text };
}

export function briefingReminderEmail(opts: {
  contractLabel: string;
  briefingDate: string;
  briefingTime: string | null;
  daysLeft: number;
  appUrl: string;
  tenderId: string;
}): { subject: string; html: string; text: string } {
  const urgent = opts.daysLeft <= 1;
  const level: OperationalAlertLevel = urgent ? "ACTION REQUIRED" : "NOTICE";
  const color = urgent ? WARNING : ACCENT;
  const whenText = opts.daysLeft <= 1 ? "in 24 hours" : `in ${opts.daysLeft} days`;
  const subject = operationalSubject(opts.contractLabel, level, `Briefing session ${whenText}`);
  const whenDetail = `${opts.briefingDate}${opts.briefingTime ? ` at ${opts.briefingTime}` : ""}`;
  const html = layout(
    `
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.04em;">Briefing session</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.contractLabel)}</p>
      <p style="margin:0 0 20px;">This tender&apos;s briefing session is ${whenText} - ${escapeHtml(whenDetail)}. Check the tender notice for whether attendance is compulsory and confirm who from your team is going.</p>
      <p style="margin:0;">${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open this tender")}</p>
    `,
    `${opts.contractLabel}: briefing session ${whenText}.`
  );
  const text = `${opts.contractLabel}: briefing session ${whenText} (${whenDetail}).\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

export function complianceExpiryEmail(opts: {
  companyName: string;
  fieldLabel: string;
  daysLeft: number;
  appUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = operationalSubject(opts.companyName, "ACTION REQUIRED", `${opts.fieldLabel} expires in ${opts.daysLeft} days`);
  const html = layout(
    `
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${WARNING};text-transform:uppercase;letter-spacing:0.04em;">Compliance document expiring</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.fieldLabel)}</p>
      <p style="margin:0 0 20px;">Your company&apos;s ${escapeHtml(opts.fieldLabel)} expires in ${opts.daysLeft} days. A lapsed document here can disqualify a tender submission - renew it and update your Company vault before it expires.</p>
      <p style="margin:0;">${button(`${opts.appUrl}/company`, "Open Company vault")}</p>
    `,
    `${opts.fieldLabel} expires in ${opts.daysLeft} days.`
  );
  const text = `${opts.companyName}: ${opts.fieldLabel} expires in ${opts.daysLeft} days.\n\n${opts.appUrl}/company`;
  return { subject, html, text };
}
