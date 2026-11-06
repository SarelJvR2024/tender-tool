import type { SupabaseClient } from "@supabase/supabase-js";
import { daysUntil } from "./dates";
import { COMPANY_EXPIRY_FIELDS } from "./notifications";
import type { VaultDocumentKind } from "./vaultDocuments";

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
  /**
   * Set only for the 7 rows sourced from COMPANY_EXPIRY_FIELDS - these are
   * the ones with a real Document Vault upload slot (lib/vaultDocuments.ts's
   * VAULT_DOCUMENTS). held_registrations and per-person ECSA/SACPCMP rows
   * have no such slot (they're uploaded/managed on their own pages,
   * /company/registrations and /people/[id]) and must stay link-only -
   * fabricating an upload control for them would be a control with nothing
   * real behind it.
   */
  kind?: VaultDocumentKind;
  hasExisting?: boolean;
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

/**
 * Standing review, 2026-11-06: 4th sweep blind spot - array/tuple
 * Promise.all destructures never match the sweep's own "const { data"
 * grep (a "[" sits between "const" and "{"), so these 4 reads went
 * unchecked by every prior pass. Real finding, fixed with a behavior
 * change (not just logging): every caller of this function used
 * `rows.length === 0` to mean "nothing tracked yet, so treat it as 100%
 * compliant" - `vaultCompliancePct` on the dashboard and the vault page's
 * own "Every tracked document is valid" message both took a FAILED read
 * (which also makes rows empty) for that exact same genuine-empty case,
 * so a transient Supabase failure here used to silently render a false
 * "all clear"/"100% compliant" on the one widget whose whole job is
 * catching real compliance gaps before a bid - the dangerous direction
 * this sweep has been looking for, not just a logging gap. Now returns
 * `error` alongside `rows` so each caller can tell "no documents yet"
 * from "couldn't check" and show that honestly instead of a false pass.
 */
export async function loadDocumentExpiryOverview(supabase: SupabaseClient): Promise<{ rows: DocumentExpiryRow[]; error: boolean }> {
  const companyFields = [...COMPANY_EXPIRY_FIELDS.map((f) => f.field), ...COMPANY_EXPIRY_FIELDS.map((f) => f.pathField)].join(", ");

  const [
    { data: companyRow, error: companyErr },
    { data: heldRows, error: heldRowsErr },
    { data: typeRows, error: typeRowsErr },
    { data: peopleRows, error: peopleRowsErr },
  ] = await Promise.all([
    supabase.from("companies").select(companyFields).maybeSingle(),
    supabase.from("held_registrations").select("id, expiry_date, registration_type_id"),
    supabase.from("registration_types").select("id, label"),
    supabase.from("people").select("id, name, ecsa_expiry, sacpcmp_expiry"),
  ]);
  if (companyErr) console.error("companies select failed (document expiry overview)", companyErr);
  if (heldRowsErr) console.error("held_registrations select failed (document expiry overview)", heldRowsErr);
  if (typeRowsErr) console.error("registration_types select failed (document expiry overview)", typeRowsErr);
  if (peopleRowsErr) console.error("people select failed (document expiry overview)", peopleRowsErr);
  const hadError = Boolean(companyErr) || Boolean(heldRowsErr) || Boolean(typeRowsErr) || Boolean(peopleRowsErr);
  const typeLabelById = new Map(((typeRows ?? []) as { id: string; label: string }[]).map((t) => [t.id, t.label]));

  const rows: DocumentExpiryRow[] = [];

  const company = (companyRow ?? null) as Record<string, string | null> | null;
  if (company) {
    for (const { field, label, kind, pathField } of COMPANY_EXPIRY_FIELDS) {
      const daysLeft = daysUntil(company[field]);
      const status = statusFor(daysLeft);
      rows.push({
        id: `company:${field}`,
        label,
        status,
        daysLeft,
        detail: detailFor(daysLeft, status),
        href: "/company#compliance-documents",
        kind: kind as VaultDocumentKind,
        hasExisting: !!company[pathField],
      });
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

  return { rows: rows.sort(byUrgency), error: hadError };
}
