import { createClient } from "@/lib/supabase/server";
import { COMPANY_OFFICE_COLUMNS, OFFICE_KINDS, OFFICE_PROOF_TYPES, PROVINCES, type CompanyOffice } from "@/lib/locality";
import { deleteCompanyOffice, saveCompanyOffice } from "./officeActions";

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
 */

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px", borderRadius: 8,
  border: "1px solid #E3E6EA", fontSize: 14, fontFamily: "inherit", color: "#16233B", background: "#FFFFFF",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: "#16233B", marginBottom: 5 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };

function labelOf(list: readonly { value: string; label: string }[], v: string | null) {
  return v ? list.find((x) => x.value === v)?.label ?? v : null;
}

function OfficeFields({ office }: { office: CompanyOffice | null }) {
  return (
    <div style={grid}>
      <div>
        <label style={lbl}>Province *</label>
        <select name="province" required defaultValue={office?.province ?? ""} style={input}>
          <option value="" disabled>Choose…</option>
          {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>District / metro municipality</label>
        <input name="district_municipality" defaultValue={office?.district_municipality ?? ""} placeholder="e.g. City of Ekurhuleni" style={input} />
      </div>
      <div>
        <label style={lbl}>Local municipality</label>
        <input name="local_municipality" defaultValue={office?.local_municipality ?? ""} placeholder="e.g. Stellenbosch" style={input} />
      </div>
      <div>
        <label style={lbl}>Town</label>
        <input name="town" defaultValue={office?.town ?? ""} style={input} />
      </div>
      <div>
        <label style={lbl}>Office type</label>
        <select name="office_kind" defaultValue={office?.office_kind ?? "branch"} style={input}>
          {OFFICE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Label</label>
        <input name="label" defaultValue={office?.label ?? ""} placeholder="e.g. Head office" style={input} />
      </div>
      <div>
        <label style={lbl}>Proof of address held</label>
        <select name="proof_type" defaultValue={office?.proof_type ?? ""} style={input}>
          <option value="">Not recorded</option>
          {OFFICE_PROOF_TYPES.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Date on the proof</label>
        <input type="date" name="proof_date" defaultValue={office?.proof_date ?? ""} style={input} />
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <label style={lbl}>Street address</label>
        <input name="street_address" defaultValue={office?.street_address ?? ""} style={input} />
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
    <div id="offices" style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, padding: "16px 18px", marginBottom: 14 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: "#8A93A0", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 6px" }}>Office locations</h2>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
        Some tenders award points (or require) an office in their province, district or municipality - e.g. &ldquo;Within
        Eastern Cape 4&rdquo;, &ldquo;within the boundaries of the Cape Winelands District&rdquo;. Add every office; any one
        can count. Buyers verify with a municipal account (usually under 3 months old), lease, bank letter or the CIPC
        registered address.
      </div>

      {error && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F5D08A", borderRadius: 9, padding: "9px 14px", marginBottom: 12, fontSize: 12, color: "#92400E" }}>
          Couldn&apos;t load office locations - try refreshing. If it keeps happening, let us know.
        </div>
      )}

      {!error && offices.length === 0 && (
        <div style={{ fontSize: 13, color: "#B45309", background: "#FEF3C7", borderRadius: 9, padding: "9px 14px", marginBottom: 12 }}>
          No office locations on file - locality points can&apos;t be checked on any tender.
        </div>
      )}

      {offices.map((o) => (
        <details key={o.id} style={{ borderTop: "1px solid #ECEEF1", padding: "10px 0" }}>
          <summary style={{ cursor: "pointer", listStyle: "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B" }}>
                  {o.label || labelOf(OFFICE_KINDS, o.office_kind)}
                </div>
                <div style={{ fontSize: 12, color: "#5B6472", marginTop: 2 }}>
                  {[o.town, o.local_municipality, o.district_municipality, o.province].filter(Boolean).join(" · ")}
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: o.proof_type ? "#15803D" : "#B45309", background: o.proof_type ? "#DCFCE7" : "#FEF3C7", borderRadius: 100, padding: "3px 10px", alignSelf: "flex-start", whiteSpace: "nowrap" }}>
                {o.proof_type
                  ? `${labelOf(OFFICE_PROOF_TYPES, o.proof_type)}${o.proof_date ? ` · ${new Date(o.proof_date).toLocaleDateString()}` : ""}`
                  : "No proof recorded"}
              </span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#D97706", marginTop: 4 }}>Edit</div>
          </summary>
          <form action={saveCompanyOffice} style={{ marginTop: 10 }}>
            <input type="hidden" name="office_id" value={o.id} />
            <OfficeFields office={o} />
            <button type="submit" style={{ marginTop: 12, minHeight: 44, padding: "0 18px", borderRadius: 9, background: "#16233B", color: "#FFFFFF", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}>
              Save office
            </button>
          </form>
          <form action={deleteCompanyOffice} style={{ marginTop: 8 }}>
            <input type="hidden" name="office_id" value={o.id} />
            <button type="submit" style={{ minHeight: 36, padding: "0 12px", borderRadius: 8, background: "#FEE2E2", color: "#B91C1C", fontSize: 12, fontWeight: 600, border: "1px solid #FCA5A5", cursor: "pointer" }}>
              Remove office
            </button>
          </form>
        </details>
      ))}

      {!error && (
        <details style={{ borderTop: offices.length ? "1px solid #ECEEF1" : "none", paddingTop: 10 }} open={offices.length === 0}>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#D97706", padding: "4px 0" }}>+ Add an office</summary>
          <form action={saveCompanyOffice} style={{ marginTop: 10 }}>
            <OfficeFields office={null} />
            <button type="submit" style={{ marginTop: 12, minHeight: 44, padding: "0 18px", borderRadius: 9, background: "#D97706", color: "#FFFFFF", fontSize: 14, fontWeight: 600, border: "none", cursor: "pointer" }}>
              Add office
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
