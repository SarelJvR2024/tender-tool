// Mandatory subject-line format (notification engine brief, section 2):
// South African bidding teams route email into project folders by matching
// the tender reference number, so the reference has to be the first thing
// in the subject, every time, in exactly one place - never buried after a
// generic "Tender Ready:" prefix.
//
// One builder per category rather than a single do-everything function:
// each category's bracketed prefix is a different kind of thing (a tender
// reference vs. a fixed literal), so a single function juggling "which
// bracket this time" with optional params is more error-prone than three
// small, unambiguous ones.

const MAX_SUBJECT_LENGTH = 160; // generous; most clients truncate well before this, but nothing here should ever get close

function clamp(subject: string): string {
  return subject.length > MAX_SUBJECT_LENGTH ? `${subject.slice(0, MAX_SUBJECT_LENGTH - 1)}…` : subject;
}

/** "[<Tender Reference>] <Action / Urgency> | <Buyer Short Name>" - Tier 1 (briefing, cutoff, corrigenda). */
export function tenderSubject(opts: { reference: string; action: string; buyer: string }): string {
  return clamp(`[${opts.reference}] ${opts.action} | ${opts.buyer}`);
}

/** "[New Tenders] N found | <Company Short Name>" - the discovered-tenders digest (a batch of N, not one bracketed reference - there is no single tender reference to lead with when the email covers several at once). */
export function discoveredTendersSubject(opts: { count: number; companyName: string }): string {
  return clamp(`[New Tenders] ${opts.count} found | ${opts.companyName}`);
}

/** "[Compliance Alert] <Action Required> | <Company Name>" - Tier 2 (vault/registration expiries). */
export function complianceSubject(opts: { action: string; companyName: string }): string {
  return clamp(`[Compliance Alert] ${opts.action} | ${opts.companyName}`);
}

/** "[System / Scout Alert] <Issue Summary>" - Tier 3 (founder/admin). */
export function adminSubject(opts: { summary: string }): string {
  return clamp(`[System / Scout Alert] ${opts.summary}`);
}

/** Tier 0 onboarding/lifecycle mail has no tender or buyer to route by - a plain, unbracketed subject matching this app's existing welcome-email tone (see lib/emailTemplates.ts's welcomeEmail). */
export function lifecycleSubject(text: string): string {
  return clamp(text);
}
