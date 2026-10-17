import { expiryStatus, type StatusChip } from "@/lib/dates";

// Per-person professional registrations that carry an expiry / renewal date
// (migration 0035). Mirrors engine/compliance/watch_deadlines.py
// TRACKED_PERSON_EXPIRY_FIELDS - same columns, and the same 60-day
// expiryStatus() threshold as the Document Vault, so the badge here and the
// reminder agree on "renew soon".
export const PERSON_CREDENTIALS = [
  { body: "ECSA", numberKey: "ecsa_number", levelKey: "ecsa_level", expiryKey: "ecsa_expiry" },
  { body: "SACPCMP", numberKey: "sacpcmp_number", levelKey: null, expiryKey: "sacpcmp_expiry" },
] as const;

export type PersonCredentialFields = {
  ecsa_level?: string | null;
  ecsa_number?: string | null;
  ecsa_expiry?: string | null;
  sacpcmp_number?: string | null;
  sacpcmp_expiry?: string | null;
};

export type CredentialExpiry = { body: string; expiry: string | null; status: StatusChip };

// One entry per registration the person actually holds (a number or level on
// file) or has an expiry recorded for. A held registration with no expiry
// recorded is grey "Renewal date not on file" - never treated as expired.
export function credentialExpiries(p: PersonCredentialFields): CredentialExpiry[] {
  const out: CredentialExpiry[] = [];
  for (const c of PERSON_CREDENTIALS) {
    const expiry = p[c.expiryKey] ?? null;
    const held = !!p[c.numberKey] || (c.levelKey ? !!p[c.levelKey] : false);
    if (!held && !expiry) continue;
    const status = expiry
      ? expiryStatus(expiry)
      : { label: "Renewal date not on file", bg: "#F0EEE6", color: "#6B6758" };
    out.push({ body: c.body, expiry, status });
  }
  return out;
}

export function credentialChipLabel(c: CredentialExpiry): string {
  if (!c.expiry) return `${c.body}: renewal date not on file`;
  const d = new Date(c.expiry).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  if (c.status.label === "Expired") return `${c.body} expired ${d}`;
  if (c.status.label === "Renew soon") return `${c.body} renew by ${d}`;
  return `${c.body} valid to ${d}`;
}
