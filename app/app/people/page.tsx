import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../_components/SiteNav";
import { PERSON_CREDENTIAL_COLUMNS, credentialChipLabel, credentialExpiries, type PersonCredentialFields } from "@/lib/personCredentials";

// Reads the signed-in user's own company's roster on every request (via RLS) -
// can't be prerendered. Same Cache Components escape hatch as dashboard/page.tsx.
export const instant = false;

type PersonRow = PersonCredentialFields & {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  ecsa_level: string | null;
  ecsa_number: string | null;
  sacpcmp_number: string | null;
  ecsa_expiry: string | null; // 0035
  sacpcmp_expiry: string | null; // 0035
  highest_description: string | null;
};

function registrationSummary(p: PersonRow): { label: string; bg: string; color: string }[] {
  const tags: { label: string; bg: string; color: string }[] = [];
  if (p.ecsa_level) {
    tags.push({ label: `ECSA: ${p.ecsa_level}`, bg: "#DCFCE7", color: "#15803D" });
  } else {
    tags.push({ label: "No ECSA on file", bg: "#FEF3C7", color: "#B45309" });
  }
  if (p.sacpcmp_number) {
    tags.push({ label: "SACPCMP registered", bg: "#DCFCE7", color: "#15803D" });
  }
  // Registration expiry badges (0035), same colours and 60-day threshold as
  // the Document Vault's expiry badges (app/lib/dates.ts expiryStatus).
  for (const c of credentialExpiries(p)) {
    tags.push({ label: credentialChipLabel(c), bg: c.status.bg, color: c.status.color });
  }
  return tags;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: errorParam } = await searchParams;
  const supabase = await createClient();

  // Deliberately NOT selecting id_number here - this is a list/summary view, and
  // 0001_init_schema.sql's own comment on people.id_number says real PII never
  // belongs in one of those, same rule companies.director_id_number states.
  const { data: people, error } = await supabase
    .from("people")
    .select(`id, name, role, description, ${PERSON_CREDENTIAL_COLUMNS}, highest_description`)
    .order("name", { ascending: true });

  const rows = (people ?? []) as PersonRow[];

  // At-a-glance registration health, same idea as the Document Vault's chip row.
  const allExpiries = rows.flatMap((p) => credentialExpiries(p));
  const expiredCount = allExpiries.filter((c) => c.status.label === "Expired").length;
  const renewSoonCount = allExpiries.filter((c) => c.status.label === "Renew soon").length;
  const noDateCount = allExpiries.filter((c) => !c.expiry).length;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <style>{`
        @media (max-width: 600px) {
          .people-grid { grid-template-columns: 1fr !important; }
          .people-header-row { flex-direction: column; align-items: flex-start !important; gap: 10px !important; }
        }
      `}</style>

      <SiteNav active="people" />

      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div className="people-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: 0 }}>People / CV Library</h1>
            <div style={{ fontSize: 13, color: "#6B6758", marginTop: 2 }}>
              Staff on file for key-position matching against SANRAL tenders.
            </div>
          </div>
          <Link
            href="/people/new"
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              minHeight: 44, padding: "0 18px", borderRadius: 10, background: "#D97706",
              color: "#FFFFFF", fontWeight: 600, fontSize: 14, textDecoration: "none",
            }}
          >
            + Add person
          </Link>
        </div>

        {errorParam && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            {decodeURIComponent(errorParam)}
          </div>
        )}

        {error && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
            Could not load people: {error.message}
          </div>
        )}

        {allExpiries.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {expiredCount > 0 && <SummaryChip text={`${expiredCount} registration${expiredCount === 1 ? "" : "s"} expired`} bg="#FEE2E2" color="#B91C1C" />}
            {renewSoonCount > 0 && <SummaryChip text={`${renewSoonCount} renewing within 60 days`} bg="#FEF3C7" color="#B45309" />}
            {noDateCount > 0 && <SummaryChip text={`${noDateCount} without a renewal date`} bg="#F0EEE6" color="#6B6758" />}
            {expiredCount === 0 && renewSoonCount === 0 && noDateCount === 0 && <SummaryChip text="Registrations current" bg="#DCFCE7" color="#15803D" />}
          </div>
        )}

        {rows.length === 0 && !error && (
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "24px 18px", fontSize: 13, color: "#6B6758" }}>
            No one on file yet. Add the first person to make them available for tender pack matching.
          </div>
        )}

        <div className="people-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 12 }}>
          {rows.map((p) => {
            const tags = registrationSummary(p);
            return (
              <Link
                key={p.id}
                href={`/people/${p.id}`}
                style={{
                  display: "block", background: "#FFFFFF", border: "1px solid #E5E1D5",
                  borderRadius: 11, padding: "14px 16px", textDecoration: "none", minHeight: 44,
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>
                  {p.role || p.description || "Role not set"}
                </div>
                {p.highest_description && (
                  <div style={{ fontSize: 11, color: "#9A9684", marginTop: 4 }}>{p.highest_description}</div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {tags.map((t) => (
                    <span
                      key={t.label}
                      style={{
                        display: "inline-flex", alignItems: "center", padding: "3px 10px",
                        borderRadius: 100, fontSize: 11, fontWeight: 600, background: t.bg, color: t.color,
                      }}
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ text, bg, color }: { text: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color }}>
      {text}
    </span>
  );
}
