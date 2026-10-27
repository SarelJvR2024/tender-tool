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
// Standing, B-BBEE proof, CIDB registration, and per-person ECSA/SACPCMP -
// all five via COMPANY_EXPIRY_FIELDS + people. CSD registration is
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
import { COMPANY_EXPIRY_FIELDS } from "./notifications.ts";
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
type PersonExpiryRow = { id: string; name: string | null; ecsa_expiry: string | null; sacpcmp_expiry: string | null };

function thresholdFor(daysLeft: number): ComplianceDigestThreshold | null {
  return COMPLIANCE_DIGEST_THRESHOLDS.find((t) => t === daysLeft) ?? null;
}

/** Every compliance-digest candidate for ONE company, explicitly filtered - never relies on RLS. */
export async function complianceDigestCandidatesForCompany(supabase: SupabaseClient, companyId: string): Promise<ComplianceDigestCandidate[]> {
  const companyFields = COMPANY_EXPIRY_FIELDS.map((f) => f.field).join(", ");
  const [{ data: companyRow }, { data: heldRows }, { data: typeRows }, { data: peopleRows }] = await Promise.all([
    supabase.from("companies").select(`id, legal_name, ${companyFields}`).eq("id", companyId).maybeSingle(),
    supabase.from("held_registrations").select("id, expiry_date, registration_type_id").eq("company_id", companyId).not("expiry_date", "is", null),
    supabase.from("registration_types").select("id, label"),
    supabase.from("people").select("id, name, ecsa_expiry, sacpcmp_expiry").eq("company_id", companyId),
  ]);

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
