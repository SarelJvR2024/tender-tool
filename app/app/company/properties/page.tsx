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
import { AMBER, Area, BORDER, Card, Chip, DangerButton, Disclosure, FAINT, MUTED, NAVY, Select, SubPage, Submit, Text, YesNo, fmtDate, grid } from "../_components/ui";

export const instant = false;

const SAVED: Record<string, string> = {
  "1": "Building saved.",
  doc: "Document saved.",
  removed: "Building removed, with its documents.",
};

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const [{ data: propRows }, { data: docRows }] = await Promise.all([
    supabase.from("company_properties").select(PROPERTY_COLUMNS).order("label"),
    supabase.from("property_documents").select(PROPERTY_DOCUMENT_COLUMNS),
  ]);
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
      <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{p.label}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.5 }}>
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
      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, margin: "12px 0 4px" }}>
        Building documents - {have} of {types.length} on file
      </div>
      {types.map((t) => {
        const d = docs.find((x) => x.document_type === t.key);
        const status = !d?.storage_path
          ? { label: "Not on file", bg: "#F0EEE6", color: "#6B6758" }
          : d.valid_until
            ? expiryStatus(d.valid_until)
            : { label: "On file", bg: "#DCFCE7", color: "#15803D" };
        const old = d ? tooOld(d) : null;
        const name = d?.original_filename ?? filenameFromPath(d?.storage_path ?? null);
        return (
          <div key={t.key} style={{ borderTop: `1px solid ${BORDER}`, padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{t.label}</div>
                <div style={{ fontSize: 11, color: FAINT }}>Asked for by {t.askedBy}</div>
                {d && (
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
                    {d.reference_number ? `No. ${d.reference_number} · ` : ""}
                    {d.issued_on ? `issued ${fmtDate(d.issued_on)}` : "issue date not recorded"}
                    {d.valid_until ? ` · valid until ${fmtDate(d.valid_until)}` : ""}
                    {d.storage_path && (
                      <>
                        {" · "}
                        {urls[d.storage_path] ? (
                          <a href={urls[d.storage_path]} target="_blank" rel="noopener noreferrer" style={{ color: AMBER, fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
                            {name}
                          </a>
                        ) : (
                          name
                        )}
                      </>
                    )}
                  </div>
                )}
                {old && <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 2 }}>{old}</div>}
              </div>
              <Chip status={status} />
            </div>
            <Disclosure summary={d ? "Update" : "Add"}>
              <form action={savePropertyDocument}>
                <input type="hidden" name="property_id" value={p.id} />
                <input type="hidden" name="document_type" value={t.key} />
                <div style={grid}>
                  <Text name="reference_number" label="Reference / certificate number" defaultValue={d?.reference_number} />
                  <Text name="issued_on" label="Issued on" type="date" defaultValue={d?.issued_on} />
                  <Text name="valid_until" label="Valid until (if it has one)" type="date" defaultValue={d?.valid_until} />
                </div>
                <div style={{ margin: "10px 0" }}>
                  <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" aria-label={`${t.label} copy`} style={{ fontSize: 12, color: NAVY, maxWidth: "100%" }} />
                </div>
                <Submit secondary>Save</Submit>
              </form>
            </Disclosure>
          </div>
        );
      })}
      <Disclosure summary="Edit building details">
        <PropertyForm p={p} />
        <form action={deleteProperty} style={{ marginTop: 10 }}>
          <input type="hidden" name="property_id" value={p.id} />
          <DangerButton>Remove this building</DangerButton>
        </form>
      </Disclosure>
    </Card>
  );
}

function PropertyForm({ p }: { p?: PropertyRow }) {
  return (
    <form action={saveProperty}>
      {p && <input type="hidden" name="property_id" value={p.id} />}
      <div style={grid}>
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
      <div style={{ marginTop: 12 }}>
        <Submit>{p ? "Save changes" : "Add building"}</Submit>
      </div>
    </form>
  );
}
