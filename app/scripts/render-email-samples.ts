#!/usr/bin/env node
// Renders one realistic sample of every transactional email template to
// static HTML files, for visual review (screenshots) and, once
// RESEND_API_KEY is set, for actually sending via scripts/send-email-samples.ts.
// Sample data below is clearly fictional (company "Reviewer Civils (Pty) Ltd",
// tender ref "N.007-030-2026/1F" matching the brief's own worked example) -
// never real customer data, since this never touches the database.
//
// Run: node --experimental-strip-types scripts/render-email-samples.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { welcomeEmail, deadlineReminderEmail } from "../lib/emailTemplates.ts";
import {
  briefingReminderEmail,
  corrigendumAlertEmail,
  printSignCutoffEmail,
} from "../lib/emailTemplatesTier1.ts";
import { complianceDigestEmail, SARS_PIN_RISK_NOTE } from "../lib/emailTemplatesTier2.ts";
import { founderDailyDigestEmail, scoutAnomalyEmail } from "../lib/emailTemplatesTier3.ts";
import {
  adminNewSignupEmail,
  adminPaidConversionEmail,
  nudgeFirstTenderEmail,
  nudgeVaultKickstartEmail,
  teamInviteEmail,
  trialDay7MilestoneEmail,
  trialExpiredEmail,
  trialExpiring48hEmail,
} from "../lib/emailTemplatesTier0.ts";

const APP_URL = "https://tenderready.app";
// Gitignored (see .gitignore) - these are rendered previews for visual
// review, never committed output.
const outDir = join(process.cwd(), "email-previews");
mkdirSync(outDir, { recursive: true });

const samples: Record<string, { subject: string; html: string; text: string }> = {
  "00-welcome-user": welcomeEmail({ companyName: "Reviewer Civils (Pty) Ltd", appUrl: APP_URL }),
  "00-nudge-vault-kickstart": nudgeVaultKickstartEmail({ companyName: "Reviewer Civils (Pty) Ltd", vaultDocsOnFile: 1, appUrl: APP_URL }),
  "00-nudge-first-tender": nudgeFirstTenderEmail({ companyName: "Reviewer Civils (Pty) Ltd", appUrl: APP_URL }),
  "00-trial-day-7-milestone": trialDay7MilestoneEmail({ companyName: "Reviewer Civils (Pty) Ltd", trialEndsAt: "2026-11-07", packsBuiltSoFar: 2, appUrl: APP_URL }),
  "00-trial-expiring-48h": trialExpiring48hEmail({ companyName: "Reviewer Civils (Pty) Ltd", trialEndsAt: "2026-10-26", appUrl: APP_URL }),
  "00-trial-expired": trialExpiredEmail({ companyName: "Reviewer Civils (Pty) Ltd", appUrl: APP_URL }),
  "00-team-invite": teamInviteEmail({ companyName: "Reviewer Civils (Pty) Ltd", inviterName: "Sarel van Rensburg", role: "member", token: "sample-token-abc123", appUrl: APP_URL }),
  "00-admin-new-signup": adminNewSignupEmail({ companyName: "Reviewer Civils (Pty) Ltd", signedUpAt: new Date().toISOString(), appUrl: APP_URL, companyId: "sample" }),
  "00-admin-paid-conversion": adminPaidConversionEmail({ companyName: "Reviewer Civils (Pty) Ltd", planTier: "SANRAL Pro", billingInterval: "monthly", appUrl: APP_URL }),

  "01-briefing-5-days": briefingReminderEmail({
    reference: "N.007-030-2026/1F",
    buyerShortName: "SANRAL",
    briefingDate: "2026-10-29",
    briefingTime: "10:00",
    venueOrLink: "SANRAL Southern Region Office, 48 Sydney Road, Mowbray, Cape Town",
    isVirtual: false,
    appUrl: APP_URL,
    tenderId: "sample-tender-1",
    window: "5_days",
  }),
  "01-briefing-24h": briefingReminderEmail({
    reference: "RFP 165/2026",
    buyerShortName: "DBSA",
    briefingDate: "2026-10-25",
    briefingTime: "09:00",
    venueOrLink: "https://teams.microsoft.com/l/meetup-join/sample",
    isVirtual: true,
    appUrl: APP_URL,
    tenderId: "sample-tender-2",
    window: "24_hours",
  }),
  "01-print-sign-cutoff-48h": printSignCutoffEmail({
    reference: "N.007-030-2026/1F",
    buyerShortName: "SANRAL",
    closingDateTime: "2026-10-28T11:00:00+02:00",
    deliveryLocation: "SANRAL Head Office, Tender Box Room 2, Ground Floor, 48 Tambo House, Pretoria",
    outstandingItems: [
      { label: "SARS Tax Compliance PIN - upload current PIN letter", done: false },
      { label: "Financial workbook - technical pricing not yet signed off", done: false },
      { label: "B-BBEE Affidavit", done: true },
    ],
    appUrl: APP_URL,
    tenderId: "sample-tender-1",
    dispatch: { closingDate: "2026-10-28T11:00:00+02:00", submissionType: "physical_box", estimatedPrintHours: 4, estimatedTransitHours: 2, dispatchStatus: "compiling" },
  }),
  "01-corrigendum-alert": corrigendumAlertEmail({
    reference: "N.007-030-2026/1F",
    buyerShortName: "SANRAL",
    changes: [
      { kind: "closing_date", date: "2026-11-04", previousDate: "2026-10-28", quote: "The closing date is hereby extended to 04 November 2026 at 11:00." },
      { kind: "other", label: "Technical specification", quote: "Clause 3.4.2 amended: minimum CIDB grading changed from 6CE to 7CE." },
    ],
    appUrl: APP_URL,
    tenderId: "sample-tender-1",
  }),

  "02-compliance-digest": complianceDigestEmail({
    companyName: "Reviewer Civils (Pty) Ltd",
    items: [
      { label: "SARS Tax Compliance PIN", expiryDate: "2026-11-07", daysLeft: 14, href: "/company", riskNote: SARS_PIN_RISK_NOTE },
      { label: "COID Letter of Good Standing", expiryDate: "2026-11-14", daysLeft: 21, href: "/company" },
      { label: "ECSA registration - John Smith", expiryDate: "2026-10-20", daysLeft: -4, href: "/people/sample-person" },
    ],
    appUrl: APP_URL,
  }),

  "03-scout-anomaly": scoutAnomalyEmail({
    source: "cv_extract",
    severity: "error",
    message: "CV extraction refused an upload: file isn't in the company's own storage folder",
    detail: "status extraction_failed: This upload's file isn't in your company's own storage folder, so it wasn't read.",
    occurrences: 3,
    firstSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    context: { company_id: "6d1be2fc-6568-...", job_id: "0c7c90d2-fbc1-...", upload_id: "sample" },
    appUrl: APP_URL,
  }),
  "03-founder-daily-digest": founderDailyDigestEmail({
    date: "24 Oct 2026",
    workerJobSuccessRate: { succeeded: 47, total: 49 },
    newSignupsLast24h: 2,
    activeSubscriptions: 18,
    closingWithin48h: 3,
    scoutBacklogCount: 1,
    appUrl: APP_URL,
  }),

  "legacy-deadline-reminder": deadlineReminderEmail({
    contractLabel: "N.007-030-2026/1F",
    closingDate: "28 Oct 2026, 11:00",
    daysLeft: 1,
    appUrl: APP_URL,
    tenderId: "sample-tender-1",
  }),
};

for (const [name, { subject, html }] of Object.entries(samples)) {
  writeFileSync(join(outDir, `${name}.html`), html, "utf8");
  console.log(`wrote ${name}.html - subject: "${subject}"`);
}
console.log(`\n${Object.keys(samples).length} template(s) rendered to ${outDir}`);
