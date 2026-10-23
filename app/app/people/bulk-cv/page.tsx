import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { PageHeader } from "@/components/tt/page-header";
import { BulkCvUpload } from "../_components/bulk-cv-upload";

// Per-request: reads the signed-in user's own company's roster under RLS -
// same Cache Components escape hatch as ../page.tsx.
export const instant = false;

export default async function BulkCvUploadPage() {
  const supabase = await createClient();
  const { data: people, error } = await supabase.from("people").select("id, name").order("name", { ascending: true });
  if (error) console.error("people select failed (bulk-cv)", error);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 py-6">
        <PageHeader
          className="mb-4"
          title="Bulk upload CVs"
          description="Select several CVs at once - choose which person each one belongs to, or create a new person from it. AI reads every file; you review and confirm each one on that person's own page."
        />
        <BulkCvUpload people={(people ?? []).map((p) => ({ id: p.id as string, name: p.name as string }))} />
      </div>
    </AppShell>
  );
}
