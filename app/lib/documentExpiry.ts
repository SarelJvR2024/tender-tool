import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntil } from "./dates";
import { COMPANY_EXPIRY_FIELDS } from "./notifications";

/**
 * Company vault's document-expiry overview: every document this app already
 * tracks an expiry date for (company fields, held registrations, per-person
 * ECSA/SACPCMP), regardless of how far out it expires - unlike
 * lib/notifications.ts's own getNotifications(), which deliberately only
 * surfaces what's within its 60-day "renew soon" bell window. Same source
 * tables and the same COMPANY_EXPIRY_FIELDS list, read without a window
 * filter, so this can never disagree with what the bell already says about
 * the same document - just shows more of it.
 */

export type DocumentExpiryStatus = "expired" | "expiring_soon" | "missing" | "valid";

export type DocumentExpiryRow = {
  id: string;
  label: string;
  status: DocumentExpiryStatus;
  daysLeft: number | null;
  detail: string;
  href: string;
};

// "Expires in 30 days" per Sarel's own spec - a tighter window than the
// notification bell's 60-day "renew soon" glance, since this list is meant
// to answer "what needs attention before my next bid", not "what's worth a
// heads-up eventually".
const EXPIRING_SOON_WINDOW_DAYS = 30;

export function statusFor(daysLeft: number | null): DocumentExpiryStatus {
  if (daysLeft === null) return "missing";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
  return "valid";
}

export function detailFor(daysLeft: number | null, status: DocumentExpiryStatus): string {
  if (status === "missing") return "No expiry date on file.";
  const n = Math.abs(daysLeft as number);
  return status === "expired" ? `Expired ${n} day${n === 1 ? "" : "s"} ago.` : `Expires in ${n} day${n === 1 ? "" : "s"}.`;
}

// Sort order: real problems first (expired, then expiring soon), then
// unknowns (no date on file at all - itself a gap worth seeing), then
// everything actually fine.
export const STATUS_RANK: Record<DocumentExpiryStatus, number> = { expired: 0, expiring_soon: 1, missing: 2, valid: 3 };

export function byUrgency(a: DocumentExpiryRow, b: DocumentExpiryRow): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
}

type HeldRegistrationRow = { id: string; expiry_date: string | null; registration_type_id: string };
type PersonExpiryRow = { id: string; name: string | null; ecsa_expiry: string | null; sacpcmp_expiry: string | null };

export async function loadDocumentExpiryOverview(supabase: SupabaseClient): Promise<DocumentExpiryRow[]> {
  const companyFields = COMPANY_EXPIRY_FIELDS.map((f) => f.field).join(", ");

  const [{ data: companyRow }, { data: heldRows }, { data: typeRows }, { data: peopleRows }] = await Promise.all([
    supabase.from("companies").select(companyFields).maybeSingle(),
    supabase.from("held_registrations").select("id, expiry_date, registration_type_id"),
    supabase.from("registration_types").select("id, label"),
    supabase.from("people").select("id, name, ecsa_expiry, sacpcmp_expiry"),
  ]);
  const typeLabelById = new Map(((typeRows ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));

  const rows: DocumentExpiryRow[] = [];

  const company = (companyRow ?? null) as Record<string, string | null> | null;
  if (company) {
    for (const { field, label } of COMPANY_EXPIRY_FIELDS) {
      const daysLeft = daysUntil(company[field]);
      const status = statusFor(daysLeft);
      rows.push({ id: `company:${field}`, label, status, daysLeft, detail: detailFor(daysLeft, status), href: "/company" });
    }
  }

  for (const h of (heldRows ?? []) as unknown as HeldRegistrationRow[]) {
    const daysLeft = daysUntil(h.expiry_date);
    const status = statusFor(daysLeft);
    rows.push({
      id: `held:${h.id}`,
      label: typeLabelById.get(h.registration_type_id) ?? "Registration",
      status,
      daysLeft,
      detail: detailFor(daysLeft, status),
      href: "/company/registrations",
    });
  }

  for (const p of (peopleRows ?? []) as PersonExpiryRow[]) {
    for (const [field, label] of [
      ["ecsa_expiry", "ECSA registration"],
      ["sacpcmp_expiry", "SACPCMP registration"],
    ] as const) {
      if (!p[field]) continue; // not every person needs these - only show it once someone has one on file
      const daysLeft = daysUntil(p[field]);
      const status = statusFor(daysLeft);
      rows.push({ id: `person:${p.id}:${field}`, label: `${label} - ${p.name ?? "Unnamed"}`, status, daysLeft, detail: detailFor(daysLeft, status), href: `/people/${p.id}` });
    }
  }

  return rows.sort(byUrgency);
}
