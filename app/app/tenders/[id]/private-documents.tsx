import { createClient } from "@/lib/supabase/server";
import { TENDER_DOCS_BUCKET } from "@/lib/manualTender";
import { AddPrivateDocumentsForm } from "../new/manual-tender-form";
import { removePrivateTenderDocument } from "./general-actions";
import { formatDate } from "@/lib/dates";

/**
 * "Your private documents" on a SHARED tender (one Discovery found -
 * tenders.owner_company_id is null), migration 0032. A company adds its own
 * copies of documents the listing doesn't have - typically the full bid
 * document a buyer e-mailed it - and they are read together with the
 * published documents. Other companies pursuing the same tender never see
 * them, nor what is read from them: the reading is stored on this company's
 * tender_packs row, not the shared tender (process_general_jobs.py).
 */

export type PrivateDoc = { id: string; title: string; storage_path: string; created_at: string };

// Same reasoning as cv-compare.tsx's own actionLinkClass: a plural/secondary
// download link, not a screen's single highlighted action, so it stays a
// foreground-colored underline rather than a solid accent fill.
const actionLinkClass = "text-xs font-semibold text-foreground underline underline-offset-2 hover:text-accent";

export async function PrivateDocuments({
  tenderId,
  companyId,
  docs,
  readingIsPrivate,
}: {
  tenderId: string;
  companyId: string;
  docs: PrivateDoc[];
  readingIsPrivate: boolean;
}) {
  const supabase = await createClient();
  const signed: Record<string, string> = {};
  if (docs.length > 0) {
    const results = await Promise.all(docs.map((d) => supabase.storage.from(TENDER_DOCS_BUCKET).createSignedUrl(d.storage_path, 600)));
    results.forEach((r, i) => {
      if (r.data?.signedUrl) signed[docs[i].storage_path] = r.data.signedUrl;
    });
  }
  return (
    <div id="private-documents" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex flex-wrap items-center gap-2">
        <div className="text-[15px] font-bold text-foreground">Your private documents</div>
        <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-foreground">
          Only your company can see these
        </span>
      </div>
      <div className="mb-2.5 text-xs text-muted-foreground">
        This tender is shared: other companies can pursue it from Discovery too. Documents you add here - for example the
        full bid document the buyer e-mailed you - stay private to your company. They are read together with the published
        documents, and what is found in them is kept with your copy of the tender, not shown to anyone else.
      </div>
      {docs.length > 0 && (
        <div className="mb-2.5">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 border-t border-border py-[7px] text-xs">
              <div className="min-w-0 break-words">
                {signed[d.storage_path] ? (
                  <a href={signed[d.storage_path]} className={actionLinkClass}>{d.title}</a>
                ) : (
                  <span className="font-semibold text-foreground">{d.title}</span>
                )}
                <span className="text-muted-foreground"> · added {(formatDate(d.created_at) ?? "—")}</span>
              </div>
              <form action={removePrivateTenderDocument}>
                <input type="hidden" name="tender_id" value={tenderId} />
                <input type="hidden" name="document_id" value={d.id} />
                <button type="submit" className="min-h-8 cursor-pointer rounded-md border border-border bg-card px-2.5 text-[11px] font-semibold text-destructive">
                  Remove
                </button>
              </form>
            </div>
          ))}
          <div className={`mt-1 text-[11px] ${readingIsPrivate ? "text-success" : "text-warning"}`}>
            {readingIsPrivate
              ? "The requirements below were read from the published documents plus these."
              : "Not read yet - the requirements below come from the published documents only until the re-read finishes."}
          </div>
        </div>
      )}
      <AddPrivateDocumentsForm companyId={companyId} tenderId={tenderId} />
    </div>
  );
}
