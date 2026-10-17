import { createClient } from "@/lib/supabase/server";
import { TENDER_TEMPLATES, TENDER_TEMPLATE_ORDER } from "@/lib/tenderTemplates";
import { uploadTenderTemplate } from "./pack-inputs-actions";

/**
 * "Blank tender templates" - upload the files SANRAL issued for this tender
 * (downloaded by hand: SANRAL's download form is reCAPTCHA-gated, playbook
 * section 1a). One row per tender_documents.doc_type the pack builder reads,
 * each with its own file input, so every upload is tagged by what it is.
 * Shared across companies, like the tender itself (0001/0025).
 */

type DocRow = { doc_type: string; original_filename: string | null; downloaded_at: string };

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

export async function TenderTemplates({ tenderId, saved }: { tenderId: string; saved: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tender_documents")
    .select("doc_type, original_filename, downloaded_at")
    .eq("tender_id", tenderId);
  const rows = new Map(((data ?? []) as DocRow[]).map((r) => [r.doc_type, r]));
  const missingRequired = TENDER_TEMPLATE_ORDER.filter((t) => TENDER_TEMPLATES[t].required && !rows.has(t));

  return (
    <div id="tender-templates" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>Blank tender templates</div>
        <span
          style={{
            display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
            background: missingRequired.length ? "#FEF3C7" : "#DCFCE7", color: missingRequired.length ? "#B45309" : "#15803D",
          }}
        >
          {missingRequired.length ? `${missingRequired.length} still needed` : "All required on file"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
        Download this tender&apos;s documents from SANRAL&apos;s tender page (its download form can&apos;t be automated),
        then upload the submission files here exactly as issued. The pack builder fills these copies; uploading the
        Technical workbook is also what lists this tender&apos;s key positions above. Shared with anyone else
        preparing this tender.
      </div>

      {error && <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>Could not load the templates on file: {error.message}</div>}
      {saved && <div style={{ fontSize: 12, color: "#15803D", marginBottom: 8, fontWeight: 600 }}>Template uploaded.</div>}

      {TENDER_TEMPLATE_ORDER.map((type) => {
        const t = TENDER_TEMPLATES[type];
        const row = rows.get(type);
        return (
          <div key={type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #F0EEE6" }}>
            <div style={{ minWidth: 0, flex: "1 1 240px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>{t.label}</span>
                <span
                  style={{
                    fontSize: 10, fontWeight: 600, borderRadius: 100, padding: "2px 8px",
                    background: row ? "#DCFCE7" : t.required ? "#FEE2E2" : "#F0EEE6",
                    color: row ? "#15803D" : t.required ? "#B91C1C" : "#6B6758",
                  }}
                >
                  {row ? "On file" : t.required ? "Needed" : "Optional"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#6B6758", marginTop: 2, wordBreak: "break-word" }}>
                {row
                  ? `${row.original_filename ?? "uploaded"} · ${new Date(row.downloaded_at).toLocaleDateString()}`
                  : t.hint}
              </div>
            </div>
            <form action={uploadTenderTemplate} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="tender_id" value={tenderId} />
              <input type="hidden" name="doc_type" value={type} />
              <input
                type="file"
                name="file"
                required
                accept={`.${t.extension}`}
                style={{ fontSize: 12, maxWidth: 220, color: "#16233B" }}
              />
              <button
                type="submit"
                style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: row ? "#FFFFFF" : "#16233B", color: row ? "#16233B" : "#FFFFFF", border: row ? "1px solid #E5E1D5" : "none", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {row ? "Replace" : "Upload"}
              </button>
            </form>
          </div>
        );
      })}
    </div>
  );
}
