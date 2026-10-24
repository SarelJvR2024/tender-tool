// Tier 0 - Onboarding, Welcome & Lifecycle Emails (notification engine
// brief addendum, 2026-10-24).
//
// welcomeEmail() already exists (lib/emailTemplates.ts, pre-dating this
// engine) and is NOT duplicated here - it already covers this addendum's
// "welcome-user" template (signup + next-step guidance); only its founder-
// note line is new scope, left for whoever wires the real send to decide
// the exact wording with Sarel rather than this file inventing one.
//
// Every suppression rule the brief's own "State & Suppression
// Requirements" section describes (never nudge a vault already at 2+
// documents, never nudge-first-tender once a company has a pipeline,
// cancel trial-expiry mail the moment a payment succeeds) is a CALLER
// decision, made from real tables that already exist - companies/
// held_registrations/cv_uploads for vault-document counts, tender_packs
// for "has at least 1 tender in pipeline", company_subscriptions.status
// for "payment already succeeded" (a trial-expiry sender only ever
// selects status = 'trialing' rows in the first place, so a company that
// just paid is already excluded by the time apply_payfast_itn flips its
// status to 'active' - no separate cancellation step is needed). None of
// that selection logic belongs in a template-rendering file; every
// function below only renders.
//
// This repo has no `user_profiles` or `tenant_onboarding_status` table
// (the brief assumes names that don't exist in this schema) - the real
// facts live on company_subscriptions (trial_ends_at, status),
// company_invites (migration 0077), and the vault/pipeline tables named
// above. Flagged plainly rather than silently inventing tables to match
// the brief's own assumed names.
import { formatDate } from "./dates.ts";
import { button, escapeHtml, infoCard, layout, pill } from "./emailBrand.ts";
import { unsubscribeHeaders } from "./resendEmail.ts";
import { lifecycleSubject } from "./emailSubjects.ts";
import type { NotificationEmail } from "./notificationEngine.ts";

// The 5 functions below (nudge x2, trial x3) are Tier 0's own genuinely
// recurring/promotional mail - the only ones a real unsubscribe applies to
// (migration 0093's own comment on why welcome/invite/admin-alert stay
// exempt). Each takes an optional unsubscribeUrl - the caller's own
// app/api/unsubscribe one-click link, built from
// lifecycle_unsubscribe_token_for() - and passes it straight to layout(),
// which both renders the visible link and (via
// lib/notificationEngine.ts's own NotificationEmail.headers) is where the
// real List-Unsubscribe/-Post headers get set; this file never builds
// those headers itself, see whichever sender script ends up calling
// sendNotification() for these.

export function nudgeVaultKickstartEmail(opts: { companyName: string; vaultDocsOnFile: number; appUrl: string; unsubscribeUrl?: string }): NotificationEmail {
  const subject = lifecycleSubject("Two documents start your vault - here's a fast way to add them");
  const html = layout(
    `
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">Finish setting up ${escapeHtml(opts.companyName)}'s vault</p>
      <p style="margin:0 0 20px;">Your vault has ${opts.vaultDocsOnFile} of the documents a submission pack usually needs on file. Most teams start with their CSD summary and SARS Tax Compliance PIN - both take a couple of minutes once you have the file.</p>
      ${button(`${opts.appUrl}/company`, "Add to your vault")}
    `,
    "A couple of documents will get your vault ready for your first submission.",
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName }, unsubscribeUrl: opts.unsubscribeUrl }
  );
  const text = `Finish setting up ${opts.companyName}'s vault - ${opts.vaultDocsOnFile} documents on file so far. Most teams start with their CSD summary and SARS Tax Compliance PIN.\n\n${opts.appUrl}/company`;
  return { subject, html, text, headers: opts.unsubscribeUrl ? unsubscribeHeaders(opts.unsubscribeUrl) : undefined };
}

export function nudgeFirstTenderEmail(opts: { companyName: string; appUrl: string; unsubscribeUrl?: string }): NotificationEmail {
  const subject = lifecycleSubject("Ready to shortlist your first tender?");
  const html = layout(
    `
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">Find a tender worth bidding on</p>
      <p style="margin:0 0 20px;">${escapeHtml(opts.companyName)} hasn't shortlisted a tender yet. Discovery is already scoring live SANRAL, municipal and national listings against your company's own discipline and registration profile - open it to see what's already a fit.</p>
      ${button(`${opts.appUrl}/discovery`, "Open Discovery")}
    `,
    "Discovery is already scoring live tenders against your company's profile.",
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName }, unsubscribeUrl: opts.unsubscribeUrl }
  );
  const text = `${opts.companyName} hasn't shortlisted a tender yet. Discovery is already scoring live listings against your company's profile.\n\n${opts.appUrl}/discovery`;
  return { subject, html, text, headers: opts.unsubscribeUrl ? unsubscribeHeaders(opts.unsubscribeUrl) : undefined };
}

export function trialDay7MilestoneEmail(opts: { companyName: string; trialEndsAt: string; packsBuiltSoFar: number; appUrl: string; unsubscribeUrl?: string }): NotificationEmail {
  const subject = lifecycleSubject(`You're halfway through your trial - here's what you've built`);
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("TRIAL - DAY 7", "info")}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.companyName)}'s trial so far</p>
      ${infoCard([
        { label: "Submission packs built", value: String(opts.packsBuiltSoFar) },
        { label: "Trial ends", value: escapeHtml(formatDate(opts.trialEndsAt) ?? opts.trialEndsAt) },
      ])}
      ${button(`${opts.appUrl}/billing`, "See plans")}
    `,
    `${opts.packsBuiltSoFar} pack(s) built so far - your trial ends ${formatDate(opts.trialEndsAt)}.`,
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName }, unsubscribeUrl: opts.unsubscribeUrl }
  );
  const text = `${opts.companyName}'s trial, day 7: ${opts.packsBuiltSoFar} pack(s) built so far. Trial ends ${formatDate(opts.trialEndsAt)}.\n\n${opts.appUrl}/billing`;
  return { subject, html, text, headers: opts.unsubscribeUrl ? unsubscribeHeaders(opts.unsubscribeUrl) : undefined };
}

export function trialExpiring48hEmail(opts: { companyName: string; trialEndsAt: string; appUrl: string; unsubscribeUrl?: string }): NotificationEmail {
  const subject = lifecycleSubject(`Your trial ends in 48 hours`);
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("TRIAL ENDING", "warning")}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.companyName)}'s trial ends ${escapeHtml(formatDate(opts.trialEndsAt) ?? opts.trialEndsAt)}</p>
      <p style="margin:0 0 20px;">Pick a plan now to keep everything - your Company vault, People &amp; CVs, and every tender you're tracking stay exactly as they are either way.</p>
      ${button(`${opts.appUrl}/billing`, "Choose a plan")}
    `,
    `${opts.companyName}'s trial ends ${formatDate(opts.trialEndsAt)}.`,
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName }, unsubscribeUrl: opts.unsubscribeUrl }
  );
  const text = `${opts.companyName}'s trial ends ${formatDate(opts.trialEndsAt)}. Pick a plan to keep everything.\n\n${opts.appUrl}/billing`;
  return { subject, html, text, headers: opts.unsubscribeUrl ? unsubscribeHeaders(opts.unsubscribeUrl) : undefined };
}

export function trialExpiredEmail(opts: { companyName: string; appUrl: string; unsubscribeUrl?: string }): NotificationEmail {
  const subject = lifecycleSubject(`Your trial has ended - your data is safe`);
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("TRIAL ENDED", "neutral")}</p>
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">${escapeHtml(opts.companyName)}'s trial has ended</p>
      <p style="margin:0 0 20px;">Your Company vault, People &amp; CVs and tender history are all still on file - nothing has been deleted. Pick a plan to pick up exactly where you left off.</p>
      ${button(`${opts.appUrl}/billing`, "Choose a plan")}
    `,
    `${opts.companyName}'s trial has ended - your data is safe.`,
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName }, unsubscribeUrl: opts.unsubscribeUrl }
  );
  const text = `${opts.companyName}'s trial has ended. Your vault, people and tender history are all still on file.\n\n${opts.appUrl}/billing`;
  return { subject, html, text, headers: opts.unsubscribeUrl ? unsubscribeHeaders(opts.unsubscribeUrl) : undefined };
}

// Data source: company_invites (migration 0077) - this function only
// renders the email; the invite link, token and expiry are exactly what
// that table and its redeem_company_invite()/invite_preview() RPCs already
// produce for the existing copy-the-link flow (app/app/invite/[token]/
// page.tsx). This is new scope only in the sense that nothing currently
// EMAILS that link - it's created and copied by hand today.
export function teamInviteEmail(opts: { companyName: string; inviterName: string; role: string; token: string; appUrl: string }): NotificationEmail {
  const subject = lifecycleSubject(`${opts.inviterName} invited you to join ${opts.companyName} on Tender Ready`);
  const html = layout(
    `
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;">You've been invited to ${escapeHtml(opts.companyName)}</p>
      <p style="margin:0 0 20px;">${escapeHtml(opts.inviterName)} has invited you to join as ${escapeHtml(opts.role)} on Tender Ready - the shared workspace for ${escapeHtml(opts.companyName)}'s tender submissions.</p>
      ${button(`${opts.appUrl}/invite/${opts.token}`, "Accept invitation")}
    `,
    `${opts.inviterName} invited you to join ${opts.companyName} on Tender Ready.`,
    { appUrl: opts.appUrl, recipientContext: { kind: "account", companyName: opts.companyName } }
  );
  const text = `${opts.inviterName} invited you to join ${opts.companyName} on Tender Ready as ${opts.role}.\n\n${opts.appUrl}/invite/${opts.token}`;
  return { subject, html, text };
}

// Data source: companies (new row) - company-level founder alert.
export function adminNewSignupEmail(opts: { companyName: string; signedUpAt: string; appUrl: string; companyId: string }): NotificationEmail {
  const subject = lifecycleSubject(`New signup: ${opts.companyName}`);
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("NEW SIGNUP", "success")}</p>
      <p style="margin:0 0 20px;font-size:17px;font-weight:700;">${escapeHtml(opts.companyName)}</p>
      <p style="margin:0 0 20px;color:#5C6374;font-size:13px;">Signed up ${escapeHtml(formatDate(opts.signedUpAt) ?? opts.signedUpAt)}.</p>
      ${button(`${opts.appUrl}/admin`, "Open Admin Console")}
    `,
    `${opts.companyName} just signed up.`,
    { appUrl: opts.appUrl }
  );
  const text = `New signup: ${opts.companyName} (${formatDate(opts.signedUpAt)}).\n\n${opts.appUrl}/admin`;
  return { subject, html, text };
}

// Data source: company_subscriptions (apply_payfast_itn setting status =
// 'active') - founder alert on real revenue, not a guess.
export function adminPaidConversionEmail(opts: { companyName: string; planTier: string; billingInterval: "monthly" | "yearly"; appUrl: string }): NotificationEmail {
  const subject = lifecycleSubject(`Paid conversion: ${opts.companyName} (${opts.planTier})`);
  const html = layout(
    `
      <p style="margin:0 0 16px;">${pill("PAID CONVERSION", "success")}</p>
      <p style="margin:0 0 20px;font-size:17px;font-weight:700;">${escapeHtml(opts.companyName)}</p>
      ${infoCard([
        { label: "Plan", value: escapeHtml(opts.planTier) },
        { label: "Billing", value: opts.billingInterval === "yearly" ? "Yearly" : "Monthly" },
      ])}
      ${button(`${opts.appUrl}/admin`, "Open Admin Console")}
    `,
    `${opts.companyName} converted to a paid ${opts.planTier} plan.`,
    { appUrl: opts.appUrl }
  );
  const text = `Paid conversion: ${opts.companyName} - ${opts.planTier} (${opts.billingInterval}).\n\n${opts.appUrl}/admin`;
  return { subject, html, text };
}
