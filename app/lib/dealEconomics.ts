// Tender deal economics (feature list items 26 + 27, migration 0034): the
// company's own submitted price, who gets credit, and any commission tied to
// that person - all on the tender_packs row. Shared by the Pipeline board's
// "Price & credit" form and the pricing history page (/pipeline/pricing).

import { DISCIPLINES } from "@/lib/experience";
import { GENERAL_FAMILY } from "@/lib/generalTender";

export type PriceSector = (typeof DISCIPLINES)[number]["value"];

export function isPriceSector(v: unknown): v is PriceSector {
  return typeof v === "string" && DISCIPLINES.some((d) => d.value === v);
}

export function sectorLabel(v: string | null | undefined): string {
  return DISCIPLINES.find((d) => d.value === v)?.label ?? "Unclassified";
}

/** The columns 0034 adds, as selected from tender_packs. */
export const ECONOMICS_COLUMNS =
  "submitted_price_zar, submitted_price_incl_vat, submitted_by_person_id, commission_percent, commission_amount_zar, commission_note, price_sector, price_note, price_recorded_at";

export type PackEconomics = {
  submitted_price_zar: number | string | null; // numeric arrives as string from PostgREST
  submitted_price_incl_vat: boolean;
  submitted_by_person_id: string | null;
  commission_percent: number | string | null;
  commission_amount_zar: number | string | null;
  commission_note: string | null;
  price_sector: string | null;
  price_note: string | null;
  price_recorded_at: string | null;
};

export function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "R 1 234 567" (en-ZA grouping), cents only when there are any. */
export function formatRand(v: number | string | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return "-";
  const hasCents = Math.round(n * 100) % 100 !== 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/**
 * Parses a typed rand amount: "R 1 234 567,89", "1,234,567.89", "1234567".
 * A single comma followed by exactly 1-2 digits at the end is a decimal comma
 * (the en-ZA convention); any other comma is a thousands separator.
 * Returns undefined for blank input, null for unparseable.
 */
export function parseRand(raw: FormDataEntryValue | null): number | null | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.replace(/[Rr]/g, "").replace(/[\s  ']/g, "");
  if (s === "") return undefined;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

export function parsePercent(raw: FormDataEntryValue | null): number | null | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.replace(/[%\s]/g, "").replace(",", ".");
  if (s === "") return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 100 ? n : null;
}

/** "Tender type" for the pricing history: tenders.family, labelled. */
export function tenderTypeLabel(family: string | null): string {
  if (!family || family === "UNKNOWN") return "Unknown type";
  if (family === GENERAL_FAMILY) return "General (non-SANRAL)";
  return `SANRAL ${family.replace(/ Consultant Tender$/, "")}`;
}

/** Client: the buyer, or SANRAL for the SANRAL families (same rule as /pipeline cards). */
export function clientLabel(buyer: string | null, family: string | null): string {
  return buyer || (family && family !== GENERAL_FAMILY && family !== "UNKNOWN" ? "SANRAL" : "(unknown buyer)");
}

/**
 * Best guess at a tender's sector when none is stored: Discovery's own
 * categories (assess_tender.py categorize(), first real one), else roads &
 * civil for a SANRAL family tender (SANRAL only issues road work). Used to
 * prefill the form and, flagged as derived, in the history.
 */
export function derivedSector(family: string | null, categories: string[] | null | undefined): PriceSector | null {
  const fromDiscovery = (categories ?? []).find(isPriceSector);
  if (fromDiscovery) return fromDiscovery;
  if (family && family !== GENERAL_FAMILY && family !== "UNKNOWN") return "roads_civil";
  return null;
}

/** Commission in rand, when it can be worked out (a record, not a payroll calculation). */
export function commissionRand(e: Pick<PackEconomics, "submitted_price_zar" | "commission_percent" | "commission_amount_zar">): number | null {
  const amount = toNumber(e.commission_amount_zar);
  if (amount !== null) return amount;
  const pct = toNumber(e.commission_percent);
  const price = toNumber(e.submitted_price_zar);
  return pct !== null && price !== null ? Math.round(price * pct) / 100 : null;
}

export function commissionText(e: Pick<PackEconomics, "submitted_price_zar" | "commission_percent" | "commission_amount_zar">): string | null {
  const pct = toNumber(e.commission_percent);
  const amount = toNumber(e.commission_amount_zar);
  if (amount !== null) return formatRand(amount);
  if (pct !== null) {
    const r = commissionRand(e);
    return r !== null ? `${pct}% (${formatRand(r)})` : `${pct}%`;
  }
  return null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
