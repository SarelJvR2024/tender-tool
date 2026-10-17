import { createClient } from "@/lib/supabase/server";
import { filenameFromPath, VAULT_BUCKET } from "@/lib/vaultDocuments";
import {
  BREAKDOWN_ROWS,
  GENDERS,
  PRINCIPAL_COLUMNS,
  PRINCIPAL_ROLES,
  RACES,
  ageOn,
  certificationStatus,
  idWarnings,
  isBlack,
  maskId,
  parseSaId,
  type OwnershipBreakdown,
  type PrincipalRow,
} from "@/lib/principals";
import { deletePrincipal, savePrincipal, uploadPrincipalDocument } from "./actions";
import { AMBER, Area, BORDER, Card, Chip, DangerButton, Disclosure, FAINT, FileUpload, MUTED, NAVY, Select, SubPage, Submit, Text, YesNo, fmtDate, grid } from "../_components/ui";

// Request-time data under RLS (same reason as company/page.tsx).
export const instant = false;

const SAVED: Record<string, string> = {
  "1": "Register updated.",
  doc: "Document uploaded.",
  removed: "Person removed from the register, with their uploaded documents.",
};

export default async function PrincipalsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();

  const { data: company } = await supabase.from("companies").select("id, legal_name, black_ownership_pct").single();
  const [{ data: rows }, { data: breakdownRow }, { data: people }, { data: banks }] = await Promise.all([
    supabase.from("company_principals").select(PRINCIPAL_COLUMNS).order("ownership_pct", { ascending: false, nullsFirst: false }).order("full_name"),
    supabase.from("company_ownership_breakdown").select("*").maybeSingle(),
    supabase.from("people").select("id, name").order("name"),
    company ? supabase.rpc("bank_account_summaries", { p_company: company.id }) : Promise.resolve({ data: [] }),
  ]);
  const principals = (rows ?? []) as PrincipalRow[];
  const breakdown = breakdownRow as OwnershipBreakdown | null;
  const bankByPrincipal = new Map<string, { bank_name: string; last4: string }>();
  for (const b of (banks ?? []) as { principal_id: string | null; bank_name: string; last4: string }[]) {
    if (b.principal_id) bankByPrincipal.set(b.principal_id, b);
  }

  // 10-minute signed links to the uploaded copies (private bucket), as on the Company page.
  const urls: Record<string, string> = {};
  const paths = principals.flatMap((p) => [p.certified_id_path, p.disability_proof_path]).filter(Boolean) as string[];
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(VAULT_BUCKET).createSignedUrls(paths, 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }

  const directors = principals.filter((p) => p.role !== "shareholder");
  const missingIds = directors.filter((p) => p.holder_type === "natural_person" && !p.certified_id_path).length;
  const missingConsent = principals.filter((p) => p.holder_type === "natural_person" && !p.popia_consent_on).length;
  const stated = company?.black_ownership_pct ?? null;
  const derivedBlack = breakdown?.black_pct ?? null;

  return (
    <SubPage
      title="Directors & shareholders"
      intro={
        <>
          Everyone a tender asks about: directors, members, partners and shareholders, with their ID, ownership and certified
          ID copy. Ownership by group (black, women, youth, disability) is worked out from this list, not typed in twice. This is
          personal information: only members of your company can see it, ID numbers are masked in this list, and nothing here is put
          into a generated tender document.
        </>
      }
      error={error}
      saved={saved ? SAVED[saved] ?? null : null}
    >
      <Card title="Ownership, worked out from the register">
        {!breakdown || !breakdown.shareholders ? (
          <div style={{ fontSize: 13, color: MUTED }}>No shareholdings recorded yet. Add shareholders below to see the split by group.</div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              {BREAKDOWN_ROWS.map((r) => (
                <div key={r.key} style={{ border: `1px solid ${BORDER}`, borderRadius: 9, padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, color: FAINT }}>{r.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>{Number(breakdown[r.key] ?? 0).toLocaleString("en-ZA", { maximumFractionDigits: 3 })} %</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 10, lineHeight: 1.5 }}>
              {breakdown.shareholders} shareholder{breakdown.shareholders === 1 ? "" : "s"}, {Number(breakdown.total_pct ?? 0)} % of the shares recorded.
              {Number(breakdown.unclassified_pct ?? 0) > 0 &&
                ` ${Number(breakdown.unclassified_pct)} % is held by a company/trust or by someone with no race or gender recorded, so it isn't counted in any group.`}
              {Number(breakdown.total_pct ?? 0) < 100 && " The shares don't add up to 100 % yet."} Youth is 18-35 today.
            </div>
            {stated !== null && derivedBlack !== null && Math.abs(Number(stated) - Number(derivedBlack)) > 0.01 && (
              <div style={{ background: "#FEF3C7", border: "1px solid #FCD34D", borderRadius: 8, padding: "8px 12px", marginTop: 10, fontSize: 12, color: "#B45309" }}>
                Your Company profile says {Number(stated)} % black ownership; this register works out {Number(derivedBlack)} %. Check which one is
                right before a specific-goals claim - the B-BBEE certificate or affidavit is the evidence a buyer checks.
              </div>
            )}
          </>
        )}
      </Card>

      {(missingIds > 0 || missingConsent > 0) && principals.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {missingIds > 0 && <Chip status={{ label: `${missingIds} director${missingIds === 1 ? "" : "s"} without a certified ID copy`, bg: "#FEF3C7", color: "#B45309" }} />}
          {missingConsent > 0 && <Chip status={{ label: `${missingConsent} without a POPIA consent date`, bg: "#FEF3C7", color: "#B45309" }} />}
        </div>
      )}

      {principals.map((p) => (
        <PrincipalCard key={p.id} p={p} urls={urls} people={(people ?? []) as { id: string; name: string }[]} bank={bankByPrincipal.get(p.id)} />
      ))}

      <Card title="Add a director or shareholder" id="add">
        <PrincipalForm people={(people ?? []) as { id: string; name: string }[]} />
      </Card>
    </SubPage>
  );
}

function PrincipalCard({
  p,
  urls,
  people,
  bank,
}: {
  p: PrincipalRow;
  urls: Record<string, string>;
  people: { id: string; name: string }[];
  bank?: { bank_name: string; last4: string };
}) {
  const natural = p.holder_type === "natural_person";
  const parsed = parseSaId(p.id_number);
  const age = ageOn(p.date_of_birth ?? parsed.birth);
  const tags: string[] = [];
  if (natural) {
    if (isBlack(p.race)) tags.push("Black");
    if (p.gender === "female") tags.push("Woman");
    if (age !== null && age >= 18 && age <= 35) tags.push("Youth");
    if (p.disability) tags.push("Disability");
    if (p.military_veteran) tags.push("Military veteran");
  }
  const warnings = natural ? idWarnings(p) : [];
  const cert = certificationStatus(p.certified_id_on, !!p.certified_id_path);
  const roleLabel = PRINCIPAL_ROLES.find((r) => r.value === p.role)?.label ?? p.role;

  return (
    <Card id={`p-${p.id}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{p.full_name}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {roleLabel}
            {p.position ? ` · ${p.position}` : ""}
            {p.executive === true ? " · executive" : p.executive === false ? " · non-executive" : ""}
            {p.ownership_pct !== null ? ` · ${Number(p.ownership_pct)} % of shares` : ""}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {natural
              ? `ID ${maskId(p.id_number) ?? (p.passport_number ? "— (passport on file)" : "not on file")}${age !== null ? ` · age ${age}` : ""}`
              : `Company / trust${p.entity_registration_number ? ` · reg. ${p.entity_registration_number}` : ""}`}
            {bank ? ` · bank account ${bank.bank_name} ••••${bank.last4}` : ""}
          </div>
          {tags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {tags.map((t) => (
                <Chip key={t} status={{ label: t, bg: "#E0E7FF", color: NAVY }} />
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          {natural && p.role !== "shareholder" && <Chip status={cert} />}
          {natural && !p.popia_consent_on && <Chip status={{ label: "POPIA consent not recorded", bg: "#FEF3C7", color: "#B45309" }} />}
        </div>
      </div>
      {warnings.map((w) => (
        <div key={w} style={{ fontSize: 12, color: "#B45309", marginTop: 6 }}>
          {w}
        </div>
      ))}

      {natural && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <DocumentLine p={p} kind="certified_id" urls={urls} title="Certified ID copy" />
          {p.disability && <DocumentLine p={p} kind="disability_proof" urls={urls} title="Disability proof (medical certificate, practice number)" />}
        </div>
      )}

      <Disclosure summary="Edit details">
        <PrincipalForm p={p} people={people} />
        <form action={deletePrincipal} style={{ marginTop: 12 }}>
          <input type="hidden" name="principal_id" value={p.id} />
          <DangerButton>Remove {p.full_name} from the register</DangerButton>
        </form>
      </Disclosure>
    </Card>
  );
}

function DocumentLine({ p, kind, urls, title }: { p: PrincipalRow; kind: "certified_id" | "disability_proof"; urls: Record<string, string>; title: string }) {
  const path = kind === "certified_id" ? p.certified_id_path : p.disability_proof_path;
  const name = (kind === "certified_id" ? p.certified_id_filename : p.disability_proof_filename) ?? filenameFromPath(path);
  return (
    <div style={{ borderTop: "1px solid #F0EEE6", paddingTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{title}</div>
      <div style={{ fontSize: 12, marginTop: 2 }}>
        {path ? (
          urls[path] ? (
            <a href={urls[path]} target="_blank" rel="noopener noreferrer" style={{ color: AMBER, fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
              {name}
            </a>
          ) : (
            <span style={{ color: MUTED }}>{name}</span>
          )
        ) : (
          <span style={{ color: "#C7C3B5" }}>No copy uploaded</span>
        )}
        {kind === "certified_id" && path && <span style={{ color: MUTED }}> · certified {fmtDate(p.certified_id_on)}</span>}
      </div>
      <form action={uploadPrincipalDocument} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8 }}>
        <input type="hidden" name="principal_id" value={p.id} />
        <input type="hidden" name="kind" value={kind} />
        <FileUpload label={`Upload ${title} for ${p.full_name}`} />
        {kind === "certified_id" && (
          <div style={{ minWidth: 170 }}>
            <Text name="certified_id_on" label="Date certified (commissioner's stamp)" type="date" defaultValue={null} required />
          </div>
        )}
        <Submit secondary>{path ? "Replace" : "Upload"}</Submit>
      </form>
    </div>
  );
}

function PrincipalForm({ p, people }: { p?: PrincipalRow; people: { id: string; name: string }[] }) {
  return (
    <form action={savePrincipal}>
      {p && <input type="hidden" name="principal_id" value={p.id} />}
      <div style={grid}>
        <Text name="full_name" label="Full name (as on CIPC)" defaultValue={p?.full_name} required />
        <Select name="role" label="Role" defaultValue={p?.role ?? "both"} options={PRINCIPAL_ROLES.map((r) => ({ value: r.value, label: r.label }))} required />
        <Select
          name="holder_type"
          label="Shareholder is a"
          defaultValue={p?.holder_type ?? "natural_person"}
          options={[
            { value: "natural_person", label: "Person" },
            { value: "juristic_person", label: "Company or trust" },
          ]}
        />
        <Text name="ownership_pct" label="Shareholding %" type="number" inputMode="decimal" defaultValue={p?.ownership_pct} />
        <Text name="position" label="Position (e.g. Managing Director, Member)" defaultValue={p?.position} />
        <YesNo name="executive" label="Executive?" value={p?.executive} />
        <Text name="appointed_on" label="Appointed on" type="date" defaultValue={p?.appointed_on} />
        <Select
          name="person_id"
          label="Also one of your people (CV)?"
          defaultValue={p?.person_id ?? ""}
          options={[{ value: "", label: "No" }, ...people.map((x) => ({ value: x.id, label: x.name }))]}
        />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, margin: "14px 0 8px" }}>For a person</div>
      <div style={grid}>
        {/* The full ID number is never sent back to the browser once saved:
            the field starts empty and an empty field keeps the one on file. */}
        <Text
          name="id_number"
          label={p?.id_number ? `SA ID number (on file ${maskId(p.id_number)} - leave empty to keep)` : "SA ID number"}
          defaultValue={null}
          inputMode="numeric"
        />
        <Text name="passport_number" label="Passport number (if no SA ID)" defaultValue={p?.passport_number} />
        <Text name="nationality" label="Nationality" defaultValue={p?.nationality} />
        <YesNo name="sa_citizen" label="SA citizen?" value={p?.sa_citizen} />
        <Text name="date_of_birth" label="Date of birth (only without an SA ID)" type="date" defaultValue={p?.date_of_birth} />
        <Select name="gender" label="Gender" defaultValue={p?.gender} options={[{ value: "", label: "Not recorded" }, ...GENDERS.map((g) => ({ value: g.value, label: g.label }))]} />
        <Select name="race" label="Race group (B-BBEE)" defaultValue={p?.race} options={[{ value: "", label: "Not recorded" }, ...RACES.map((r) => ({ value: r.value, label: r.label }))]} />
        <YesNo name="disability" label="Person with a disability?" value={p?.disability} />
        <YesNo name="military_veteran" label="Military veteran?" value={p?.military_veteran} />
        <Text name="certified_id_on" label="Certified ID copy - date certified" type="date" defaultValue={p?.certified_id_on} />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: NAVY, margin: "14px 0 8px" }}>For a company or trust shareholder</div>
      <div style={grid}>
        {p?.id_number && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: NAVY }}>
            <input type="checkbox" name="clear_id_number" value="1" /> Remove the ID number on file
          </label>
        )}
        <Text name="entity_registration_number" label="Registration / trust number" defaultValue={p?.entity_registration_number} />
      </div>
      <div style={{ ...grid, marginTop: 12 }}>
        <Text name="popia_consent_on" label="Consent to use their details for tenders, given on" type="date" defaultValue={p?.popia_consent_on} />
        <Area name="notes" label="Notes" defaultValue={p?.notes} />
      </div>
      <div style={{ fontSize: 11, color: FAINT, margin: "10px 0 12px", lineHeight: 1.5 }}>
        Race and disability are special personal information under POPIA. Record them only to claim B-BBEE / specific-goals ownership,
        and only with the person&apos;s consent.
      </div>
      <Submit>{p ? "Save changes" : "Add to the register"}</Submit>
    </form>
  );
}
