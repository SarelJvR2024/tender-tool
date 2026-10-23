import { createClient } from "@/lib/supabase/server";
import { TENDER_TEMPLATES, TENDER_TEMPLATE_ORDER } from "@/lib/tenderTemplates";
import { uploadTenderTemplate } from "./pack-inputs-actions";
import { formatDate } from "@/lib/dates";

/**
 * "Blank tender templates" - upload the files SANRAL issued for this tender
 * (downloaded by hand: SANRAL's download form is reCAPTCHA-gated, playbook
 * section 1a). One row per tender_documents.doc_type the pack builder reads,
 * each with its own file input, so every upload is tagged by what it is.
 * Each company's upload is its own copy (0045): never shown to or used for
 * another company preparing the same tender - the upload could be the
 * company's own filled-in workbook. The one shared copy is a file the intake
 * registered from the buyer's own published documents.
 */

// tender_document_uploads() (0043, 0045): per type, this company's own copy
// (source 'own') or else the buyer's published one (source 'buyer') - never
// another company's.
type DocRow = { doc_type: string; original_filename: string | null; downloaded_at: string; source: "own" | "buyer" };

export async function TenderTemplates({ tenderId, saved }: { tenderId: string; saved: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tender_document_uploads", { p_tender_id: tenderId });
  if (error) console.error("tender_document_uploads rpc failed", tenderId, error);
  const rows = new Map(((data ?? []) as DocRow[]).map((r) => [r.doc_type, r]));
  const missingRequired = TENDER_TEMPLATE_ORDER.filter((t) => TENDER_TEMPLATES[t].required && !rows.has(t));

  return (
    <div id="tender-templates" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex flex-wrap items-start justify-between gap-2.5">
        <div className="text-[15px] font-bold text-foreground">Blank tender templates</div>
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
            missingRequired.length ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
          }`}
        >
          {missingRequired.length ? `${missingRequired.length} still needed` : "All required on file"}
        </span>
      </div>
      <div className="mb-3 text-xs text-muted-foreground">
        Download this tender&apos;s documents from SANRAL&apos;s tender page (its download form can&apos;t be automated),
        then upload the submission files here exactly as issued. The pack builder fills these copies; uploading the
        Technical workbook is also what lists this tender&apos;s key positions above. Only your company sees and
        uses what you upload here - other companies preparing this tender upload their own copy.
      </div>

      {error && <div className="mb-2 text-xs text-destructive">Couldn&apos;t load the templates on file - try refreshing. If it keeps happening, let us know.</div>}
      {saved && <div className="mb-2 text-xs font-semibold text-success">Template uploaded.</div>}

      {TENDER_TEMPLATE_ORDER.map((type) => {
        const t = TENDER_TEMPLATES[type];
        const row = rows.get(type);
        return (
          <div key={type} className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border py-2.5">
            <div className="min-w-0 flex-[1_1_240px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold text-foreground">{t.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    row ? "bg-success/10 text-success" : t.required ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row ? "On file" : t.required ? "Needed" : "Optional"}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] break-words text-muted-foreground">
                {row
                  ? `${row.source === "buyer" ? "from the buyer's published tender documents" : (row.original_filename ?? "uploaded")} · ${(formatDate(row.downloaded_at) ?? "—")}`
                  : t.hint}
              </div>
            </div>
            <form action={uploadTenderTemplate} className="flex flex-wrap items-center gap-1.5">
              <input type="hidden" name="tender_id" value={tenderId} />
              <input type="hidden" name="doc_type" value={type} />
              <input
                type="file"
                name="file"
                required
                accept={`.${t.extension}`}
                className="max-w-[220px] text-xs text-foreground"
              />
              <button
                type="submit"
                className={`min-h-9 cursor-pointer rounded-md px-3.5 text-xs font-semibold whitespace-nowrap ${
                  row ? "border border-border bg-card text-foreground" : "bg-foreground text-white"
                }`}
              >
                {row?.source === "own" ? "Replace" : row ? "Upload your own" : "Upload"}
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
