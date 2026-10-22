"use client";

import { useMemo, useState } from "react";
import RequirementItemRow, { type RequirementItemRowData } from "./RequirementItemRow";

const field = "min-h-11 rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-foreground";

/** Basic client-side filter over the queue - same "state lives in this
 * component" pattern as OpportunityTable, proportionate to a review-queue
 * screen rather than a full-size dataset. Sort order (lowest confidence
 * first) comes from the RPC itself and is kept as-is. */
export default function RequirementItemTable({ rows }: { rows: RequirementItemRowData[] }) {
  const [itemType, setItemType] = useState<string>("all");
  const [scope, setScope] = useState<string>("all");

  const filtered = useMemo(() => {
    let out = rows;
    if (itemType !== "all") out = out.filter((r) => r.itemType === itemType);
    if (scope === "shared") out = out.filter((r) => !r.companyId);
    if (scope === "override") out = out.filter((r) => !!r.companyId);
    return out;
  }, [rows, itemType, scope]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select value={itemType} onChange={(e) => setItemType(e.target.value)} className={field}>
          <option value="all">Every item type</option>
          <option value="forms">Forms</option>
          <option value="buyer_forms">Buyer forms</option>
          <option value="returnables">Returnables</option>
          <option value="roles">Roles</option>
          <option value="person_registrations">Person registrations</option>
          <option value="cidb">CIDB</option>
          <option value="briefing">Briefing</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={field}>
          <option value="all">Shared manifest + private overrides</option>
          <option value="shared">Shared manifest only</option>
          <option value="override">Private overrides only</option>
        </select>
        <span className="self-center text-xs text-muted-foreground/70">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {filtered.length === 0 && (
          <div className="p-4.5 text-[13px] text-muted-foreground">No items match these filters.</div>
        )}
        {filtered.map((r) => <RequirementItemRow key={r.itemKey + (r.companyId ?? "")} row={r} />)}
      </div>
    </div>
  );
}
