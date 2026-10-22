import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { ManualTenderForm } from "./manual-tender-form";

// Reads the signed-in user's company on every request - can't be prerendered
// (same escape hatch as the other app pages).
export const instant = false;

/**
 * Load a tender by hand (migration 0024): for a tender found some other way -
 * SANRAL's own portal, one a client forwarded, a buyer not on eTenders. The
 * documents go through the same intake every discovered tender gets
 * (engine/general/process_general_jobs.py): SANRAL-template detection
 * (engine/fingerprint.py) decides SANRAL pack vs. general flow, the
 * requirements are read from the documents, and fit + score outlook
 * (assess_tender.py / score_outlook.py) are worked out for your company.
 */
export default async function NewTenderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");

  return (
    <AppShell>
      <div className="mx-auto box-border w-full max-w-[760px] flex-1 px-4 py-5 font-sans">
        <Link href="/dashboard" className="text-xs font-semibold text-accent no-underline">← Tenders</Link>
        <h1 className="mt-2 mb-1 text-xl font-bold text-foreground">Load a tender manually</h1>
        <p className="mb-4 text-[13px] leading-normal text-muted-foreground">
          For a tender that didn&apos;t come in through Discovery - SANRAL&apos;s own portal, one a client forwarded, or a buyer that
          isn&apos;t on eTenders. Upload its documents and it gets the same analysis a discovered tender gets: whether it&apos;s a SANRAL
          template tender or a general one, what it requires, which forms can be filled for you, and how well it fits your company.
          Only your company can see a tender you load here.
        </p>
        <div className="rounded-xl border border-border bg-card px-5 py-[18px]">
          <ManualTenderForm companyId={membership.company_id as string} />
        </div>
        <p className="mt-3 text-xs leading-normal text-muted-foreground">
          The analysis runs on the Tender Ready worker (it needs Python and LibreOffice), so it takes a minute or two once the worker is
          running. The tender page shows its progress.
        </p>
      </div>
    </AppShell>
  );
}
