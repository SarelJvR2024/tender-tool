import { createClient } from "@/lib/supabase/server";
import { expiryStatus } from "@/lib/dates";
import { PROVINCES } from "@/lib/locality";
import { filenameFromPath, VAULT_BUCKET } from "@/lib/vaultDocuments";
import {
  OWNERSHIP_BASES,
  PROPERTY_COLUMNS,
  PROPERTY_DOCUMENT_COLUMNS,
  PROPERTY_DOCUMENT_TYPES,
  SAPOA_GRADES,
  tooOld,
  type PropertyDocumentRow,
  type PropertyRow,
} from "@/lib/properties";
import { deleteProperty, savePropertyDocument, saveProperty } from "./actions";
import { Area, Card, Chip, DangerButton, Disclosure, Select, SubPage, Submit, Text, YesNo, fmtDate, grid } from "../_components/ui";

export const instant = false;

const SAVED: Record<string, string> = {
  "1": "Building saved.",
  doc: "Document saved.",
  removed: "Building removed, with its documents.",
};

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const [{ data: propRows, error: propsError }, { data: docRows, error: docsError }] = await Promise.all([
    supabase.from("company_properties").select(PROPERTY_COLUMNS).order("label"),
    supabase.from("property_documents").select(PROPERTY_DOCUMENT_COLUMNS),
  ]);
  if (propsError) console.error("company_properties select failed", propsError);
  if (docsError) console.error("property_documents select failed", docsError);
  const loadError = propsError || docsError;
  const properties = (propRows ?? []) as PropertyRow[];
  const docs = (docRows ?? []) as PropertyDocumentRow[];

  const urls: Record<string, string> = {};
  const paths = docs.map((d) => d.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(VAULT_BUCKET).createSignedUrls(paths, 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }

  return (
    <SubPage
      title="Buildings you lease to government"
      intro={
        <>
          For lease tenders (&quot;supply of office accommodation&quot;), the buyer evaluates the building, not just the company:
          title deed, size, parking, SAPOA grade and the building&apos;s compliance certificates. Record each building once here.
          Rent, escalation and lease period are priced per tender, so they go in that tender&apos;s pricing schedule, not here. Only
          needed if your company offers property.
        </>
      }
      error={error}
      saved={saved ? SAVED[saved] ?? null : null}
    >
      {loadError && (
        <div className="mb-3.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          Couldn&apos;t load your buildings - try refreshing. If it keeps happening, let us know.
        </div>
      )}
      {!loadError && properties.length === 0 && (
        <div className="mb-3.5 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No buildings on file yet. Add one below if your company offers property to a buyer.
        </div>
      )}
      {properties.map((p) => (
        <PropertyCard key={p.id} p={p} docs={docs.filter((d) => d.property_id === p.id)} urls={urls} />
      ))}
      <Card title={properties.length ? "Add another building" : "Add a building"} id="add">
        <PropertyForm />
      </Card>
    </SubPage>
  );
}

function PropertyCard({ p, docs, urls }: { p: PropertyRow; docs: PropertyDocumentRow[]; urls: Record<string, string> }) {
  const basis = OWNERSHIP_BASES.find((b) => b.value === p.ownership_basis)?.label;
  const types = PROPERTY_DOCUMENT_TYPES.filter((t) => !t.basis || t.basis === p.ownership_basis || docs.some((d) => d.document_type === t.key));
  const have = types.filter((t) => docs.some((d) => d.document_type === t.key && d.storage_path)).length;
  return (
    <Card id={`prop-${p.id}`}>
      <div className="text-[15px] font-bold text-foreground">{p.label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
        {[p.physical_address, p.erf_number, p.town, p.local_municipality, p.province].filter(Boolean).join(" · ") || "Address not recorded"}
        <br />
        {p.gross_lettable_area_m2 !== null ? `${Number(p.gross_lettable_area_m2).toLocaleString("en-ZA")} m² lettable` : "Area not recorded"}
        {` · parking ${p.parking_bays_covered ?? "—"} covered / ${p.parking_bays_open ?? "—"} open`}
        {p.sapoa_grade ? ` · SAPOA grade ${p.sapoa_grade}` : ""}
        {p.ground_floor_space ? " · ground floor" : ""}
        {p.wheelchair_accessible ? " · wheelchair accessible" : ""}
        <br />
        {basis ?? "Ownership basis not recorded"}
        {p.registered_owner ? ` · registered owner ${p.registered_owner}` : ""}
        {p.title_deed_number ? ` · title deed ${p.title_deed_number}` : ""}
      </div>
      <div className="mt-3 mb-1 text-xs font-semibold text-foreground">
        Building documents - {have} of {types.length} on file
      </div>
      {types.map((t) => {
        const d = docs.find((x) => x.document_type === t.key);
        const status = !d?.storage_path
          ? { label: "Not on file", bg: "#ECEEF1", color: "#5B6472" }
          : d.valid_until
            ? expiryStatus(d.valid_until)
            : { label: "On file", bg: "#DCFCE7", color: "#15803D" };
        const old = d ? tooOld(d) : null;
        const name = d?.original_filename ?? filenameFromPath(d?.storage_path ?? null);
        return (
          <div key={t.key} className="border-t border-border py-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{t.label}</div>
                <div className="text-[11px] text-muted-foreground">Asked for by {t.askedBy}</div>
                {d && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {d.reference_number ? `No. ${d.reference_number} · ` : ""}
                    {d.issued_on ? `issued ${fmtDate(d.issued_on)}` : "issue date not recorded"}
                    {d.valid_until ? ` · valid until ${fmtDate(d.valid_until)}` : ""}
                    {d.storage_path && (
                      <>
                        {" · "}
                        {urls[d.storage_path] ? (
                          <a href={urls[d.storage_path]} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-accent no-underline">
                            {name}
                          </a>
                        ) : (
                          name
                        )}
                      </>
                    )}
                  </div>
                )}
                {old && <div className="mt-0.5 text-xs text-destructive">{old}</div>}
              </div>
              <Chip status={status} />
            </div>
            <Disclosure summary={d ? "Update" : "Add"}>
              <form action={savePropertyDocument}>
                <input type="hidden" name="property_id" value={p.id} />
                <input type="hidden" name="document_type" value={t.key} />
                <div className={grid}>
                  <Text name="reference_number" label="Reference / certificate number" defaultValue={d?.reference_number} />
                  <Text name="issued_on" label="Issued on" type="date" defaultValue={d?.issued_on} />
                  <Text name="valid_until" label="Valid until (if it has one)" type="date" defaultValue={d?.valid_until} />
                </div>
                <div className="my-2.5">
                  <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" aria-label={`${t.label} copy`} className="max-w-full text-xs text-foreground" />
                </div>
                <Submit secondary>Save</Submit>
              </form>
            </Disclosure>
          </div>
        );
      })}
      <Disclosure summary="Edit building details">
        <PropertyForm p={p} />
        <form action={deleteProperty} className="mt-2.5">
          <input type="hidden" name="property_id" value={p.id} />
          <DangerButton confirmMessage="Remove this building? This can't be undone.">Remove this building</DangerButton>
        </form>
      </Disclosure>
    </Card>
  );
}

function PropertyForm({ p }: { p?: PropertyRow }) {
  return (
    <form action={saveProperty}>
      {p && <input type="hidden" name="property_id" value={p.id} />}
      <div className={grid}>
        <Text name="label" label="Building name" defaultValue={p?.label} required />
        <Text name="physical_address" label="Physical address" defaultValue={p?.physical_address} />
        <Text name="erf_number" label="Erf / stand number" defaultValue={p?.erf_number} />
        <Text name="town" label="Town" defaultValue={p?.town} />
        <Text name="local_municipality" label="Local municipality" defaultValue={p?.local_municipality} />
        <Select name="province" label="Province" defaultValue={p?.province} options={[{ value: "", label: "Not recorded" }, ...PROVINCES.map((x) => ({ value: x, label: x }))]} />
        <Select
          name="ownership_basis"
          label="You offer it as"
          defaultValue={p?.ownership_basis}
          options={[{ value: "", label: "Not recorded" }, ...OWNERSHIP_BASES.map((b) => ({ value: b.value, label: b.label }))]}
        />
        <Text name="registered_owner" label="Registered owner (as on the title deed)" defaultValue={p?.registered_owner} />
        <Text name="title_deed_number" label="Title deed number" defaultValue={p?.title_deed_number} />
        <Text name="gross_lettable_area_m2" label="Lettable area (m², SAPOA method)" type="number" inputMode="decimal" defaultValue={p?.gross_lettable_area_m2} />
        <Text name="parking_bays_covered" label="Covered parking bays" type="number" inputMode="numeric" defaultValue={p?.parking_bays_covered} />
        <Text name="parking_bays_open" label="Open parking bays" type="number" inputMode="numeric" defaultValue={p?.parking_bays_open} />
        <Select name="sapoa_grade" label="SAPOA grade" defaultValue={p?.sapoa_grade} options={[{ value: "", label: "Not graded" }, ...SAPOA_GRADES.map((g) => ({ value: g, label: `Grade ${g}` }))]} />
        <YesNo name="ground_floor_space" label="Space on the ground floor?" value={p?.ground_floor_space} />
        <YesNo name="wheelchair_accessible" label="Wheelchair accessible (ramp, ablutions)?" value={p?.wheelchair_accessible} />
        <Area name="notes" label="Notes" defaultValue={p?.notes} />
      </div>
      <div className="mt-3">
        <Submit>{p ? "Save changes" : "Add building"}</Submit>
      </div>
    </form>
  );
}
