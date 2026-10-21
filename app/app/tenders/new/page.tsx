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
      <div style={{ flex: 1, padding: "20px 16px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box", fontFamily: "system-ui, sans-serif" }}>
        <Link href="/dashboard" style={{ fontSize: 12, color: "#D97706", fontWeight: 600, textDecoration: "none" }}>← Tenders</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16233B", margin: "8px 0 4px" }}>Load a tender manually</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 16px", lineHeight: 1.5 }}>
          For a tender that didn&apos;t come in through Discovery - SANRAL&apos;s own portal, one a client forwarded, or a buyer that
          isn&apos;t on eTenders. Upload its documents and it gets the same analysis a discovered tender gets: whether it&apos;s a SANRAL
          template tender or a general one, what it requires, which forms can be filled for you, and how well it fits your company.
          Only your company can see a tender you load here.
        </p>
        <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px" }}>
          <ManualTenderForm companyId={membership.company_id as string} />
        </div>
        <p style={{ fontSize: 12, color: "#8A93A0", margin: "12px 0 0", lineHeight: 1.5 }}>
          The analysis runs on the Tender Ready worker (it needs Python and LibreOffice), so it takes a minute or two once the worker is
          running. The tender page shows its progress.
        </p>
      </div>
    </AppShell>
  );
}
