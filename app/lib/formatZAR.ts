// Canonical South African Rand formatter (Sarel's own brief, 2026-10-24,
// Batch 6) - the one place "financial, tender value, and BOQ numbers" get
// formatted, replacing lib/dealEconomics.ts's own formerly-separate
// formatRand() (now a thin re-export of this, so its ~30 existing callers
// never had to change) and several hand-rolled `R${n.toLocaleString()}`
// sites across the app.
//
// Deliberately does NOT replace lib/savingsCounter.ts's own formatRand():
// that one formats the "hours and Rand we estimate this saved you" counter,
// a round, intentionally-approximate marketing number governed by its own
// written spec (Tender-Ready-Claude-Spec_v1.md §9.3/§6, pinned by
// savingsCounter.spec.ts's own exact-string assertions) - "R27 900", no
// decimals, space-grouped. That is a different, already-decided format for
// a different kind of number, not an oversight to fold in here.

export type ZARVatOption = "incl" | "excl" | "raw";

export type FormatZAROptions = {
  /** Appends "(incl. 15% VAT)" / "(excl. VAT)" / nothing. Omit for no suffix at all. */
  vat?: ZARVatOption;
  /** Renders "R 1.5M" / "R 250k" instead of the full comma-grouped figure - for KPI/summary badges. */
  compact?: boolean;
};

const VAT_SUFFIX: Record<ZARVatOption, string> = {
  incl: " (incl. 15% VAT)",
  excl: " (excl. VAT)",
  raw: "",
};

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function compactMagnitude(abs: number): string {
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * "R 1,250,000.00" - 2 fixed decimal places always (not the conditional
 * cents-dropping the old dealEconomics.formatRand did; this is a deliberate
 * change per Sarel's own spec). Null/undefined/NaN renders "—", never "R 0"
 * or a thrown error - the same "an absent fact is never shown as zero" rule
 * this app already follows for every other optional figure.
 */
export function formatZAR(value: number | string | null | undefined, options: FormatZAROptions = {}): string {
  const n = toNumber(value);
  if (n === null) return "—";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const body = options.compact
    ? compactMagnitude(abs)
    : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const suffix = options.vat ? VAT_SUFFIX[options.vat] : "";
  return `${sign}R ${body}${suffix}`;
}
