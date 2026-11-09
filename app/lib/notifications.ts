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
// The default for any COMPANY_EXPIRY_FIELDS entry with no windowDays of its
// own (held_registrations/ECSA/SACPCMP below always use this one directly -
// none of those has a shorter-validity override). Found 2026-10-29: the
// company-fields loop used to apply this flat 60 to EVERY field, including
// bank_confirmation_letter_valid_until - which the vault page
// (ReadOnlyView.tsx/ComplianceDocumentsSection.tsx) and the real compliance
// checks (tenderCompliance.ts, generalTender.ts) all correctly treat as
// "renew soon" at 30 days, not 60 (a letter is only valid 3 months). The
// bell would nag about a letter 31-60 days out that the vault itself still
// showed "Current" - this file's own header comment's claim that the bell
// "agrees with what the vault and dashboard already say" was false for
// exactly this one field until the per-field windowDays override below.
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

type PersonExpiryRow = {
  id: string;
  name: string | null;
  ecsa_expiry: string | null;
  sacpcmp_expiry: string | null;
  sacnasp_expiry: string | null;
  sagc_expiry: string | null;
};

type DeadlineRow = { id: string; contract_no: string | null; description: string | null; closing_date: string | null };

/**
 * A read-only glance at two things already tracked elsewhere in the app -
 * documents on file that are expiring (company vault + held registrations +
 * per-person ECSA/SACPCMP/SACNASP/SAGC) and tenders closing soon - so the
 * topbar bell has something real to show, not a placeholder with no data
 * behind it. This is NOT a notification system: nothing here is ever marked
 * read, stored, or pushed; it's recomputed fresh on every page load from the
 * same tables the vault and dashboard already read, via RLS, same as
 * everywhere else.
 *
 * Standing review, Finding 294 (2026-11-09): this only ever checked
 * ecsa_expiry/sacpcmp_expiry for people - SACNASP/SAGC (added in a9a5364,
 * audit Q5) were never added here, even though that same commit wired them
 * into engine/compliance/watch_deadlines.py's TRACKED_PERSON_EXPIRY_FIELDS
 * (the email reminder) and lib/personCredentials.ts's PERSON_CREDENTIALS
 * (the People page's own renewal chip) - both of which have always covered
 * all four bodies. A person holding a SACNASP/SAGC registration expiring
 * soon got an email reminder and a "Renew soon" chip on their own People
 * page, but the topbar bell - checked on every page, the thing most likely
 * to actually be seen - silently said nothing. Fixed by adding the other
 * two fields here, same window/no-"held"-check rule the existing two
 * already use (matching find_due_person_credentials() exactly).
 */
export async function getNotifications(supabase: SupabaseClient): Promise<AppNotification[]> {
  const companyFields = COMPANY_EXPIRY_FIELDS.map((f) => f.field).join(", ");

  const [
    { data: companyRow, error: companyErr },
    { data: heldRows, error: heldRowsErr },
    { data: typeRows, error: typeRowsErr },
    { data: peopleRows, error: peopleRowsErr },
    { data: tenderRows, error: tenderRowsErr },
  ] = await Promise.all([
    supabase.from("companies").select(companyFields).maybeSingle(),
    supabase
      .from("held_registrations")
      .select("id, expiry_date, registration_type_id")
      .not("expiry_date", "is", null)
      .order("expiry_date", { ascending: true }),
    supabase.from("registration_types").select("id, label"),
    supabase.from("people").select("id, name, ecsa_expiry, sacpcmp_expiry, sacnasp_expiry, sagc_expiry"),
    supabase
      .from("tenders")
      .select("id, contract_no, description, closing_date, tender_packs!inner(id)")
      .not("closing_date", "is", null)
      .order("closing_date", { ascending: true }),
  ]);
  // Standing review, 2026-11-06: 4th sweep blind spot (array/tuple
  // Promise.all destructures never match "const { data"). Real finding,
  // fixed with a behavior change: these 5 reads used to fall through to
  // `?? []`/null defaults on a failure, which this function's own callers
  // cannot tell apart from a genuine "nothing expiring/closing soon" case
  // - AppShell.tsx's own `getNotifications(supabase).catch(...)` and
  // dashboard/page.tsx's own top-level try/catch both already exist
  // specifically to turn an exception from this function into a visible
  // "couldn't load"/retry state instead of a false empty bell - they were
  // just never triggered by this bug class, because nothing here ever
  // threw on a soft { error } failure. Throwing now (after logging) routes
  // straight into that already-built handling on both callers, rather than
  // changing this function's return shape and touching both call sites.
  const err = companyErr ?? heldRowsErr ?? typeRowsErr ?? peopleRowsErr ?? tenderRowsErr;
  if (err) {
    console.error("a notifications read failed", { companyErr, heldRowsErr, typeRowsErr, peopleRowsErr, tenderRowsErr });
    throw new Error(`getNotifications: a read failed (${err.message})`);
  }

  const typeLabelById = new Map(((typeRows ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));

  const notifications: AppNotification[] = [];

  const company = (companyRow ?? null) as Record<string, string | null> | null;
  if (company) {
    for (const { field, label, windowDays } of COMPANY_EXPIRY_FIELDS) {
      const left = daysUntil(company[field]);
      if (!withinWindow(left, windowDays ?? DOCUMENT_WINDOW_DAYS)) continue;
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
      ["sacnasp_expiry", "SACNASP registration"],
      ["sagc_expiry", "SAGC registration"],
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
