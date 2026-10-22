import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { PERSON_CREDENTIAL_COLUMNS, credentialChipLabel, credentialExpiries, type PersonCredentialFields } from "@/lib/personCredentials";
import { PageHeader } from "@/components/tt/page-header";
import { EmptyState } from "@/components/tt/empty-state";
import { buttonVariants } from "@/components/ui/button";

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

type Tone = "success" | "warning" | "destructive" | "muted";
const TONE_CLASS: Record<Tone, string> = {
  success: "border-success/20 bg-success/10 text-success",
  warning: "border-warning/20 bg-warning/10 text-warning",
  destructive: "border-destructive/20 bg-destructive/10 text-destructive",
  muted: "border-muted-foreground/20 bg-muted text-muted-foreground",
};

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

// ECSA/SACPCMP registration-health chips - the same 4-state expiry
// vocabulary as the rest of the vault (lib/documentExpiry.ts), deliberately
// NOT forced into Verify/Provide/Fix (app/AGENTS.md argues for this
// pattern elsewhere; these are a renewal-date state, not a bid task).
function registrationSummary(p: PersonRow): { label: string; tone: Tone }[] {
  const tags: { label: string; tone: Tone }[] = [];
  if (p.ecsa_level) {
    tags.push({ label: `ECSA: ${p.ecsa_level}`, tone: "success" });
  } else {
    tags.push({ label: "No ECSA on file", tone: "warning" });
  }
  if (p.sacpcmp_number) {
    tags.push({ label: "SACPCMP registered", tone: "success" });
  }
  // Registration expiry badges (0035), same colours and 60-day threshold as
  // the Document Vault's expiry badges (app/lib/dates.ts expiryStatus).
  for (const c of credentialExpiries(p)) {
    // credentialExpiries()'s status only ever carries the 4-value subset Tone covers here (never "accent").
    tags.push({ label: credentialChipLabel(c), tone: c.status.tone as Tone });
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

  if (error) console.error("people select failed", error);

  const rows = (people ?? []) as PersonRow[];

  // At-a-glance registration health, same idea as the Document Vault's chip row.
  const allExpiries = rows.flatMap((p) => credentialExpiries(p));
  const expiredCount = allExpiries.filter((c) => c.status.label === "Expired").length;
  const renewSoonCount = allExpiries.filter((c) => c.status.label === "Renew soon").length;
  const noDateCount = allExpiries.filter((c) => !c.expiry).length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[900px] flex-1 px-4 py-6">
        <PageHeader
          className="mb-4"
          title="People / CV Library"
          description="Staff on file for key-position matching against SANRAL tenders."
          actions={
            <Link href="/people/new" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11" })}>
              + Add person
            </Link>
          }
        />

        {errorParam && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {decodeURIComponent(errorParam)}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Couldn&apos;t load people - try refreshing. If it keeps happening, let us know.
          </div>
        )}

        {!error && allExpiries.length > 0 && (
          <div className="mb-3.5 flex flex-wrap gap-1.5">
            {expiredCount > 0 && <Chip tone="destructive">{expiredCount} registration{expiredCount === 1 ? "" : "s"} expired</Chip>}
            {renewSoonCount > 0 && <Chip tone="warning">{renewSoonCount} renewing within 60 days</Chip>}
            {noDateCount > 0 && <Chip tone="muted">{noDateCount} without a renewal date</Chip>}
            {expiredCount === 0 && renewSoonCount === 0 && noDateCount === 0 && <Chip tone="success">Registrations current</Chip>}
          </div>
        )}

        {rows.length === 0 && !error && (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState
              icon={Users}
              title="No one on file yet"
              description="Add the first person to make them available for tender pack matching."
              action={
                <Link href="/people/new" className={buttonVariants({ variant: "accent", size: "lg", className: "min-h-11" })}>
                  + Add person
                </Link>
              }
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((p) => {
            const tags = registrationSummary(p);
            return (
              <Link
                key={p.id}
                href={`/people/${p.id}`}
                className="block min-h-11 rounded-xl border border-border bg-card px-4 py-3.5 no-underline transition-colors hover:bg-muted/30"
              >
                <div className="text-[15px] font-bold text-foreground">{p.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {p.role || p.description || "Role not set"}
                </div>
                {p.highest_description && (
                  <div className="mt-1 text-[11px] text-muted-foreground">{p.highest_description}</div>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Chip key={t.label} tone={t.tone}>{t.label}</Chip>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
