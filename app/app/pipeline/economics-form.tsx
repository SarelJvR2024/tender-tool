import { taxonomyGroups, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";
import { commissionText, formatRand, sectorLabel, toNumber, type PackEconomics, type PriceSector } from "@/lib/dealEconomics";
import { saveTenderEconomics } from "./actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CreditPerson = { id: string; name: string };

// Matches shadcn Input's own look (no shadcn Select exists in this repo -
// same convention company vault's EditForm already set, app/AGENTS.md
// "Company vault: shell"). Bumped to min-h-11 for this app's 40-44px
// touch-target convention, same reasoning as every other migrated form.
const selectClass = "min-h-11 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * "Price & credit" (items 26/27, migration 0034): the company's own submitted
 * price, who gets credit, and any commission tied to that person. Shown on a
 * Pipeline card from Bidding onwards and on the pricing history page; always
 * editable, since the final figure often differs from the first one typed.
 * Collapsed by default into a one-line summary, so the board stays scannable.
 * Plain server-rendered form (no client JS), same as the stage buttons.
 *
 * Design-system audit fix (2026-10-21): converted from inline-CSSProperties
 * stale hex to Tailwind + design tokens.
 */
export function EconomicsForm({
  tenderId,
  economics,
  people,
  defaultSector,
  taxonomy,
  returnTo = "pipeline",
  prompt = false,
  toggleLabel,
}: {
  tenderId: string;
  economics: PackEconomics | null;
  people: CreditPerson[];
  // The live discipline list (0040) - the sector options, grouped.
  taxonomy: DisciplineTaxonomy;
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
      ? `${formatRand(price, { vat: economics?.submitted_price_incl_vat === false ? "excl" : "incl" })}${person ? ` · ${person.name}` : ""}`
      : person
        ? `No price yet · ${person.name}`
        : null;

  return (
    <details id={`econ-${tenderId}`} className="mt-2">
      <summary
        className={cn(
          "min-h-7 cursor-pointer text-xs font-semibold",
          summary ? "text-foreground" : prompt ? "text-warning" : "text-muted-foreground",
        )}
      >
        {toggleLabel ?? summary ?? (prompt ? "Record the submitted price" : "Price & credit")}
      </summary>
      {!toggleLabel && (commission || economics?.commission_note) && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Commission: {commission ?? "-"}
          {economics?.commission_note ? ` · ${economics.commission_note}` : ""}
        </div>
      )}

      <form action={saveTenderEconomics} className="mt-1 flex flex-col gap-2.5">
        <input type="hidden" name="tender_id" value={tenderId} />
        <input type="hidden" name="return_to" value={returnTo} />

        <div>
          <Label htmlFor={`price-${tenderId}`} className="mb-1 text-[11px] font-semibold text-muted-foreground">Submitted price (R)</Label>
          <Input
            id={`price-${tenderId}`}
            name="price"
            inputMode="decimal"
            placeholder="e.g. 1 250 000"
            defaultValue={price !== null ? String(price) : ""}
            className="min-h-11 text-xs"
          />
          <select name="incl_vat" defaultValue={economics?.submitted_price_incl_vat === false ? "excl" : "incl"} className={cn(selectClass, "mt-1.5")}>
            <option value="incl">Including VAT</option>
            <option value="excl">Excluding VAT</option>
          </select>
        </div>

        <div>
          <Label htmlFor={`person-${tenderId}`} className="mb-1 text-[11px] font-semibold text-muted-foreground">Credit for the submission</Label>
          <select id={`person-${tenderId}`} name="person_id" defaultValue={economics?.submitted_by_person_id ?? ""} className={selectClass}>
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label className="mb-1 text-[11px] font-semibold text-muted-foreground">Commission / revenue share</Label>
          <div className="flex gap-1.5">
            <select name="commission_kind" defaultValue={kind} className={cn(selectClass, "w-auto shrink-0")}>
              <option value="none">None</option>
              <option value="percent">%</option>
              <option value="amount">R</option>
            </select>
            <Input name="commission_value" inputMode="decimal" aria-label="Commission value" defaultValue={amount !== null ? String(amount) : pct !== null ? String(pct) : ""} className="min-h-11 min-w-0 flex-1 text-xs" />
          </div>
          <Input name="commission_note" placeholder="Note, e.g. paid on award only" defaultValue={economics?.commission_note ?? ""} className="mt-1.5 min-h-11 text-xs" />
        </div>

        <div>
          <Label htmlFor={`sector-${tenderId}`} className="mb-1 text-[11px] font-semibold text-muted-foreground">Sector</Label>
          <select id={`sector-${tenderId}`} name="sector" defaultValue={sector ?? ""} className={selectClass}>
            <option value="">Unclassified</option>
            {taxonomyGroups(taxonomy).map(({ group, children }) => (
              <optgroup key={group.slug} label={group.label}>
                <option value={group.slug}>{group.label} (general)</option>
                {children.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {!economics?.price_sector && defaultSector && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">Suggested: {sectorLabel(defaultSector, taxonomy)} (from Discovery / tender family)</div>
          )}
        </div>

        <div>
          <Label htmlFor={`note-${tenderId}`} className="mb-1 text-[11px] font-semibold text-muted-foreground">Pricing note</Label>
          <Input id={`note-${tenderId}`} name="price_note" placeholder="e.g. final after clarification 3" defaultValue={economics?.price_note ?? ""} className="min-h-11 text-xs" />
        </div>

        <Button type="submit" className="min-h-11 w-full text-xs font-semibold">
          Save price &amp; credit
        </Button>
        <div className="text-[10px] text-muted-foreground">Internal only - never goes into a submission pack.</div>
      </form>
    </details>
  );
}
