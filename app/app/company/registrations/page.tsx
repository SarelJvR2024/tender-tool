import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { expiryStatus } from "@/lib/dates";
import { filenameFromPath, VAULT_BUCKET } from "@/lib/vaultDocuments";
import {
  HELD_COLUMNS,
  KIND_LABELS,
  REGISTRATION_TYPE_COLUMNS,
  SCOPE_LABELS,
  storedInHint,
  type HeldRegistration,
  type RegistrationScope,
  type RegistrationType,
} from "@/lib/registrations";
import { addRegistrationType, deleteHeldRegistration, saveHeldRegistration } from "./actions";
import { AMBER, Area, BORDER, Card, Chip, DangerButton, Disclosure, FAINT, MUTED, NAVY, Select, SubPage, Submit, Text, fmtDate, grid } from "../_components/ui";

export const instant = false;

const SAVED: Record<string, string> = {
  "1": "Registration saved.",
  removed: "Registration removed.",
  type: "Registration type added to your list.",
};

type Holder = { value: string; label: string; kind: "company" | "person" };

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();

  const [{ data: typeRows }, { data: heldRows }, { data: people }, { data: principals }] = await Promise.all([
    supabase.from("registration_types").select(REGISTRATION_TYPE_COLUMNS).eq("active", true).order("sort_order").order("label"),
    supabase.from("held_registrations").select(HELD_COLUMNS).order("expiry_date", { ascending: true, nullsFirst: false }),
    supabase.from("people").select("id, name").order("name"),
    supabase.from("company_principals").select("id, full_name, holder_type, person_id").order("full_name"),
  ]);
  const types = (typeRows ?? []) as RegistrationType[];
  const typeById = new Map(types.map((t) => [t.id, t]));
  const held = (heldRows ?? []) as HeldRegistration[];

  const holders: Holder[] = [
    { value: "company", label: "The company", kind: "company" },
    ...((people ?? []) as { id: string; name: string }[]).map((p) => ({ value: `person:${p.id}`, label: `${p.name} (staff)`, kind: "person" as const })),
    // A director who is also one of the people holds registrations as that person.
    ...((principals ?? []) as { id: string; full_name: string; holder_type: string; person_id: string | null }[])
      .filter((p) => p.holder_type === "natural_person" && !p.person_id)
      .map((p) => ({ value: `principal:${p.id}`, label: `${p.full_name} (director / shareholder)`, kind: "person" as const })),
  ];
  const holderLabel = (h: HeldRegistration) =>
    h.person_id ? holders.find((x) => x.value === `person:${h.person_id}`)?.label : h.principal_id ? holders.find((x) => x.value === `principal:${h.principal_id}`)?.label : "The company";

  const urls: Record<string, string> = {};
  const paths = held.map((h) => h.storage_path).filter(Boolean) as string[];
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(VAULT_BUCKET).createSignedUrls(paths, 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }

  const companyHeld = held.filter((h) => !h.person_id && !h.principal_id);
  const personHeld = held.filter((h) => h.person_id || h.principal_id);
  const statuses = held.map((h) => (h.expiry_date ? expiryStatus(h.expiry_date) : null)).filter(Boolean);
  const expired = statuses.filter((s) => s!.label === "Expired").length;
  const soon = statuses.filter((s) => s!.label === "Renew soon").length;

  const selectable = types.filter((t) => !t.stored_in);
  const typeOptions = (["company", "both", "person"] as RegistrationScope[]).flatMap((scope) =>
    selectable.filter((t) => t.scope === scope).map((t) => ({ value: t.id, label: `${t.label} - ${SCOPE_LABELS[scope].toLowerCase()}` })),
  );

  return (
    <SubPage
      title="Registrations, licences & accreditations"
      intro={
        <>
          One list for every registration a tender can ask for - PSIRA, SETA accreditation, waste permits, HPCSA, SACAP and the
          rest. Each type is held by the company, by a person, or by either, and a company or person can hold several (two SETA
          accreditations, a PSIRA registration for the company and for a director). Expiry dates get the same reminders as the
          Document Vault.
        </>
      }
      error={error}
      saved={saved ? SAVED[saved] ?? null : null}
    >
      {(expired > 0 || soon > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {expired > 0 && <Chip status={{ label: `${expired} expired`, bg: "#FEE2E2", color: "#B91C1C" }} />}
          {soon > 0 && <Chip status={{ label: `${soon} renewing soon`, bg: "#FEF3C7", color: "#B45309" }} />}
        </div>
      )}

      <Card title="Held by the company">
        {companyHeld.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>None recorded yet.</div>
        ) : (
          companyHeld.map((h) => <HeldRow key={h.id} h={h} t={typeById.get(h.registration_type_id)} holder="The company" urls={urls} holders={holders} types={typeOptions} />)
        )}
      </Card>

      <Card title="Held by your people, directors and shareholders">
        {personHeld.length === 0 ? (
          <div style={{ fontSize: 13, color: MUTED }}>
            None recorded yet. ECSA, SACPCMP, SACNASP and SAGC stay on each person&apos;s own page (<Link href="/people" style={{ color: AMBER }}>People</Link>).
          </div>
        ) : (
          personHeld.map((h) => <HeldRow key={h.id} h={h} t={typeById.get(h.registration_type_id)} holder={holderLabel(h) ?? "—"} urls={urls} holders={holders} types={typeOptions} />)
        )}
      </Card>

      <Card title="Add a registration" id="add">
        <HeldForm holders={holders} types={typeOptions} />
      </Card>

      <Card title="The registration list" id="catalog">
        <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5, marginBottom: 8 }}>
          {types.filter((t) => !t.owner_company_id).length} types, each read from real tenders (the &quot;asked for by&quot; line). Tender Tool
          maintains this shared list; a type it doesn&apos;t have yet can be added for your company below.
        </div>
        <Disclosure summary="Show the full list">
          {(["company", "both", "person"] as RegistrationScope[]).map((scope) => (
            <div key={scope} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, margin: "6px 0" }}>{SCOPE_LABELS[scope]}</div>
              {types
                .filter((t) => t.scope === scope)
                .map((t) => {
                  const hint = storedInHint(t.stored_in);
                  return (
                    <div key={t.id} style={{ borderTop: "1px solid #F0EEE6", padding: "6px 0", fontSize: 12, color: MUTED }}>
                      <span style={{ color: NAVY, fontWeight: 600 }}>{t.label}</span>
                      {t.issuing_body ? ` · ${t.issuing_body}` : ""} · {KIND_LABELS[t.kind] ?? t.kind}
                      {t.owner_company_id ? " · added by your company" : ""}
                      {hint && (
                        <>
                          {" · "}
                          <a href={hint.href} style={{ color: AMBER }}>
                            {hint.text}
                          </a>
                        </>
                      )}
                      {t.asked_for_by && <div style={{ fontSize: 11, color: FAINT }}>Asked for by: {t.asked_for_by}</div>}
                    </div>
                  );
                })}
            </div>
          ))}
        </Disclosure>
        <Disclosure summary="Add a type that isn't on the list">
          <form action={addRegistrationType}>
            <div style={grid}>
              <Text name="label" label="Registration / licence name" required />
              <Text name="issuing_body" label="Issued by" />
              <Select
                name="scope"
                label="Held by"
                required
                options={[
                  { value: "", label: "Choose" },
                  { value: "company", label: SCOPE_LABELS.company },
                  { value: "person", label: SCOPE_LABELS.person },
                  { value: "both", label: SCOPE_LABELS.both },
                ]}
              />
              <Select name="kind" label="Kind" defaultValue="registration" options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))} />
              <Text name="asked_for_by" label="Which tender asked for it" />
            </div>
            <div style={{ marginTop: 12 }}>
              <Submit secondary>Add to my list</Submit>
            </div>
          </form>
        </Disclosure>
      </Card>
    </SubPage>
  );
}

function HeldRow({
  h,
  t,
  holder,
  urls,
  holders,
  types,
}: {
  h: HeldRegistration;
  t: RegistrationType | undefined;
  holder: string;
  urls: Record<string, string>;
  holders: Holder[];
  types: { value: string; label: string }[];
}) {
  const status = h.expiry_date ? expiryStatus(h.expiry_date) : { label: "Expiry not recorded", bg: "#F0EEE6", color: "#6B6758" };
  const name = h.original_filename ?? filenameFromPath(h.storage_path);
  return (
    <div id={`r-${h.id}`} style={{ borderTop: `1px solid ${BORDER}`, padding: "12px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{t?.label ?? "Registration"}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2, wordBreak: "break-word" }}>
            {holder}
            {h.registration_number ? ` · No. ${h.registration_number}` : ""}
            {h.category ? ` · ${h.category}` : ""}
            {h.issued_by ? ` · ${h.issued_by}` : ""}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {h.issued_on ? `Issued ${fmtDate(h.issued_on)} · ` : ""}Expires {fmtDate(h.expiry_date)}
            {h.certified_on ? ` · copy certified ${fmtDate(h.certified_on)}` : ""}
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {h.storage_path ? (
              urls[h.storage_path] ? (
                <a href={urls[h.storage_path]} target="_blank" rel="noopener noreferrer" style={{ color: AMBER, fontWeight: 600, textDecoration: "none", wordBreak: "break-all" }}>
                  {name}
                </a>
              ) : (
                <span style={{ color: MUTED }}>{name}</span>
              )
            ) : (
              <span style={{ color: "#C7C3B5" }}>No copy uploaded</span>
            )}
          </div>
        </div>
        <Chip status={status} />
      </div>
      <Disclosure summary="Edit">
        <HeldForm h={h} holders={holders} types={types} />
        <form action={deleteHeldRegistration} style={{ marginTop: 10 }}>
          <input type="hidden" name="held_id" value={h.id} />
          <DangerButton>Remove</DangerButton>
        </form>
      </Disclosure>
    </div>
  );
}

function HeldForm({ h, holders, types }: { h?: HeldRegistration; holders: Holder[]; types: { value: string; label: string }[] }) {
  const holderValue = h ? (h.person_id ? `person:${h.person_id}` : h.principal_id ? `principal:${h.principal_id}` : "company") : "company";
  return (
    <form action={saveHeldRegistration}>
      {h && <input type="hidden" name="held_id" value={h.id} />}
      <div style={grid}>
        <Select name="registration_type_id" label="Registration" defaultValue={h?.registration_type_id ?? ""} required options={[{ value: "", label: "Choose" }, ...types]} />
        <Select name="holder" label="Held by" defaultValue={holderValue} options={holders.map((x) => ({ value: x.value, label: x.label }))} />
        <Text name="registration_number" label="Registration / licence number" defaultValue={h?.registration_number} />
        <Text name="category" label="Grade / class / category (e.g. PSIRA Grade A, SAQA ID)" defaultValue={h?.category} />
        <Text name="issued_by" label="Issued by (which SETA, municipality ...)" defaultValue={h?.issued_by} />
        <Text name="issued_on" label="Issued on" type="date" defaultValue={h?.issued_on} />
        <Text name="expiry_date" label="Expires / renewal due" type="date" defaultValue={h?.expiry_date} />
        <Text name="certified_on" label="Copy certified on (if certified)" type="date" defaultValue={h?.certified_on} />
        <Area name="notes" label="Notes" defaultValue={h?.notes} />
      </div>
      <div style={{ margin: "12px 0" }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: NAVY, marginBottom: 5 }}>
          Certificate copy{h?.storage_path ? " (leave empty to keep the one on file)" : ""}
        </div>
        <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" aria-label="Certificate copy" style={{ fontSize: 12, color: NAVY, maxWidth: "100%" }} />
      </div>
      <Submit>{h ? "Save changes" : "Add registration"}</Submit>
    </form>
  );
}
