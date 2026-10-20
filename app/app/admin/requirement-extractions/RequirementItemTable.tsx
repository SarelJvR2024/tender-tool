"use client";

import { useMemo, useState } from "react";
import RequirementItemRow, { type RequirementItemRowData } from "./RequirementItemRow";

const field: React.CSSProperties = {
  minHeight: 36, padding: "0 10px", borderRadius: 8, border: "1px solid #E3E6EA",
  fontSize: 12.5, fontFamily: "system-ui, sans-serif", color: "#16233B", background: "#FFFFFF",
};

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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <select value={itemType} onChange={(e) => setItemType(e.target.value)} style={field}>
          <option value="all">Every item type</option>
          <option value="forms">Forms</option>
          <option value="buyer_forms">Buyer forms</option>
          <option value="returnables">Returnables</option>
          <option value="roles">Roles</option>
          <option value="person_registrations">Person registrations</option>
          <option value="cidb">CIDB</option>
          <option value="briefing">Briefing</option>
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={field}>
          <option value="all">Shared manifest + private overrides</option>
          <option value="shared">Shared manifest only</option>
          <option value="override">Private overrides only</option>
        </select>
        <span style={{ fontSize: 12, color: "#8A93A0", alignSelf: "center" }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, overflow: "hidden" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "24px 18px", fontSize: 13, color: "#5B6472" }}>No items match these filters.</div>
        )}
        {filtered.map((r) => <RequirementItemRow key={r.itemKey + (r.companyId ?? "")} row={r} />)}
      </div>
    </div>
  );
}
