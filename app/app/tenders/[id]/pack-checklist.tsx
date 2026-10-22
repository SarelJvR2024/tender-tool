/**
 * The checklist that ships with every generated pack (Sarel, 2026-10-17:
 * "With each tender pack you need to create a check of whats included and
 * the status"): every document the pack is meant to hold, in submission
 * order, and whether it is in - fine, in - with a warning (e.g. the vault
 * copy has expired: it is still included, flagged to be replaced before
 * submission), or not included, with why.
 *
 * Rendered from the job's manifest.checklist, which engine/pack/pdf_merge.py
 * builds from the same rows it prints on the pack's own contents page - so
 * the page and the PDF can't disagree. Packs built before the checklist
 * existed fall back to their sections + omitted lists.
 */

export type ChecklistRow = {
  no: number;
  title: string;
  envelope: string;
  status: "included" | "included_warning" | "not_included";
  pages: string | null;
  note: string | null;
};

type ManifestLike = {
  checklist?: ChecklistRow[];
  sections?: { title: string; envelope: string; start_page: number; end_page: number; warning?: string | null }[];
  omitted?: { title: string; envelope: string; reason: string }[];
};

export function checklistOf(manifest: ManifestLike | null | undefined): ChecklistRow[] {
  if (!manifest) return [];
  if (manifest.checklist) return manifest.checklist;
  const rows: ChecklistRow[] = (manifest.sections ?? [])
    .filter((s) => s.title !== "Contents")
    .map((s, i) => ({
      no: i + 1,
      title: s.title,
      envelope: s.envelope,
      status: s.warning ? "included_warning" : "included",
      pages: s.start_page === s.end_page ? `${s.start_page}` : `${s.start_page}-${s.end_page}`,
      note: s.warning ?? null,
    }));
  for (const o of manifest.omitted ?? []) {
    rows.push({ no: rows.length + 1, title: o.title, envelope: o.envelope, status: "not_included", pages: null, note: o.reason });
  }
  return rows;
}

// Fix(red) > Provide(amber) severity, matching the rest of this screen's
// Verify/Provide/Fix vocabulary (app/AGENTS.md): a document missing from the
// pack entirely is the real gap (closer to Fix), while one included but
// flagged with a warning is merely something to look at before you submit
// (closer to Provide) - the opposite of how these two were first colored.
const STYLE: Record<ChecklistRow["status"], { label: string; bg: string; color: string }> = {
  included: { label: "Included", bg: "#DCFCE7", color: "#15803D" },
  included_warning: { label: "Included - warning", bg: "#FEF3C7", color: "#B45309" },
  not_included: { label: "Not included", bg: "#FEE2E2", color: "#B91C1C" },
};

export function PackChecklist({ rows, title = "What's in this pack" }: { rows: ChecklistRow[]; title?: string }) {
  if (rows.length === 0) return null;
  const n = (s: ChecklistRow["status"]) => rows.filter((r) => r.status === s).length;
  return (
    <details open={n("included_warning") + n("not_included") > 0} style={{ marginTop: 8, border: "1px solid #E3E6EA", borderRadius: 9, background: "#FFFFFF" }}>
      <summary style={{ cursor: "pointer", padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#16233B", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span>{title}: {rows.length} documents</span>
        <Chip {...STYLE.included} label={`${n("included")} included`} />
        {n("included_warning") > 0 && <Chip {...STYLE.included_warning} label={`${n("included_warning")} with a warning`} />}
        {n("not_included") > 0 && <Chip {...STYLE.not_included} label={`${n("not_included")} not included`} />}
      </summary>
      <div style={{ padding: "0 12px 10px" }}>
        {(n("included_warning") > 0 || n("not_included") > 0) && (
          <div style={{ fontSize: 11, color: "#5B6472", marginBottom: 6 }}>
            Deal with every warning and every missing document before you submit. The same checklist is on the pack&apos;s
            contents page.
          </div>
        )}
        {rows.map((r, i) => {
          const head = i === 0 || rows[i - 1].envelope !== r.envelope ? r.envelope : null;
          const st = STYLE[r.status];
          return (
            <div key={`${r.envelope}-${r.no}-${r.title}`}>
              {head && <div style={{ fontSize: 10, fontWeight: 700, color: "#5B6472", letterSpacing: 0.3, marginTop: 8, textTransform: "uppercase" }}>{head}</div>}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", borderTop: "1px solid #E3E6EA", fontSize: 12 }}>
                <span style={{ flex: "0 0 auto", marginTop: 1 }}>
                  <Chip {...st} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "#16233B", fontWeight: 600, wordBreak: "break-word" }}>
                    {r.title}
                    {r.pages && <span style={{ color: "#8A93A0", fontWeight: 400 }}> · p{r.pages}</span>}
                  </div>
                  {r.note && <div style={{ color: st.color, wordBreak: "break-word" }}>{r.note}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function Chip({ label, bg, color }: { label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}
