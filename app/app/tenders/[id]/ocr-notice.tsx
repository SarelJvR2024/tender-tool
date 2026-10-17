import type { ManifestOcr } from "@/lib/generalTender";

/**
 * EXPERIMENTAL OCR (engine/ocr/scan_ocr.py, docs/specs/OCR-Evaluation.md):
 * names every tender document whose text - some pages or all - was read by
 * OCR from a scan rather than from a real text layer, so nothing listed from
 * it is trusted like a clean read. Renders nothing when OCR wasn't used.
 */
export function OcrNotice({ documents }: { documents: { name: string; ocr?: ManifestOcr | null }[] }) {
  const ocrDocs = documents.filter((d) => d.ocr && d.ocr.pages_ocr.length > 0);
  if (ocrDocs.length === 0) return null;
  return (
    <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 9, padding: "9px 12px", marginBottom: 12, fontSize: 12, color: "#1E3A8A" }}>
      <div style={{ fontWeight: 700, marginBottom: 3 }}>Read by OCR from a scan - check against the original</div>
      <div style={{ marginBottom: 4 }}>
        {ocrDocs.length === 1 ? "This document has" : "These documents have"} no real text layer, so the text was read by OCR (character
        recognition). OCR can misread characters and numbers and can skip a line. Requirements marked &ldquo;read by OCR&rdquo; below came from
        this text.
      </div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {ocrDocs.map((d) => {
          const o = d.ocr as ManifestOcr;
          const all = o.total_pages != null && o.pages_ocr.length === o.total_pages;
          return (
            <li key={d.name} style={{ wordBreak: "break-word" }}>
              {d.name}: {all ? `all ${o.pages_ocr.length} page${o.pages_ocr.length === 1 ? "" : "s"}` : `page${o.pages_ocr.length === 1 ? "" : "s"} ${o.pages_ocr.join(", ")}`}
              {o.mean_confidence != null ? `, OCR confidence ${Math.round(o.mean_confidence)}/100` : ""}
              {o.pages_failed.length > 0 ? ` - not read: ${o.pages_failed.map((f) => `p.${f.page}`).join(", ")}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const OCR_TAG = "Read by OCR - check the scan: ";
