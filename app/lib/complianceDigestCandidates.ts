// Service-role-safe candidate finder for scripts/send-compliance-digest.ts.
//
// Deliberately NOT a call to lib/notifications.ts's getNotifications() -
// that function has no company_id parameter at all and relies entirely on
// RLS to scope its unfiltered `companies`/`held_registrations`/`people`
// reads to "whichever company the CURRENT SIGNED-IN USER belongs to". A
// service-role client has no signed-in user and bypasses RLS outright, so
// calling it from this batch script would either error (.maybeSingle() on
// every company's row at once) or read across every tenant at once -
// exactly the cross-tenant leak class this schema's own RLS exists to
// prevent. This file re-implements the identical field list and day-count
// rule (same COMPANY_EXPIRY_FIELDS constant, same daysUntil()) with an
// EXPLICIT company_id filter on every query instead, so the two can never
// silently disagree on which fields count or how "days left" is computed,
// while staying safe for a cross-tenant service-role caller.
//
// Coverage vs the brief's own list: SARS Tax PIN, COIDA Letter of Good
// Standing, B-BBEE proof, CIDB registration, and per-person ECSA/SACPCMP/
// SACNASP/SAGC - all five via COMPANY_EXPIRY_FIELDS + people (SACNASP/SAGC
// added as Finding 294's fix, 2026-11-09 - this file was written 2026-10-27,
// 10 days after a9a5364 wired SACNASP/SAGC into
// lib/personCredentials.ts/engine/compliance/watch_deadlines.py, but never
// picked the two fields up itself; same root cause as the identical gap
// just fixed in lib/notifications.ts and lib/documentExpiry.ts). CSD registration is
// deliberately NOT included - confirmed by reading every migration, this
// schema has no CSD expiry field anywhere (South Africa's CSD registration
// isn't a fixed-term certificate the way the others are; see
// lib/complianceExpiryReminders.ts's own identical, earlier finding on the
// same gap). held_registrations (catalog/property registrations) is
// included too, beyond the brief's own list, since it's already one of the
// same facts the topbar bell shows and omitting it would create exactly
// the "a second number that could disagree" gap this file's own
// architecture note warns against.
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntil } from "./dates.ts";
import { COMPANY_EXPIRY_FIELDS } from "./companyExpiryFields.ts";
import type { ComplianceItem } from "./emailTemplatesTier2.ts";
import { SARS_PIN_RISK_NOTE } from "./emailTemplatesTier2.ts";

/** Escalating reminder cadence - fires once per item per threshold crossed, not every day within a window (that would re-send the same reminder for up to 60 days straight). Claimed via notification_claims keyed by (item, threshold), same pattern scripts/send-deadline-reminders.ts's own record_deadline_reminder_sent(threshold_days) already uses. */
export const COMPLIANCE_DIGEST_THRESHOLDS = [30, 14, 7] as const;
export type ComplianceDigestThreshold = (typeof COMPLIANCE_DIGEST_THRESHOLDS)[number];

export type ComplianceDigestCandidate = {
  itemKey: string; // stable across runs for the SAME underlying fact - used as half of the notification_claims idempotency key
  threshold: ComplianceDigestThreshold;
  item: ComplianceItem;
};

type CompanyExpiryRow = Record<string, string | null> & { id: string; legal_name: string | null };
type HeldRegistrationRow = { id: string; expiry_date: string | null; registration_type_id: string };
type RegistrationTypeRow = { id: string; label: string };
type PersonExpiryRow = {
  id: string;
  name: string | null;
  ecsa_expiry: string | null;
  sacpcmp_expiry: string | null;
  sacnasp_expiry: string | null;
  sagc_expiry: string | null;
};

// Finding 476 (standing QA/robustness review, 2026-11-14): this used to match
// ONLY the exact day daysLeft === 30/14/7 (COMPLIANCE_DIGEST_THRESHOLDS.find),
// so a missed, late or failed daily cron run (compliance-alerts.yml, same
// GitHub Actions scheduler whose own unreliability this file's workflow
// header already warns about: "GitHub's scheduled runs are at best every 5
// minutes and can be delayed or dropped") permanently lost that threshold's
// one-shot reminder for SARS Tax PIN/COID/B-BBEE/CIDB/ECSA/SACPCMP/held
// registrations - exactly the facts this file's own header says "can
// disqualify an active bid outright." The real send is still gated by
// claim_notification()'s own one-time-ever claim, keyed on (company, item,
// threshold) with no day component at all (complianceDigestIdempotencyKey())
// - so widening the match to a non-overlapping range below each threshold,
// floored just above the next-lower one, is safe: the first run to reach an
// item within its own window claims and sends; every later run that same
// window just finds it already claimed and no-ops. Same bug class and same
// fix shape as clarificationThresholdFor() (Finding 401) and
// trialDay7Candidates() (Finding 387).
const COMPLIANCE_DIGEST_30_DAY_FLOOR = 14;
const COMPLIANCE_DIGEST_14_DAY_FLOOR = 7;
const COMPLIANCE_DIGEST_7_DAY_FLOOR = 0;

export function thresholdFor(daysLeft: number): ComplianceDigestThreshold | null {
  if (daysLeft <= 30 && daysLeft > COMPLIANCE_DIGEST_30_DAY_FLOOR) return 30;
  if (daysLeft <= 14 && daysLeft > COMPLIANCE_DIGEST_14_DAY_FLOOR) return 14;
  if (daysLeft <= 7 && daysLeft > COMPLIANCE_DIGEST_7_DAY_FLOOR) return 7;
  return null;
}

/** Every compliance-digest candidate for ONE company, explicitly filtered - never relies on RLS. */
export async function complianceDigestCandidatesForCompany(supabase: SupabaseClient, companyId: string): Promise<ComplianceDigestCandidate[]> {
  const companyFields = COMPANY_EXPIRY_FIELDS.map((f) => f.field).join(", ");
  const [
    { data: companyRow, error: companyErr },
    { data: heldRows, error: heldRowsErr },
    { data: typeRows, error: typeRowsErr },
    { data: peopleRows, error: peopleRowsErr },
  ] = await Promise.all([
    supabase.from("companies").select(`id, legal_name, ${companyFields}`).eq("id", companyId).maybeSingle(),
    supabase.from("held_registrations").select("id, expiry_date, registration_type_id").eq("company_id", companyId).not("expiry_date", "is", null),
    supabase.from("registration_types").select("id, label"),
    supabase.from("people").select("id, name, ecsa_expiry, sacpcmp_expiry, sacnasp_expiry, sagc_expiry").eq("company_id", companyId),
  ]);
  // Standing review, 2026-11-06: 4th sweep blind spot (array/tuple
  // Promise.all destructures never match "const { data"). A failed read
  // here means this ONE company gets no digest candidate THIS run (not a
  // false "all clear" sent to them - nothing is sent either way) - bounded
  // to one missed day of a 30/14/7-day escalating cadence, not a lost
  // warning outright. Logged so a transient miss is now visible to the
  // operator instead of indistinguishable from "genuinely nothing due".
  if (companyErr) console.error(`companies select failed (compliance digest, company ${companyId})`, companyErr);
  if (heldRowsErr) console.error(`held_registrations select failed (compliance digest, company ${companyId})`, heldRowsErr);
  if (typeRowsErr) console.error(`registration_types select failed (compliance digest, company ${companyId})`, typeRowsErr);
  if (peopleRowsErr) console.error(`people select failed (compliance digest, company ${companyId})`, peopleRowsErr);

  const typeLabelById = new Map(((typeRows ?? []) as RegistrationTypeRow[]).map((t) => [t.id, t.label]));
  const out: ComplianceDigestCandidate[] = [];

  const company = companyRow as CompanyExpiryRow | null;
  if (company) {
    for (const { field, label } of COMPANY_EXPIRY_FIELDS) {
      const left = daysUntil(company[field]);
      if (left === null) continue;
      const threshold = thresholdFor(left);
      if (threshold === null) continue;
      out.push({
        itemKey: `company:${field}`,
        threshold,
        item: {
          label,
          expiryDate: company[field]!,
          daysLeft: left,
          href: "/company",
          riskNote: field === "sars_tcs_pin_expiry" ? SARS_PIN_RISK_NOTE : undefined,
        },
      });
    }
  }

  for (const h of (heldRows ?? []) as HeldRegistrationRow[]) {
    const left = daysUntil(h.expiry_date);
    if (left === null) continue;
    const threshold = thresholdFor(left);
    if (threshold === null) continue;
    out.push({
      itemKey: `held:${h.id}`,
      threshold,
      item: { label: typeLabelById.get(h.registration_type_id) ?? "Registration", expiryDate: h.expiry_date!, daysLeft: left, href: "/company/registrations" },
    });
  }

  for (const p of (peopleRows ?? []) as PersonExpiryRow[]) {
    for (const [field, label] of [
      ["ecsa_expiry", "ECSA registration"],
      ["sacpcmp_expiry", "SACPCMP registration"],
      ["sacnasp_expiry", "SACNASP registration"],
      ["sagc_expiry", "SAGC registration"],
    ] as const) {
      const left = daysUntil(p[field]);
      if (left === null) continue;
      const threshold = thresholdFor(left);
      if (threshold === null) continue;
      out.push({
        itemKey: `person:${p.id}:${field}`,
        threshold,
        item: { label: `${label} - ${p.name ?? "Unnamed"}`, expiryDate: p[field]!, daysLeft: left, href: `/people/${p.id}` },
      });
    }
  }

  return out;
}

export function complianceDigestIdempotencyKey(companyId: string, itemKey: string, threshold: number): string {
  return `compliance-digest-${companyId}-${itemKey}-${threshold}`;
}
