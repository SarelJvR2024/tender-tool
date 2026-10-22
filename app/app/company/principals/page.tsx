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
import { Area, Card, Chip, DangerButton, Disclosure, FileUpload, Select, SubPage, Submit, Text, YesNo, fmtDate, grid } from "../_components/ui";

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

  const { data: company, error: companyError } = await supabase.from("companies").select("id, legal_name, black_ownership_pct").single();
  const [{ data: rows, error: rowsError }, { data: breakdownRow }, { data: people }, { data: banks }] = await Promise.all([
    supabase.from("company_principals").select(PRINCIPAL_COLUMNS).order("ownership_pct", { ascending: false, nullsFirst: false }).order("full_name"),
    supabase.from("company_ownership_breakdown").select("*").maybeSingle(),
    supabase.from("people").select("id, name").order("name"),
    company ? supabase.rpc("bank_account_summaries", { p_company: company.id }) : Promise.resolve({ data: [] }),
  ]);
  if (companyError) console.error("companies select failed on principals page", companyError);
  if (rowsError) console.error("company_principals select failed", rowsError);
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
      {rowsError && (
        <div className="mb-3.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          Couldn&apos;t load the register - try refreshing. If it keeps happening, let us know.
        </div>
      )}

      <Card title="Ownership, worked out from the register">
        {!breakdown || !breakdown.shareholders ? (
          <div className="text-sm text-muted-foreground">No shareholdings recorded yet. Add shareholders below to see the split by group.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
              {BREAKDOWN_ROWS.map((r) => (
                <div key={r.key} className="rounded-lg border border-border px-2.5 py-2">
                  <div className="text-[11px] text-muted-foreground">{r.label}</div>
                  <div className="text-lg font-bold text-foreground">{Number(breakdown[r.key] ?? 0).toLocaleString("en-ZA", { maximumFractionDigits: 3 })} %</div>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              {breakdown.shareholders} shareholder{breakdown.shareholders === 1 ? "" : "s"}, {Number(breakdown.total_pct ?? 0)} % of the shares recorded.
              {Number(breakdown.unclassified_pct ?? 0) > 0 &&
                ` ${Number(breakdown.unclassified_pct)} % is held by a company/trust or by someone with no race or gender recorded, so it isn't counted in any group.`}
              {Number(breakdown.total_pct ?? 0) < 100 && " The shares don't add up to 100 % yet."} Youth is 18-35 today.
            </div>
            {stated !== null && derivedBlack !== null && Math.abs(Number(stated) - Number(derivedBlack)) > 0.01 && (
              <div className="mt-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Your Company profile says {Number(stated)} % black ownership; this register works out {Number(derivedBlack)} %. Check which one is
                right before a specific-goals claim - the B-BBEE certificate or affidavit is the evidence a buyer checks.
              </div>
            )}
          </>
        )}
      </Card>

      {(missingIds > 0 || missingConsent > 0) && principals.length > 0 && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          {missingIds > 0 && <Chip status={{ label: `${missingIds} director${missingIds === 1 ? "" : "s"} without a certified ID copy`, tone: "warning" }} />}
          {missingConsent > 0 && <Chip status={{ label: `${missingConsent} without a POPIA consent date`, tone: "warning" }} />}
        </div>
      )}

      {!rowsError && principals.length === 0 && (
        <div className="mb-3.5 rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          Nobody on the register yet. Add a director or shareholder below.
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-foreground">{p.full_name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {roleLabel}
            {p.position ? ` · ${p.position}` : ""}
            {p.executive === true ? " · executive" : p.executive === false ? " · non-executive" : ""}
            {p.ownership_pct !== null ? ` · ${Number(p.ownership_pct)} % of shares` : ""}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {natural
              ? `ID ${maskId(p.id_number) ?? (p.passport_number ? "— (passport on file)" : "not on file")}${age !== null ? ` · age ${age}` : ""}`
              : `Company / trust${p.entity_registration_number ? ` · reg. ${p.entity_registration_number}` : ""}`}
            {bank ? ` · bank account ${bank.bank_name} ••••${bank.last4}` : ""}
          </div>
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <Chip key={t} status={{ label: t, tone: "accent" }} />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {natural && p.role !== "shareholder" && <Chip status={cert} />}
          {natural && !p.popia_consent_on && <Chip status={{ label: "POPIA consent not recorded", tone: "warning" }} />}
        </div>
      </div>
      {warnings.map((w) => (
        <div key={w} className="mt-1.5 text-xs text-warning">
          {w}
        </div>
      ))}

      {natural && (
        <div className="mt-3 grid gap-2.5">
          <DocumentLine p={p} kind="certified_id" urls={urls} title="Certified ID copy" />
          {p.disability && <DocumentLine p={p} kind="disability_proof" urls={urls} title="Disability proof (medical certificate, practice number)" />}
        </div>
      )}

      <Disclosure summary="Edit details">
        <PrincipalForm p={p} people={people} />
        <form action={deletePrincipal} className="mt-3">
          <input type="hidden" name="principal_id" value={p.id} />
          <DangerButton confirmMessage={`Remove ${p.full_name} from the register? Their uploaded documents will also be removed. This can't be undone.`}>Remove {p.full_name} from the register</DangerButton>
        </form>
      </Disclosure>
    </Card>
  );
}

function DocumentLine({ p, kind, urls, title }: { p: PrincipalRow; kind: "certified_id" | "disability_proof"; urls: Record<string, string>; title: string }) {
  const path = kind === "certified_id" ? p.certified_id_path : p.disability_proof_path;
  const name = (kind === "certified_id" ? p.certified_id_filename : p.disability_proof_filename) ?? filenameFromPath(path);
  return (
    <div className="border-t border-border pt-2.5">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-0.5 text-xs">
        {path ? (
          urls[path] ? (
            <a href={urls[path]} target="_blank" rel="noopener noreferrer" className="font-semibold break-all text-accent no-underline">
              {name}
            </a>
          ) : (
            <span className="text-muted-foreground">{name}</span>
          )
        ) : (
          <span className="text-muted-foreground/70">No copy uploaded</span>
        )}
        {kind === "certified_id" && path && <span className="text-muted-foreground"> · certified {fmtDate(p.certified_id_on)}</span>}
      </div>
      <form action={uploadPrincipalDocument} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="principal_id" value={p.id} />
        <input type="hidden" name="kind" value={kind} />
        <FileUpload label={`Upload ${title} for ${p.full_name}`} />
        {kind === "certified_id" && (
          <div className="min-w-[170px]">
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
      <div className={grid}>
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
      <div className="mt-3.5 mb-2 text-xs font-semibold text-foreground">For a person</div>
      <div className={grid}>
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
      <div className="mt-3.5 mb-2 text-xs font-semibold text-foreground">For a company or trust shareholder</div>
      <div className={grid}>
        {p?.id_number && (
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input type="checkbox" name="clear_id_number" value="1" className="size-4" /> Remove the ID number on file
          </label>
        )}
        <Text name="entity_registration_number" label="Registration / trust number" defaultValue={p?.entity_registration_number} />
      </div>
      <div className={`${grid} mt-3`}>
        <Text name="popia_consent_on" label="Consent to use their details for tenders, given on" type="date" defaultValue={p?.popia_consent_on} />
        <Area name="notes" label="Notes" defaultValue={p?.notes} />
      </div>
      <div className="my-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Race and disability are special personal information under POPIA. Record them only to claim B-BBEE / specific-goals ownership,
        and only with the person&apos;s consent.
      </div>
      <Submit>{p ? "Save changes" : "Add to the register"}</Submit>
    </form>
  );
}
