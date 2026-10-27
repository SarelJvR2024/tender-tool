"use client";

import { useState } from "react";
import { setTestCompany } from "../actions";
import { startImpersonation } from "./impersonation-actions";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { Criterion } from "@/lib/readiness";

export type CustomerMember = { user_id: string; email: string; role: string; joined_at: string };

export type Customer = {
  id: string;
  legal_name: string;
  csd_trading_name: string | null;
  csd_supplier_number: string | null;
  is_test_company: boolean;
  created_at: string;
  member_count: number;
  people_count: number;
  tenders_pursued_count: number;
  active_tenders_count: number;
  last_activity_at: string | null;
  plan_tier: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  members: CustomerMember[];
  /** null when readiness couldn't be computed (no readiness data row, e.g. a company somehow missing). */
  readinessPercent: number | null;
  /** Full per-criterion breakdown behind readinessPercent - same null case. */
  readinessCriteria: Criterion[] | null;
  primaryContact: string | null;
  /** Only meaningful when subscription_status === "trialing"; null otherwise. Can be negative (trial already expired). */
  trialDaysRemaining: number | null;
};

const PLAN_LABEL: Record<string, string> = {
  starter: "Starter", professional: "Professional", business: "Business", enterprise: "Enterprise",
  // Pre-rename plan names (migration 0078's original check constraint) - a
  // company seeded before the Starter/Professional/Business/Enterprise
  // rename could still carry one of these; shown rather than falling back
  // to a raw unlabelled slug.
  watch: "Watch (legacy)", pro: "Pro (legacy)", sanral_pro: "SANRAL Pro (legacy)",
};

const SUBSCRIPTION_STATUS_TONE: Record<string, "success" | "warning" | "destructive"> = {
  active: "success", trialing: "warning", past_due: "destructive", cancelled: "destructive",
};
const STATUS_CHIP_CLASS: Record<"success" | "warning" | "destructive", string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
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
//
// Plan/trial chip + CSD/contact/readiness line (System Admin Command Center
// brief, 2026-10-25): extends this same row rather than a separate page -
// see migration 0098's own header for why platform_admin_companies() grew
// these columns instead of a parallel "Tenants" RPC.
/**
 * "View Tenant Workspace" (Admin Command Center Phase 4, guardrail 5) -
 * a plain <form> submit, never nested inside the row's own toggle <button>
 * (invalid HTML). Hidden entirely when impersonation isn't configured in
 * this environment (no service-role key yet) rather than showing a button
 * that would just fail after being clicked.
 */
function ViewTenantWorkspaceButton({ companyId, className }: { companyId: string; className?: string }) {
  return (
    <form action={startImpersonation} className={className}>
      <input type="hidden" name="company_id" value={companyId} />
      <button type="submit" className="min-h-11 rounded-md border border-accent/30 bg-accent/10 px-3 text-xs font-semibold text-accent">
        View Tenant Workspace
      </button>
    </form>
  );
}

export default function CustomerRow({ customer, defaultOpen = false, impersonationAvailable }: { customer: Customer; defaultOpen?: boolean; impersonationAvailable: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const name = customer.csd_trading_name || customer.legal_name;
  const statusTone = customer.subscription_status ? SUBSCRIPTION_STATUS_TONE[customer.subscription_status] : undefined;
  const planLabel = customer.plan_tier ? (PLAN_LABEL[customer.plan_tier] ?? customer.plan_tier) : null;

  return (
    <div className="border-t border-border first:border-t-0">
      <div className={`flex min-h-11 w-full flex-col gap-1.5 px-4.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3.5 sm:gap-y-1.5 ${open ? "bg-card" : "bg-transparent"}`}>
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 flex-col gap-1.5 text-left font-[inherit] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3.5 sm:gap-y-1.5">
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
            {statusTone && (
              <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP_CLASS[statusTone]}`}>
                {planLabel ?? "no plan"}
                {customer.subscription_status === "trialing" && customer.trialDaysRemaining !== null
                  ? ` - trial ${customer.trialDaysRemaining >= 0 ? `${customer.trialDaysRemaining}d left` : "expired"}`
                  : ""}
              </span>
            )}
            <span className="ml-auto shrink-0 text-xs text-accent sm:hidden">{open ? "hide ▲" : "open ▼"}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{customer.member_count} member{customer.member_count === 1 ? "" : "s"}</span>
            <span>{customer.people_count} people</span>
            <span>{customer.active_tenders_count} active tender{customer.active_tenders_count === 1 ? "" : "s"}</span>
            {customer.readinessPercent !== null && <span>{customer.readinessPercent}% vault ready</span>}
            <span className="text-[11px]">
              joined {(formatDate(customer.created_at) ?? "—")}
              <span className="ml-1.5 hidden text-accent sm:inline">{open ? "hide ▲" : "open ▼"}</span>
            </span>
          </span>
        </button>
        {impersonationAvailable && <ViewTenantWorkspaceButton companyId={customer.id} className="shrink-0" />}
      </div>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1">
          <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Last activity {customer.last_activity_at ? (formatDateTime(customer.last_activity_at) ?? "—") : "none recorded"}</span>
            <span>CSD supplier number: {customer.csd_supplier_number ?? "not on file"}</span>
            <span>Primary contact: {customer.primaryContact ?? "no members"}</span>
            <span>{customer.tenders_pursued_count} pack{customer.tenders_pursued_count === 1 ? "" : "s"} total ({customer.active_tenders_count} active)</span>
          </div>

          {customer.readinessCriteria && customer.readinessCriteria.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-3.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
                Readiness breakdown ({customer.readinessPercent}%)
              </div>
              {customer.readinessCriteria.map((c) => (
                <div key={c.key} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-3.5 py-2 text-xs first:border-t-0">
                  <span className={c.satisfied ? "text-success" : "text-destructive"}>{c.satisfied ? "✓" : "✗"}</span>
                  <span className="min-w-0 flex-1 text-foreground">{c.label}</span>
                  <span className="text-muted-foreground">weight {c.weight}</span>
                  {!c.satisfied && c.reason && (
                    <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      {c.reason === "missing" ? "Missing" : c.reason === "expired" ? "Expired" : "Expiring soon"}
                      {c.daysLeft !== null && c.daysLeft !== undefined ? ` (${c.daysLeft}d)` : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
            {customer.members.length === 0 && <div className="px-3.5 py-2.5 text-xs text-muted-foreground">No members.</div>}
            {customer.members.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border px-3.5 py-2 text-xs first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-foreground">{m.email}</span>
                <span className="text-muted-foreground">{m.role}</span>
                <span className="text-muted-foreground">since {(formatDate(m.joined_at) ?? "—")}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
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
            {impersonationAvailable && <ViewTenantWorkspaceButton companyId={customer.id} />}
          </div>
        </div>
      )}
    </div>
  );
}
