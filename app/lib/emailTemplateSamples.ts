// Every LIVE, actually-wired email template, one realistic rendered sample
// each - the data source for /admin/notifications's Template Preview
// Gallery (Notification Command Center brief, Phase 1, 2026-10-27).
//
// Keyed by the real notification_type string each live sender script logs
// to notification_logs under (see app/app/admin/notifications/page.tsx's
// own TYPE_LABEL/TIER_LABEL maps - this file's keys match those exactly,
// on purpose, so a dispatch-log row and a gallery card are provably the
// same template). 19 entries, not the brief's assumed "12" - every
// notification_type this engine actually sends has its own template, and
// cutting it down to a round number would mean hiding real ones.
//
// Deliberately EXCLUDES 3 template functions that exist in this codebase
// but are dead code today, confirmed by grepping every scripts/*.ts call
// site (2026-10-27): emailTemplatesTier1.ts's own briefingReminderDetailedEmail
// and printSignCutoffEmail (superseded by emailTemplates.ts's
// briefingReminderEmail/printCutoffEmail, which the live
// scripts/send-operational-alerts.ts actually imports), and
// emailTemplates.ts's complianceExpiryEmail (its sender stage was removed
// this same session - see docs/specs/System-Status.md - to prevent a
// double-send against the new, broader compliance digest). A gallery
// entry for a template nothing sends would misrepresent what Sarel can
// expect customers to actually receive.
//
// Sample data mirrors scripts/render-email-samples.ts's own fictional
// company ("Reviewer Civils (Pty) Ltd") and SANRAL worked example
// ("N.007-030-2026/1F") for consistency with that existing dev tool - never
// real customer data, since none of this touches the database.
import { welcomeEmail, deadlineReminderEmail, printCutoffEmail, briefingReminderEmail } from "./emailTemplates.ts";
import {
  nudgeVaultKickstartEmail, nudgeFirstTenderEmail, trialDay7MilestoneEmail, trialExpiring48hEmail, trialExpiredEmail,
  teamInviteEmail, adminNewSignupEmail, adminPaidConversionEmail,
} from "./emailTemplatesTier0.ts";
import { corrigendumAlertEmail, discoveredTendersDigestEmail, clarificationWindowReminderEmail, packReadyEmail } from "./emailTemplatesTier1.ts";
import { complianceDigestEmail, SARS_PIN_RISK_NOTE } from "./emailTemplatesTier2.ts";
import { scoutAnomalyBatchEmail, founderDailyDigestEmail } from "./emailTemplatesTier3.ts";
import type { NotificationEmail } from "./notificationEngine.ts";

const APP_URL = "https://tenderready.app";
const SAMPLE_COMPANY = "Reviewer Civils (Pty) Ltd";
const SAMPLE_REF = "N.007-030-2026/1F";
const SAMPLE_TITLE = "Upgrading of the N.7 National Route Section 30 from Berg River to Paarl";
const SAMPLE_BUYER = "SANRAL";
const SAMPLE_TENDER_ID = "sample-tender-1";

export type EmailTemplateSample = {
  key: string;
  label: string;
  tier: "Tier 0" | "Tier 1" | "Tier 2" | "Tier 3";
  render: () => NotificationEmail;
};

// Same tier -> sender-profile mapping lib/resendEmail.ts's own header
// documents (Tier 0 = system, Tier 1 = ops, Tier 2 = compliance, Tier 3 =
// scout) - one place, so the dispatch log's Category column, the gallery's
// own chips, and actions.ts's send-test path can never silently disagree
// on which profile a tier maps to. Not re-exported from actions.ts itself:
// a "use server" file may only export async functions, so a plain object
// constant has to live here instead.
export const TIER_TO_SENDER_PROFILE: Record<EmailTemplateSample["tier"], "system" | "ops" | "compliance" | "scout"> = {
  "Tier 0": "system", "Tier 1": "ops", "Tier 2": "compliance", "Tier 3": "scout",
};

export const EMAIL_TEMPLATE_SAMPLES: EmailTemplateSample[] = [
  // Tier 0 - onboarding & lifecycle
  { key: "welcome_user", label: "Welcome email", tier: "Tier 0", render: () => welcomeEmail({ companyName: SAMPLE_COMPANY, appUrl: APP_URL }) },
  { key: "nudge_vault_kickstart", label: "Vault kickstart nudge", tier: "Tier 0", render: () => nudgeVaultKickstartEmail({ companyName: SAMPLE_COMPANY, vaultDocsOnFile: 1, appUrl: APP_URL, unsubscribeUrl: `${APP_URL}/api/unsubscribe?token=sample-unsub-token` }) },
  { key: "nudge_first_tender", label: "First tender nudge", tier: "Tier 0", render: () => nudgeFirstTenderEmail({ companyName: SAMPLE_COMPANY, appUrl: APP_URL }) },
  { key: "trial_day_7_milestone", label: "Trial day-7 milestone", tier: "Tier 0", render: () => trialDay7MilestoneEmail({ companyName: SAMPLE_COMPANY, trialEndsAt: "2026-11-07", packsBuiltSoFar: 2, appUrl: APP_URL }) },
  { key: "trial_expiring_48h", label: "Trial expiring (48h)", tier: "Tier 0", render: () => trialExpiring48hEmail({ companyName: SAMPLE_COMPANY, trialEndsAt: "2026-10-29", appUrl: APP_URL }) },
  { key: "trial_expired", label: "Trial expired", tier: "Tier 0", render: () => trialExpiredEmail({ companyName: SAMPLE_COMPANY, appUrl: APP_URL }) },
  { key: "team_invite", label: "Team invite", tier: "Tier 0", render: () => teamInviteEmail({ companyName: SAMPLE_COMPANY, inviterName: "Sarel van Rensburg", role: "member", token: "sample-token-abc123", appUrl: APP_URL }) },
  { key: "admin_new_signup", label: "Admin: new signup", tier: "Tier 0", render: () => adminNewSignupEmail({ companyName: SAMPLE_COMPANY, signedUpAt: new Date().toISOString(), appUrl: APP_URL, companyId: "sample" }) },
  { key: "admin_paid_conversion", label: "Admin: paid conversion", tier: "Tier 0", render: () => adminPaidConversionEmail({ companyName: SAMPLE_COMPANY, planTier: "SANRAL Pro", billingInterval: "monthly", appUrl: APP_URL }) },

  // Tier 1 - tender operational alerts
  { key: "deadline_reminder", label: "Deadline reminder", tier: "Tier 1", render: () => deadlineReminderEmail({ contractLabel: SAMPLE_REF, closingDate: "28 Oct 2026, 11:00", daysLeft: 1, appUrl: APP_URL, tenderId: SAMPLE_TENDER_ID }) },
  { key: "print_sign_cutoff", label: "Print & transit cutoff", tier: "Tier 1", render: () => printCutoffEmail({ contractLabel: SAMPLE_REF, tenderTitle: SAMPLE_TITLE, printSignDeadline: "2026-10-28T05:00:00+02:00", hoursLeft: 18, appUrl: APP_URL, tenderId: SAMPLE_TENDER_ID }) },
  { key: "briefing_reminder", label: "Briefing countdown", tier: "Tier 1", render: () => briefingReminderEmail({ contractLabel: SAMPLE_REF, tenderTitle: SAMPLE_TITLE, briefingDate: "2026-10-29", briefingTime: "10:00", daysLeft: 1, appUrl: APP_URL, tenderId: SAMPLE_TENDER_ID }) },
  {
    key: "corrigendum_alert", label: "Corrigendum / addendum alert", tier: "Tier 1",
    render: () => corrigendumAlertEmail({
      reference: SAMPLE_REF, tenderTitle: SAMPLE_TITLE, buyerShortName: SAMPLE_BUYER, companyName: SAMPLE_COMPANY,
      changes: [
        { kind: "closing_date", date: "2026-11-04", previousDate: "2026-10-28", quote: "The closing date is hereby extended to 04 November 2026 at 11:00." },
        { kind: "other", label: "Technical specification", quote: "Clause 3.4.2 amended: minimum CIDB grading changed from 6CE to 7CE." },
      ],
      appUrl: APP_URL, tenderId: SAMPLE_TENDER_ID,
    }),
  },
  {
    key: "discovered_tenders_digest", label: "New discovered tenders digest", tier: "Tier 1",
    render: () => discoveredTendersDigestEmail({
      companyName: SAMPLE_COMPANY,
      tenders: [
        { id: "sample-1", contractNumber: "N.007-040-2026/1F", title: "Rehabilitation of N1 Section 12", buyer: "SANRAL", category: "Civil engineering", cidbGrading: null, closingDate: "2026-11-18T11:00:00+02:00", verdict: "strong_fit" },
        { id: "sample-2", contractNumber: "RFQ 88/2026", title: "Supply and installation of guardrails, Phase 2", buyer: "Western Cape Government", category: "Roads", cidbGrading: null, closingDate: "2026-11-10T12:00:00+02:00", verdict: "possible" },
      ],
      appUrl: APP_URL,
    }),
  },
  {
    key: "clarification_window", label: "Clarification window expiry", tier: "Tier 1",
    render: () => clarificationWindowReminderEmail({
      reference: SAMPLE_REF, tenderTitle: SAMPLE_TITLE, buyerShortName: SAMPLE_BUYER,
      taskDescription: "Submit clarification questions on specification ambiguity", dueDate: "2026-11-05", daysLeft: 10,
      appUrl: APP_URL, tenderId: SAMPLE_TENDER_ID,
    }),
  },
  {
    key: "pack_ready", label: "Bid pack ready", tier: "Tier 1",
    render: () => packReadyEmail({ reference: SAMPLE_REF, tenderTitle: SAMPLE_TITLE, buyerShortName: SAMPLE_BUYER, companyName: SAMPLE_COMPANY, pageCount: 42, appUrl: APP_URL, tenderId: SAMPLE_TENDER_ID }),
  },

  // Tier 2 - compliance & vault alerts
  {
    key: "compliance_expiry", label: "Compliance document expiry", tier: "Tier 2",
    render: () => complianceDigestEmail({
      companyName: SAMPLE_COMPANY,
      items: [
        { label: "SARS Tax Compliance PIN", expiryDate: "2026-11-07", daysLeft: 14, href: "/company", riskNote: SARS_PIN_RISK_NOTE },
        { label: "COID Letter of Good Standing", expiryDate: "2026-11-14", daysLeft: 21, href: "/company" },
        { label: "ECSA registration - John Smith", expiryDate: "2026-10-20", daysLeft: -4, href: "/people/sample-person" },
      ],
      appUrl: APP_URL,
    }),
  },

  // Tier 3 - founder & Quality Scout alerts
  {
    key: "scout_anomaly", label: "Quality Scout anomaly", tier: "Tier 3",
    render: () => scoutAnomalyBatchEmail({
      alerts: [
        { source: "pack", severity: "critical", message: "Pack bridge pass failed: tender_pack_jobs stuck in 'generating' past its own timeout", occurrences: 4, firstSeenAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
        { source: "narrative", severity: "error", message: "Narrative bridge pass failed: LibreOffice conversion returned no output file", occurrences: 2, firstSeenAt: new Date(Date.now() - 25 * 60 * 1000).toISOString() },
      ],
      appUrl: APP_URL,
    }),
  },
  {
    key: "founder_daily_digest", label: "Founder daily digest", tier: "Tier 3",
    render: () => founderDailyDigestEmail({ date: "24 Oct 2026", workerJobSuccessRate: { succeeded: 47, total: 49 }, newSignupsLast24h: 2, activeSubscriptions: 18, closingWithin48h: 3, scoutBacklogCount: 1, appUrl: APP_URL }),
  },
];
