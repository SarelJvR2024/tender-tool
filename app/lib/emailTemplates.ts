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
