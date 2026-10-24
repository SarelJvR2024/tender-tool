// Tier 2 - Compliance & Company Vault Alerts (notification engine brief,
// section 3, Tier 2). Sent to the company admin/compliance officer.
//
// ONE consolidated email per company per run (the brief's own anti-noise
// rule #2: never a separate email per missing item) - this file exports a
// single complianceDigestEmail() that takes every expiring item at once,
// not one function per field. The items themselves are NOT invented here:
// they are the exact same facts lib/notifications.ts's getNotifications()
// already reads for the topbar bell - COMPANY_EXPIRY_FIELDS (SARS PIN,
// COID letter, CIDB grading, PI insurance, ISO 9001, bank confirmation
// letter, B-BBEE proof) plus held_registrations and per-person ECSA/
// SACPCMP expiries - so this email can never disagree with what the app
// itself already shows for "what's expiring soon" (this app's own "never a
// second number that could disagree" rule). hrefs below reuse that same
// file's own routing (/company, /company/registrations, /people/:id)
// rather than inventing a new deep-link scheme.
import { formatDate } from "./dates.ts";
import { button, escapeHtml, infoCard, layout, pill, type Tone } from "./emailBrand.ts";
import { complianceSubject } from "./emailSubjects.ts";
import type { NotificationEmail } from "./notificationEngine.ts";

export type ComplianceItem = {
  label: string; // e.g. "SARS Tax Compliance PIN", "ECSA registration - John Smith"
  expiryDate: string; // ISO date
  daysLeft: number; // negative = already expired
  href: string; // where to fix it - /company, /company/registrations, or /people/:id
  riskNote?: string; // only set for the items the brief calls out by name (SARS PIN -> PPPFA non-award risk)
};

function toneFor(daysLeft: number): Tone {
  return daysLeft < 0 ? "urgent" : daysLeft <= 7 ? "warning" : "info";
}

export function complianceDigestEmail(opts: { companyName: string; items: ComplianceItem[]; appUrl: string }): NotificationEmail {
  const anyExpired = opts.items.some((i) => i.daysLeft < 0);
  const action = anyExpired
    ? `${opts.items.filter((i) => i.daysLeft < 0).length} item(s) expired`
    : `${opts.items.length} item(s) expiring soon`;
  const subject = complianceSubject({ action, companyName: opts.companyName });

  // toSorted(), not .sort() - the in-place version would mutate the
  // caller's own array, and this function reads opts.items again below (the
  // plain-text version) - a mutated sort order there isn't wrong, but
  // relying on sort-as-a-side-effect once already bit the first draft of
  // this file (the bottom button used to read opts.items[0] AFTER an
  // in-place sort had silently reordered it to whichever item happened to
  // be most urgent, sending every click to that one item's link regardless
  // of what the button's own label said).
  const sorted = [...opts.items].sort((a, b) => a.daysLeft - b.daysLeft);

  const rows = sorted.map((item) => {
    const detail = item.daysLeft < 0 ? `Expired ${Math.abs(item.daysLeft)} day${Math.abs(item.daysLeft) === 1 ? "" : "s"} ago` : item.daysLeft === 0 ? "Expires today" : `Expires in ${item.daysLeft} day${item.daysLeft === 1 ? "" : "s"}`;
    const detailLine = `<a href="${escapeHtml(`${opts.appUrl}${item.href}`)}" style="color:inherit;text-decoration:underline;">${escapeHtml(detail)} - ${escapeHtml(formatDate(item.expiryDate) ?? item.expiryDate)}</a>`;
    return {
      label: item.label,
      value: `${detailLine}${item.riskNote ? `<br /><span style="color:#5C6374;font-size:11px;">${escapeHtml(item.riskNote)}</span>` : ""}`,
      emphasis: toneFor(item.daysLeft),
    };
  });

  const html = layout(
    `
      <p style="margin:0 0 12px;">${pill(anyExpired ? "ACTION REQUIRED" : "COMPLIANCE", anyExpired ? "urgent" : "warning")}</p>
      <p style="margin:0 0 20px;font-size:17px;font-weight:700;">${escapeHtml(opts.companyName)}</p>
      <p style="margin:0 0 16px;">The following compliance item${opts.items.length === 1 ? " needs" : "s need"} attention before they lapse (each is a link to where to fix it):</p>
      ${infoCard(rows)}
      <p style="margin:0;">${button(`${opts.appUrl}/company`, "Open Company Vault")}</p>
    `,
    `${opts.companyName}: ${action}.`
  );
  const text = `${opts.companyName} - compliance items needing attention:\n${sorted
    .map((i) => `- ${i.label}: ${i.daysLeft < 0 ? `expired ${Math.abs(i.daysLeft)}d ago` : `${i.daysLeft}d left`} (${formatDate(i.expiryDate)}) - ${opts.appUrl}${i.href}`)
    .join("\n")}\n\n${opts.appUrl}/company`;
  return { subject, html, text };
}

// Risk notes the brief calls out by name - attached to a ComplianceItem by
// the caller that builds the list, never guessed at inside the render
// function itself.
export const SARS_PIN_RISK_NOTE = "Expired tax status results in non-award under PPPFA/Preferential Procurement rules.";
