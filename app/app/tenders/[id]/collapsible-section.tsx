/**
 * Spec v3 Batch 5 (§16.E/§29): "Completed groups can compact; blockers
 * remain discoverable." A plain <details>/<summary> - no client JS state,
 * no hydration, works identically for every visitor and search engine, and
 * costs nothing to add around a section that's already correct. Collapsed
 * state is per-page-load only (the `open` prop, not persisted anywhere) -
 * deliberately not written to the database, so this stays presentation-only
 * with no schema change.
 *
 * Callers decide `defaultOpen` from data they already computed (e.g. "is
 * everything in this section already confirmed/resolved") - this component
 * has no opinion on what counts as "done" for any given section.
 */
export function CollapsibleSection({
  id,
  title,
  defaultOpen,
  closedSummary,
  children,
}: {
  id?: string;
  title: string;
  defaultOpen: boolean;
  closedSummary?: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 16 }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          fontSize: 13,
          fontWeight: 700,
          color: "var(--foreground)",
        }}
      >
        <span>{title}</span>
        {!defaultOpen && closedSummary && (
          <span className="bg-success/10 text-success" style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 100, whiteSpace: "nowrap" }}>
            {closedSummary}
          </span>
        )}
      </summary>
      <div style={{ padding: "0 20px 18px" }}>{children}</div>
    </details>
  );
}
