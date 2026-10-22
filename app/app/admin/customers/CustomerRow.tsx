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
//
// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout - navy/muted/border/gold hex -> foreground/muted-foreground/
// border/accent tokens, same mapping as every other admin row in this pass.
//
// Mobile card layout (2026-10-21): below `sm`, this stopped being one
// cramped flex-wrap line (name, badge, 3 counts and a date all competing
// for the same row) and became a real 2-line card - name + open/hide on
// its own top line, the 3 counts + joined date as their own wrapped meta
// line underneath. `sm:` and up collapses back to the original single-row
// layout, which has room for all of it.
export default function CustomerRow({ customer }: { customer: Customer }) {
  const [open, setOpen] = useState(false);
  const name = customer.csd_trading_name || customer.legal_name;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-11 w-full flex-col gap-1.5 px-4.5 py-3 text-left font-[inherit] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3.5 sm:gap-y-1.5 ${open ? "bg-card" : "bg-transparent"}`}
      >
        <span className="flex items-center gap-2 sm:min-w-0 sm:flex-[1_1_220px]">
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold text-foreground">
            {name}
            {customer.csd_trading_name && customer.csd_trading_name !== customer.legal_name && (
              <span className="font-normal text-muted-foreground"> ({customer.legal_name})</span>
            )}
          </span>
          {customer.is_test_company && (
            <span className="inline-flex shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              test company
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs text-accent sm:hidden">{open ? "hide ▲" : "open ▼"}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{customer.member_count} member{customer.member_count === 1 ? "" : "s"}</span>
          <span>{customer.people_count} people</span>
          <span>{customer.tenders_pursued_count} pack{customer.tenders_pursued_count === 1 ? "" : "s"}</span>
          <span className="text-[11px]">
            joined {new Date(customer.created_at).toLocaleDateString()}
            <span className="ml-1.5 hidden text-accent sm:inline">{open ? "hide ▲" : "open ▼"}</span>
          </span>
        </span>
      </button>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1">
          <div className="mb-2.5 text-xs text-muted-foreground">
            Last activity {customer.last_activity_at ? new Date(customer.last_activity_at).toLocaleString() : "none recorded"}
          </div>

          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
            {customer.members.length === 0 && <div className="px-3.5 py-2.5 text-xs text-muted-foreground">No members.</div>}
            {customer.members.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-3.5 py-2 text-xs first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-foreground">{m.email}</span>
                <span className="text-muted-foreground">{m.role}</span>
                <span className="text-muted-foreground">since {new Date(m.joined_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>

          <form action={setTestCompany} className="flex items-center gap-2.5">
            <input type="hidden" name="company_id" value={customer.id} />
            <input type="hidden" name="is_test" value={(!customer.is_test_company).toString()} />
            <button type="submit" className="min-h-11 rounded-md border border-border bg-card px-3 text-xs text-foreground">
              {customer.is_test_company ? "Unmark as test company" : "Mark as test company"}
            </button>
            <span className="text-[11px] text-muted-foreground">
              A test company never counts in customer-facing reports or metrics.
            </span>
          </form>
        </div>
      )}
    </div>
  );
}
