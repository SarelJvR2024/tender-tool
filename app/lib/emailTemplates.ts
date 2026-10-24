// Transactional email HTML templates (welcome, deadline reminder) - the
// two templates that pre-date the notification engine (2026-10-24). Now
// built on lib/emailBrand.ts's shared layout/pill/button components, the
// same visual system every Tier 0-3 template uses, instead of each
// template owning its own bare inline layout. Function signatures are
// UNCHANGED from before this upgrade - both existing callers
// (app/onboarding/actions.ts, scripts/send-deadline-reminders.ts) keep
// working exactly as they did.
//
// Framework-agnostic (no Next.js import) on purpose, same reasoning as
// every other file here: both the Next.js app and the standalone
// scripts/send-deadline-reminders.ts script import this directly.
//
// Tier 1-3 templates now live in their own files (lib/emailTemplatesTier0/
// 1/2/3.ts) rather than growing this one file to 17 functions - re-exported
// below so an existing `import { X } from "./emailTemplates.ts"` still finds
// every template in one place if that's ever more convenient than
// importing a specific tier file directly.
import { button, escapeHtml, infoCard, layout, pill } from "./emailBrand.ts";

export function welcomeEmail(opts: { companyName: string; appUrl: string }): { subject: string; html: string; text: string } {
  const subject = "Welcome to Tender Ready";
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("WELCOME", "success")}</p>
      <p style="margin:0 0 16px;font-size:18px;font-weight:700;">Welcome, ${escapeHtml(opts.companyName)}.</p>
      <p style="margin:0 0 16px;">Your 14-day free trial has started, with full access to everything - SANRAL workbook fill, the general pack builder, your Company vault, Discovery and People &amp; CVs.</p>
      <p style="margin:0 0 20px;">Next step: finish setting up your Company vault (CSD, tax, B-BBEE and CIDB details) so your packs can be filled straight from real data, not typed by hand each time.</p>
      <p style="margin:0 0 24px;">${button(`${opts.appUrl}/dashboard`, "Go to your dashboard")}</p>
      <p style="margin:0;color:#5C6374;font-size:12px;">Any questions, just reply to this email.</p>
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
  const whenText = opts.daysLeft <= 0 ? "closes today" : opts.daysLeft === 1 ? "closes tomorrow (within 24 hours)" : `closes in ${opts.daysLeft} days`;
  const subject = urgent ? `Closing in 24 hours: ${opts.contractLabel}` : `Closing in 3 days: ${opts.contractLabel}`;
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill(urgent ? "24H TO CLOSING" : "CLOSING SOON", urgent ? "urgent" : "warning")}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.contractLabel)}</p>
      ${infoCard([{ label: "Closes", value: escapeHtml(opts.closingDate), emphasis: urgent ? "urgent" : "warning" }])}
      <p style="margin:0 0 20px;">This tender ${whenText}. Make sure your submission pack is ready before then.</p>
      <p style="margin:0;">${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open this tender")}</p>
    `,
    `${opts.contractLabel} ${whenText}.`
  );
  const text = `${opts.contractLabel} ${whenText} (${opts.closingDate}).\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

export {
  briefingReminderEmail,
  corrigendumAlertEmail,
  printSignCutoffEmail,
  type TenderChange,
} from "./emailTemplatesTier1.ts";
export { complianceDigestEmail, SARS_PIN_RISK_NOTE, type ComplianceItem } from "./emailTemplatesTier2.ts";
export { founderDailyDigestEmail, scoutAnomalyEmail } from "./emailTemplatesTier3.ts";
export {
  adminNewSignupEmail,
  adminPaidConversionEmail,
  nudgeFirstTenderEmail,
  nudgeVaultKickstartEmail,
  teamInviteEmail,
  trialDay7MilestoneEmail,
  trialExpiredEmail,
  trialExpiring48hEmail,
} from "./emailTemplatesTier0.ts";
