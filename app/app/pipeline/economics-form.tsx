import type { CSSProperties } from "react";
import { DISCIPLINES } from "@/lib/experience";
import { commissionText, formatRand, sectorLabel, toNumber, type PackEconomics, type PriceSector } from "@/lib/dealEconomics";
import { saveTenderEconomics } from "./actions";

export type CreditPerson = { id: string; name: string };

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: "#6B6758", margin: "8px 0 3px" };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 36,
  padding: "0 8px",
  borderRadius: 7,
  border: "1px solid #E5E1D5",
  background: "#FFFFFF",
  fontSize: 13,
  color: "#16233B",
};

/**
 * "Price & credit" (items 26/27, migration 0034): the company's own submitted
 * price, who gets credit, and any commission tied to that person. Shown on a
 * Pipeline card from Bidding onwards and on the pricing history page; always
 * editable, since the final figure often differs from the first one typed.
 * Collapsed by default into a one-line summary, so the board stays scannable.
 * Plain server-rendered form (no client JS), same as the stage buttons.
 */
export function EconomicsForm({
  tenderId,
  economics,
  people,
  defaultSector,
  returnTo = "pipeline",
  prompt = false,
  toggleLabel,
}: {
  tenderId: string;
  economics: PackEconomics | null;
  people: CreditPerson[];
  defaultSector: PriceSector | null;
  returnTo?: "pipeline" | "pricing";
  // Open with an amber "Record the submitted price" call to action (a
  // submitted/won/lost card that has no price yet).
  prompt?: boolean;
  // Fixed toggle text instead of the price summary (the pricing table
  // already shows the price in its own columns).
  toggleLabel?: string;
}) {
  const price = toNumber(economics?.submitted_price_zar);
  const person = people.find((p) => p.id === economics?.submitted_by_person_id);
  const commission = economics ? commissionText(economics) : null;
  const pct = toNumber(economics?.commission_percent);
  const amount = toNumber(economics?.commission_amount_zar);
  const kind = amount !== null ? "amount" : pct !== null ? "percent" : "none";
  const sector = (economics?.price_sector as PriceSector | null) ?? defaultSector;

  const summary =
    price !== null
      ? `${formatRand(price)}${economics?.submitted_price_incl_vat === false ? " excl. VAT" : ""}${person ? ` · ${person.name}` : ""}`
      : person
        ? `No price yet · ${person.name}`
        : null;

  return (
    <details style={{ marginTop: 8 }}>
      <summary
        style={{
          cursor: "pointer",
          listStyle: "revert",
          fontSize: 12,
          fontWeight: 600,
          color: summary ? "#16233B" : prompt ? "#D97706" : "#6B6758",
          minHeight: 28,
          lineHeight: "28px",
        }}
      >
        {toggleLabel ?? summary ?? (prompt ? "Record the submitted price" : "Price & credit")}
      </summary>
      {!toggleLabel && (commission || economics?.commission_note) && (
        <div style={{ fontSize: 11, color: "#6B6758", margin: "2px 0 0" }}>
          Commission: {commission ?? "-"}
          {economics?.commission_note ? ` · ${economics.commission_note}` : ""}
        </div>
      )}

      <form action={saveTenderEconomics} style={{ marginTop: 4 }}>
        <input type="hidden" name="tender_id" value={tenderId} />
        <input type="hidden" name="return_to" value={returnTo} />

        <label style={label} htmlFor={`price-${tenderId}`}>Submitted price (R)</label>
        <input
          id={`price-${tenderId}`}
          name="price"
          inputMode="decimal"
          placeholder="e.g. 1 250 000"
          defaultValue={price !== null ? String(price) : ""}
          style={input}
        />
        <select name="incl_vat" defaultValue={economics?.submitted_price_incl_vat === false ? "excl" : "incl"} style={{ ...input, marginTop: 6 }}>
          <option value="incl">Including VAT</option>
          <option value="excl">Excluding VAT</option>
        </select>

        <label style={label} htmlFor={`person-${tenderId}`}>Credit for the submission</label>
        <select id={`person-${tenderId}`} name="person_id" defaultValue={economics?.submitted_by_person_id ?? ""} style={input}>
          <option value="">Nobody yet</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <label style={label}>Commission / revenue share</label>
        <div style={{ display: "flex", gap: 6 }}>
          <select name="commission_kind" defaultValue={kind} style={{ ...input, width: "auto", flex: "0 0 auto" }}>
            <option value="none">None</option>
            <option value="percent">%</option>
            <option value="amount">R</option>
          </select>
          <input
            name="commission_value"
            inputMode="decimal"
            aria-label="Commission value"
            defaultValue={amount !== null ? String(amount) : pct !== null ? String(pct) : ""}
            style={{ ...input, flex: 1, minWidth: 0 }}
          />
        </div>
        <input name="commission_note" placeholder="Note, e.g. paid on award only" defaultValue={economics?.commission_note ?? ""} style={{ ...input, marginTop: 6 }} />

        <label style={label} htmlFor={`sector-${tenderId}`}>Sector</label>
        <select id={`sector-${tenderId}`} name="sector" defaultValue={sector ?? ""} style={input}>
          <option value="">Unclassified</option>
          {DISCIPLINES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {!economics?.price_sector && defaultSector && (
          <div style={{ fontSize: 10, color: "#9A9684", marginTop: 2 }}>Suggested: {sectorLabel(defaultSector)} (from Discovery / tender family)</div>
        )}

        <label style={label} htmlFor={`note-${tenderId}`}>Pricing note</label>
        <input id={`note-${tenderId}`} name="price_note" placeholder="e.g. final after clarification 3" defaultValue={economics?.price_note ?? ""} style={input} />

        <button
          type="submit"
          style={{ marginTop: 10, minHeight: 44, width: "100%", border: "none", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >
          Save price & credit
        </button>
        <div style={{ fontSize: 10, color: "#9A9684", marginTop: 4 }}>Internal only - never goes into a submission pack.</div>
      </form>
    </details>
  );
}
