import { BidTaskBadge, type BidTaskBadgeStatus } from "@/components/tt/bid-task-badge";

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

// Fix(red) > Provide(amber) > Verify(green) severity, matching the rest of
// this screen's Verify/Provide/Fix vocabulary (app/AGENTS.md): a document
// missing from the pack entirely is the real gap (Fix), one included but
// flagged with a warning is merely something to look at before you submit
// (Provide), and one cleanly included needs no further action (Verify).
const STATUS_META: Record<ChecklistRow["status"], { label: string; badge: BidTaskBadgeStatus; noteClass: string }> = {
  included: { label: "Included", badge: "verify", noteClass: "text-success" },
  included_warning: { label: "Included - warning", badge: "provide", noteClass: "text-warning" },
  not_included: { label: "Not included", badge: "fix", noteClass: "text-destructive" },
};

export function PackChecklist({ rows, title = "What's in this pack" }: { rows: ChecklistRow[]; title?: string }) {
  if (rows.length === 0) return null;
  const n = (s: ChecklistRow["status"]) => rows.filter((r) => r.status === s).length;
  return (
    <details open={n("included_warning") + n("not_included") > 0} className="mt-2 rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer flex-wrap items-center gap-1.5 px-3 py-2 text-xs font-bold text-foreground">
        <span>
          {title}: {rows.length} documents
        </span>
        <BidTaskBadge status="verify">{`${n("included")} included`}</BidTaskBadge>
        {n("included_warning") > 0 && <BidTaskBadge status="provide">{`${n("included_warning")} with a warning`}</BidTaskBadge>}
        {n("not_included") > 0 && <BidTaskBadge status="fix">{`${n("not_included")} not included`}</BidTaskBadge>}
      </summary>
      <div className="px-3 pb-2.5">
        {(n("included_warning") > 0 || n("not_included") > 0) && (
          <div className="mb-1.5 text-[11px] text-muted-foreground">
            Deal with every warning and every missing document before you submit. The same checklist is on the pack&apos;s
            contents page.
          </div>
        )}
        {rows.map((r, i) => {
          const head = i === 0 || rows[i - 1].envelope !== r.envelope ? r.envelope : null;
          const meta = STATUS_META[r.status];
          return (
            <div key={`${r.envelope}-${r.no}-${r.title}`}>
              {head && <div className="mt-2 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{head}</div>}
              <div className="flex items-start gap-2 border-t border-border py-1.5 text-xs">
                <span className="mt-px shrink-0">
                  <BidTaskBadge status={meta.badge}>{meta.label}</BidTaskBadge>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold break-words text-foreground">
                    {r.title}
                    {r.pages && <span className="font-normal text-muted-foreground"> · p{r.pages}</span>}
                  </div>
                  {r.note && <div className={`break-words ${meta.noteClass}`}>{r.note}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
