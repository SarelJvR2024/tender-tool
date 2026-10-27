import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntil } from "./dates";
import { DEADLINE_WINDOW_DAYS } from "./deadlineReminders";
import { COMPANY_EXPIRY_FIELDS } from "./companyExpiryFields";

export type AppNotification = {
  id: string;
  kind: "document" | "deadline";
  title: string;
  detail: string;
  daysLeft: number;
  severity: "destructive" | "warning";
  href: string;
};

// Same "renew soon" window as expiryStatus()'s default, and the same
// DeadlineChip "soon" band for tenders - these are read-only glances at
// data the vault and dashboard already track, not a new source of truth.
const DOCUMENT_WINDOW_DAYS = 60;
// DEADLINE_WINDOW_DAYS itself now lives in ./deadlineReminders (re-exported
// here for every existing caller of this module) - see that file's own
// comment for why.
export { DEADLINE_WINDOW_DAYS };

function severityFor(daysLeft: number): "destructive" | "warning" {
  return daysLeft < 0 ? "destructive" : "warning";
}

function withinWindow(daysLeft: number | null, windowDays: number): daysLeft is number {
  return daysLeft !== null && daysLeft <= windowDays;
}

// Re-exported for documentExpiry.ts's own vault-wide overview and
// scripts/send-compliance-digest.ts - the one list of which company-level
// fields carry an expiry date, shared so no caller silently diverges on
// which fields count as "a document with an expiry". Now defined in
// lib/companyExpiryFields.ts (see that file's own header for why).
export { COMPANY_EXPIRY_FIELDS };

type HeldRegistrationRow = {
  id: string;
  expiry_date: string | null;
  registration_type_id: string;
};

type PersonExpiryRow = { id: string; name: string | null; ecsa_expiry: string | null; sacpcmp_expiry: string | null };

type DeadlineRow = { id: string; contract_no: string | null; description: string | null; closing_date: string | null };

/**
 * A read-only glance at two things already tracked elsewhere in the app -
 * documents on file that are expiring (company vault + held registrations +
 * per-person ECSA/SACPCMP) and tenders closing soon - so the topbar bell has
 * something real to show, not a placeholder with no data behind it. This is
 * NOT a notification system: nothing here is ever marked read, stored, or
 * pushed; it's recomputed fresh on every page load from the same tables the
 * vault and dashboard already read, via RLS, same as everywhere else.
 */
export async function getNotifications(supabase: SupabaseClient): Promise<AppNotification[]> {
  const companyFields = COMPANY_EXPIRY_FIELDS.map((f) => f.field).join(", ");

  const [{ data: companyRow }, { data: heldRows }, { data: typeRows }, { data: peopleRows }, { data: tenderRows }] = await Promise.all([
    supabase.from("companies").select(companyFields).maybeSingle(),
    supabase
      .from("held_registrations")
      .select("id, expiry_date, registration_type_id")
      .not("expiry_date", "is", null)
      .order("expiry_date", { ascending: true }),
    supabase.from("registration_types").select("id, label"),
    supabase.from("people").select("id, name, ecsa_expiry, sacpcmp_expiry"),
    supabase
      .from("tenders")
      .select("id, contract_no, description, closing_date, tender_packs!inner(id)")
      .not("closing_date", "is", null)
      .order("closing_date", { ascending: true }),
  ]);

  const typeLabelById = new Map(((typeRows ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));

  const notifications: AppNotification[] = [];

  const company = (companyRow ?? null) as Record<string, string | null> | null;
  if (company) {
    for (const { field, label } of COMPANY_EXPIRY_FIELDS) {
      const left = daysUntil(company[field]);
      if (!withinWindow(left, DOCUMENT_WINDOW_DAYS)) continue;
      notifications.push({
        id: `company:${field}`,
        kind: "document",
        title: label,
        detail: left < 0 ? `Expired ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago` : `Expires in ${left} day${left === 1 ? "" : "s"}`,
        daysLeft: left,
        severity: severityFor(left),
        href: "/company",
      });
    }
  }

  for (const h of (heldRows ?? []) as unknown as HeldRegistrationRow[]) {
    const left = daysUntil(h.expiry_date);
    if (!withinWindow(left, DOCUMENT_WINDOW_DAYS)) continue;
    notifications.push({
      id: `held:${h.id}`,
      kind: "document",
      title: typeLabelById.get(h.registration_type_id) ?? "Registration",
      detail: left < 0 ? `Expired ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago` : `Expires in ${left} day${left === 1 ? "" : "s"}`,
      daysLeft: left,
      severity: severityFor(left),
      href: "/company/registrations",
    });
  }

  for (const p of (peopleRows ?? []) as PersonExpiryRow[]) {
    for (const [field, label] of [
      ["ecsa_expiry", "ECSA registration"],
      ["sacpcmp_expiry", "SACPCMP registration"],
    ] as const) {
      const left = daysUntil(p[field]);
      if (!withinWindow(left, DOCUMENT_WINDOW_DAYS)) continue;
      notifications.push({
        id: `person:${p.id}:${field}`,
        kind: "document",
        title: `${label} - ${p.name ?? "Unnamed"}`,
        detail: left < 0 ? `Expired ${Math.abs(left)} day${Math.abs(left) === 1 ? "" : "s"} ago` : `Expires in ${left} day${left === 1 ? "" : "s"}`,
        daysLeft: left,
        severity: severityFor(left),
        href: `/people/${p.id}`,
      });
    }
  }

  for (const t of (tenderRows ?? []) as unknown as DeadlineRow[]) {
    const left = daysUntil(t.closing_date);
    if (!withinWindow(left, DEADLINE_WINDOW_DAYS) || left < 0) continue;
    notifications.push({
      id: `deadline:${t.id}`,
      kind: "deadline",
      title: t.contract_no ?? t.description ?? "Tender",
      detail: left === 0 ? "Closes today" : `Closes in ${left} day${left === 1 ? "" : "s"}`,
      daysLeft: left,
      severity: left <= 3 ? "destructive" : "warning",
      href: `/tenders/${t.id}`,
    });
  }

  return notifications.sort((a, b) => a.daysLeft - b.daysLeft);
}
