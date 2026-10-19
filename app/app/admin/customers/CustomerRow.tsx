"use client";

import { useState } from "react";
import { setTestCompany } from "../actions";

export type CustomerMember = { user_id: string; email: string; role: string; joined_at: string };

export type Customer = {
  id: string;
  legal_name: string;
  csd_trading_name: string | null;
  is_test_company: boolean;
  created_at: string;
  member_count: number;
  people_count: number;
  tenders_pursued_count: number;
  last_activity_at: string | null;
  members: CustomerMember[];
};

// Client-only for the expand/collapse, same pattern as SystemAlertRow and
// HarnessRunRow - data is server-rendered by page.tsx, the test-company
// toggle posts to the Server Action in ../actions.ts.
export default function CustomerRow({ customer }: { customer: Customer }) {
  const [open, setOpen] = useState(false);
  const name = customer.csd_trading_name || customer.legal_name;

  return (
    <div style={{ borderTop: "1px solid #F0EEE6" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center",
          padding: "12px 18px", background: open ? "#F6F5F1" : "transparent", border: "none",
          textAlign: "left", cursor: "pointer", font: "inherit", boxSizing: "border-box",
        }}
      >
        <span style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "#16233B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
          {customer.csd_trading_name && customer.csd_trading_name !== customer.legal_name && (
            <span style={{ fontWeight: 400, color: "#9A9684" }}> ({customer.legal_name})</span>
          )}
        </span>
        {customer.is_test_company && (
          <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: "#F0EEE6", color: "#6B6758" }}>
            test company
          </span>
        )}
        <span style={{ fontSize: 12, color: "#6B6758" }}>{customer.member_count} member{customer.member_count === 1 ? "" : "s"}</span>
        <span style={{ fontSize: 12, color: "#6B6758" }}>{customer.people_count} people</span>
        <span style={{ fontSize: 12, color: "#6B6758" }}>{customer.tenders_pursued_count} pack{customer.tenders_pursued_count === 1 ? "" : "s"}</span>
        <span style={{ fontSize: 11, color: "#9A9684" }}>
          joined {new Date(customer.created_at).toLocaleDateString()}
          <span style={{ marginLeft: 6, color: "#D97706" }}>{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 18px 18px", background: "#F6F5F1" }}>
          <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 10 }}>
            Last activity {customer.last_activity_at ? new Date(customer.last_activity_at).toLocaleString() : "none recorded"}
          </div>

          <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, overflow: "hidden", marginBottom: 12 }}>
            {customer.members.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "#9A9684" }}>No members.</div>}
            {customer.members.map((m) => (
              <div key={m.user_id} style={{ display: "flex", gap: 10, padding: "8px 14px", fontSize: 12, borderTop: "1px solid #F0EEE6" }}>
                <span style={{ flex: "1 1 auto", color: "#16233B" }}>{m.email}</span>
                <span style={{ color: "#6B6758" }}>{m.role}</span>
                <span style={{ color: "#9A9684" }}>since {new Date(m.joined_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>

          <form action={setTestCompany} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="hidden" name="company_id" value={customer.id} />
            <input type="hidden" name="is_test" value={(!customer.is_test_company).toString()} />
            <button type="submit" style={{ fontSize: 12, padding: "7px 12px", borderRadius: 7, border: "1px solid #E5E1D5", background: "#FFFFFF", color: "#16233B", cursor: "pointer" }}>
              {customer.is_test_company ? "Unmark as test company" : "Mark as test company"}
            </button>
            <span style={{ fontSize: 11, color: "#9A9684" }}>
              A test company never counts in customer-facing reports or metrics.
            </span>
          </form>
        </div>
      )}
    </div>
  );
}
