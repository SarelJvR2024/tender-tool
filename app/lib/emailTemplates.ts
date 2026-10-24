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
import { button, escapeHtml, infoCard, layout, pill, type Tone } from "./emailBrand.ts";

export function welcomeEmail(opts: { companyName: string; appUrl: string }): { subject: string; html: string; text: string } {
  const subject = "Welcome to Tender Ready";
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("WELCOME", "success")}</p>
      <p style="margin:0 0 16px;font-size:18px;font-weight:700;">Welcome, ${escapeHtml(opts.companyName)}.</p>
      <p style="margin:0 0 16px;">Your 14-day free trial has started, with full access to everything - SANRAL workbook fill, the general pack builder, your Company vault, Discovery and People &amp; CVs.</p>
      <p style="margin:0 0 20px;">Next step: finish setting up your Company vault (CSD, tax, B-BBEE and CIDB details) so your packs can be filled straight from real data, not typed by hand each time.</p>
      ${button(`${opts.appUrl}/dashboard`, "Go to your dashboard")}
    `,
    `Your 14-day Tender Ready trial has started.`,
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName } }
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
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open this tender")}
    `,
    `${opts.contractLabel} ${whenText}.`,
    { appUrl: opts.appUrl }
  );
  const text = `${opts.contractLabel} ${whenText} (${opts.closingDate}).\n\n${opts.appUrl}/tenders/${opts.tenderId}`;
  return { subject, html, text };
}

export {
  briefingReminderDetailedEmail,
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

// --- Operational Notification Engine (PR #144, session_011NLr419YmLS44xgf1YM6n3) ---
// The 3 functions below are scripts/send-operational-alerts.ts's own
// templates, already live on a daily cron (operational-alerts.yml) with
// real candidate-selection logic (lib/printCutoffReminders.ts,
// briefingReminders.ts, complianceExpiryReminders.ts) - reconciled here,
// not rebuilt, after two sessions independently built overlapping
// notification-engine work from the same brief (coordinated via
// send_message, 2026-10-24 - see docs/specs/System-Status.md for the full
// account). Per that agreement: ONLY the HTML generation changes, to this
// file's own emailBrand.ts visual system instead of each function's
// original bare inline layout - every parameter name, required field and
// return shape is byte-for-byte what it was, so
// scripts/send-operational-alerts.ts needed zero changes.
//
// Subject format note, left as an honest gap rather than silently
// "fixed": the notification engine brief's mandatory format is
// "[Ref] Action | Buyer", but none of these 3 functions' signatures carry
// a buyer/department name (send-operational-alerts.ts never fetches one) -
// changing the format to match would mean adding a required param, which
// breaks the "zero changes to the live cron script" agreement above.
// Left in their original "[Ref] - LEVEL: Specific" shape; bringing these 3
// into full subject-format compliance is a real follow-up, not done here.
function operationalLevelPill(level: "URGENT" | "ACTION REQUIRED" | "NOTICE"): { label: string; tone: Tone } {
  if (level === "URGENT") return { label: "URGENT", tone: "urgent" };
  if (level === "ACTION REQUIRED") return { label: "ACTION REQUIRED", tone: "warning" };
  return { label: "NOTICE", tone: "info" };
}

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
  const { label, tone } = operationalLevelPill("URGENT");
  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(label, tone)}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.contractLabel)}</p>
      ${infoCard([{ label: "Print & sign cutoff", value: escapeHtml(deadlineText), emphasis: "urgent" }])}
      <p style="margin:0 0 20px;">This tender's own print, binding and courier window closes then - your own print and transit hour estimates, counted back from the tender box closing time. After that there isn't enough time left to print, bind and deliver a physical submission before it closes.</p>
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}#pack-compiler`, "Open pack compiler")}
    `,
    `${opts.contractLabel}: print & sign cutoff ${whenText}.`,
    { appUrl: opts.appUrl }
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
  const whenText = opts.daysLeft <= 1 ? "in 24 hours" : `in ${opts.daysLeft} days`;
  const subject = operationalSubject(opts.contractLabel, level, `Briefing session ${whenText}`);
  const whenDetail = `${opts.briefingDate}${opts.briefingTime ? ` at ${opts.briefingTime}` : ""}`;
  const { label, tone } = operationalLevelPill(level);
  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(label, tone)}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.contractLabel)}</p>
      ${infoCard([{ label: "Briefing session", value: escapeHtml(whenDetail), emphasis: tone }])}
      <p style="margin:0 0 20px;">This tender's briefing session is ${whenText}. Check the tender notice for whether attendance is compulsory and confirm who from your team is going.</p>
      ${button(`${opts.appUrl}/tenders/${opts.tenderId}`, "Open this tender")}
    `,
    `${opts.contractLabel}: briefing session ${whenText}.`,
    { appUrl: opts.appUrl }
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
      <p style="margin:0 0 12px;">${pill("ACTION REQUIRED", "warning")}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.fieldLabel)}</p>
      ${infoCard([{ label: "Expires", value: `in ${opts.daysLeft} day${opts.daysLeft === 1 ? "" : "s"}`, emphasis: "warning" }])}
      <p style="margin:0 0 20px;">Your company's ${escapeHtml(opts.fieldLabel)} expires in ${opts.daysLeft} days. A lapsed document here can disqualify a tender submission - renew it and update your Company vault before it expires.</p>
      ${button(`${opts.appUrl}/company`, "Open Company vault")}
    `,
    `${opts.fieldLabel} expires in ${opts.daysLeft} days.`,
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName } }
  );
  const text = `${opts.companyName}: ${opts.fieldLabel} expires in ${opts.daysLeft} days.\n\n${opts.appUrl}/company`;
  return { subject, html, text };
}
