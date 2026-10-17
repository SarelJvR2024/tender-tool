import { createClient } from "@/lib/supabase/server";
import { TENDER_DOCS_BUCKET } from "@/lib/manualTender";
import { AddPrivateDocumentsForm } from "../new/manual-tender-form";
import { removePrivateTenderDocument } from "./general-actions";

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

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

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
    <div id="private-documents" style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>Your private documents</div>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "#F0EEE6", color: "#16233B" }}>
          Only your company can see these
        </span>
      </div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
        This tender is shared: other companies can pursue it from Discovery too. Documents you add here - for example the
        full bid document the buyer e-mailed you - stay private to your company. They are read together with the published
        documents, and what is found in them is kept with your copy of the tender, not shown to anyone else.
      </div>
      {docs.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", borderTop: "1px solid #F0EEE6", padding: "7px 0", fontSize: 12 }}>
              <div style={{ minWidth: 0, wordBreak: "break-word" }}>
                {signed[d.storage_path] ? (
                  <a href={signed[d.storage_path]} style={{ color: "#D97706", fontWeight: 600 }}>{d.title}</a>
                ) : (
                  <span style={{ color: "#16233B", fontWeight: 600 }}>{d.title}</span>
                )}
                <span style={{ color: "#9A9684" }}> · added {new Date(d.created_at).toLocaleDateString()}</span>
              </div>
              <form action={removePrivateTenderDocument}>
                <input type="hidden" name="tender_id" value={tenderId} />
                <input type="hidden" name="document_id" value={d.id} />
                <button type="submit" style={{ minHeight: 32, padding: "0 10px", borderRadius: 7, background: "#FFFFFF", border: "1px solid #E5E1D5", color: "#B91C1C", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  Remove
                </button>
              </form>
            </div>
          ))}
          <div style={{ fontSize: 11, color: readingIsPrivate ? "#15803D" : "#B45309", marginTop: 4 }}>
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
