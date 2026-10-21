import { VaultSection } from "./shared";

export function RegisterLinks({ counts }: { counts: { principals: number; registrations: number; properties: number } }) {
  const items = [
    {
      href: "/company/principals",
      title: "Directors & shareholders",
      detail: counts.principals
        ? `${counts.principals} on the register - IDs, ownership by group, certified ID copies`
        : "Not started - tenders ask for every director's certified ID and the ownership split",
    },
    {
      href: "/company/registrations",
      title: "Registrations, licences & accreditations",
      detail: counts.registrations
        ? `${counts.registrations} held by the company or its people - PSIRA, SETA, permits, councils`
        : "PSIRA, SETA accreditation, waste permits, HPCSA, SACAP ... - with expiry reminders",
    },
    { href: "/company/bank-accounts", title: "Bank accounts", detail: "Restricted - owners and admins only" },
    { href: "/company/team", title: "Team", detail: "Add teammates, assign roles, invite someone as a restricted employee" },
    { href: "/company/document-scan", title: "Bulk document scan", detail: "Drop in a folder of compliance documents - AI sorts and pre-fills them, you confirm each one" },
    {
      href: "/company/properties",
      title: "Buildings you lease to government",
      detail: counts.properties ? `${counts.properties} building${counts.properties === 1 ? "" : "s"} on file` : "Only for lease / office-accommodation tenders",
    },
  ];
  return (
    <VaultSection id="registers" title="Directors, registrations & property">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {items.map((i) => (
          <a
            key={i.href}
            href={i.href}
            className="block min-h-11 rounded-lg border border-border px-3 py-2.5 no-underline hover:bg-muted/50"
          >
            <div className="text-sm font-semibold text-foreground">{i.title} →</div>
            <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{i.detail}</div>
          </a>
        ))}
      </div>
    </VaultSection>
  );
}
