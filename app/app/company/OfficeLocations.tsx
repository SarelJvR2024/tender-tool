import { createClient } from "@/lib/supabase/server";
import { COMPANY_OFFICE_COLUMNS, OFFICE_KINDS, OFFICE_PROOF_TYPES, PROVINCES, type CompanyOffice } from "@/lib/locality";
import { deleteCompanyOffice, saveCompanyOffice } from "./officeActions";
import { Banner, VaultSection, fieldGridClass } from "./_components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Office locations on the Company page (migration 0015). Self-contained
 * server component - does its own read under RLS - so company/page.tsx only
 * mounts it (that page is extended by other work concurrently).
 *
 * Why structured, not an address line: tenders score locality by province
 * (DPWI EC "Within Eastern Cape 4"), district (Cape Winelands "within the
 * boundaries of the Cape Winelands District Municipal Area 5") or local
 * municipality (uMlalazi 4, Dawid Kruiper 20 - and Dawid Kruiper REQUIRES a
 * local office). See docs/specs/Tender-Evaluation-Engine-Audit.md "Round 2".
 *
 * Migrated to the design system's tokens/Tailwind (Company vault sub-PR 2 -
 * see app/AGENTS.md) - same VaultSection shell the other sections use, and
 * the same Banner the rest of the page reads an error/empty state from.
 */

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function labelOf(list: readonly { value: string; label: string }[], v: string | null) {
  return v ? list.find((x) => x.value === v)?.label ?? v : null;
}

function OfficeFields({ office }: { office: CompanyOffice | null }) {
  return (
    <div className={fieldGridClass}>
      <div>
        <Label htmlFor="province" className="mb-1.5 block">Province *</Label>
        <select id="province" name="province" required defaultValue={office?.province ?? ""} className={selectClass}>
          <option value="" disabled>Choose…</option>
          {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="district_municipality" className="mb-1.5 block">District / metro municipality</Label>
        <Input id="district_municipality" name="district_municipality" defaultValue={office?.district_municipality ?? ""} placeholder="e.g. City of Ekurhuleni" className="min-h-11 text-sm" />
      </div>
      <div>
        <Label htmlFor="local_municipality" className="mb-1.5 block">Local municipality</Label>
        <Input id="local_municipality" name="local_municipality" defaultValue={office?.local_municipality ?? ""} placeholder="e.g. Stellenbosch" className="min-h-11 text-sm" />
      </div>
      <div>
        <Label htmlFor="town" className="mb-1.5 block">Town</Label>
        <Input id="town" name="town" defaultValue={office?.town ?? ""} className="min-h-11 text-sm" />
      </div>
      <div>
        <Label htmlFor="office_kind" className="mb-1.5 block">Office type</Label>
        <select id="office_kind" name="office_kind" defaultValue={office?.office_kind ?? "branch"} className={selectClass}>
          {OFFICE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="label" className="mb-1.5 block">Label</Label>
        <Input id="label" name="label" defaultValue={office?.label ?? ""} placeholder="e.g. Head office" className="min-h-11 text-sm" />
      </div>
      <div>
        <Label htmlFor="proof_type" className="mb-1.5 block">Proof of address held</Label>
        <select id="proof_type" name="proof_type" defaultValue={office?.proof_type ?? ""} className={selectClass}>
          <option value="">Not recorded</option>
          {OFFICE_PROOF_TYPES.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div>
        <Label htmlFor="proof_date" className="mb-1.5 block">Date on the proof</Label>
        <Input type="date" id="proof_date" name="proof_date" defaultValue={office?.proof_date ?? ""} className="min-h-11 text-sm" />
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Label htmlFor="street_address" className="mb-1.5 block">Street address</Label>
        <Input id="street_address" name="street_address" defaultValue={office?.street_address ?? ""} className="min-h-11 text-sm" />
      </div>
    </div>
  );
}

export async function OfficeLocations() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_offices").select(COMPANY_OFFICE_COLUMNS).order("created_at");
  if (error) console.error("company_offices select failed", error);
  const offices = (data ?? []) as CompanyOffice[];

  return (
    <VaultSection
      id="offices"
      title="Office locations"
      description="Some tenders award points (or require) an office in their province, district or municipality - e.g. “Within Eastern Cape 4”, “within the boundaries of the Cape Winelands District”. Add every office; any one can count. Buyers verify with a municipal account (usually under 3 months old), lease, bank letter or the CIPC registered address."
    >
      {error && (
        <div className="mb-3">
          <Banner tone="destructive">Couldn&apos;t load office locations - try refreshing. If it keeps happening, let us know.</Banner>
        </div>
      )}

      {!error && offices.length === 0 && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-sm text-warning">
          No office locations on file - locality points can&apos;t be checked on any tender.
        </div>
      )}

      {offices.map((o) => (
        <details key={o.id} className="border-t border-border py-2.5">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap justify-between gap-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {o.label || labelOf(OFFICE_KINDS, o.office_kind)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {[o.town, o.local_municipality, o.district_municipality, o.province].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span
                className={
                  "shrink-0 self-start rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap " +
                  (o.proof_type ? "border-success/20 bg-success/10 text-success" : "border-warning/20 bg-warning/10 text-warning")
                }
              >
                {o.proof_type
                  ? `${labelOf(OFFICE_PROOF_TYPES, o.proof_type)}${o.proof_date ? ` · ${new Date(o.proof_date).toLocaleDateString()}` : ""}`
                  : "No proof recorded"}
              </span>
            </div>
            <div className="mt-1 text-xs font-semibold text-accent">Edit</div>
          </summary>
          <form action={saveCompanyOffice} className="mt-2.5">
            <input type="hidden" name="office_id" value={o.id} />
            <OfficeFields office={o} />
            <Button type="submit" variant="accent" size="lg" className="mt-3 min-h-11 px-[18px]">
              Save office
            </Button>
          </form>
          <form action={deleteCompanyOffice} className="mt-2">
            <input type="hidden" name="office_id" value={o.id} />
            <Button type="submit" variant="destructive" size="sm" className="min-h-9">
              Remove office
            </Button>
          </form>
        </details>
      ))}

      {!error && (
        <details className={offices.length ? "border-t border-border pt-2.5" : ""} open={offices.length === 0}>
          <summary className="cursor-pointer py-1 text-sm font-semibold text-accent">+ Add an office</summary>
          <form action={saveCompanyOffice} className="mt-2.5">
            <OfficeFields office={null} />
            <Button type="submit" variant="accent" size="lg" className="mt-3 min-h-11 px-[18px]">
              Add office
            </Button>
          </form>
        </details>
      )}
    </VaultSection>
  );
}
