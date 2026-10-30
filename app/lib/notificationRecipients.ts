// Shared operational-alert recipient resolution - Tier 1/2's own
// company_members.daily_digest_opt_in consent flag (migration 0073), used
// by every standalone service-role sender script that needs "this
// company's opted-in members' emails"
// (scripts/send-deadline-reminders.ts, scripts/send-operational-alerts.ts).
//
// Goes through company_notification_recipients() (migration 0094/0095), NOT
// company_member_labels() (0033) - see 0094's own header comment: that RPC
// gates on auth.uid(), which is NULL for a service-role caller, so it
// returns zero rows for one, always. Both scripts above called
// company_member_labels() this exact way before this fix (2026-10-24,
// Sarel: "fix the zero-recipients bug immediately") and were very likely
// sending to zero recipients in production every day since PR #144/#145
// merged - see docs/specs/System-Status.md's 2026-10-24 ~22:30 UTC entry.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function operationalRecipients(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("company_notification_recipients", { p_company_id: companyId });
  if (error) {
    console.error(`company_notification_recipients rpc failed for company ${companyId}`, error);
    return [];
  }
  return ((data ?? []) as { email: string; daily_digest_opt_in: boolean }[])
    .filter((m) => m.daily_digest_opt_in && !!m.email && m.email.includes("@"))
    .map((m) => m.email);
}

/**
 * Recipients for a "critical, bid-specific" alert (corrigenda, returnables
 * blockers, closing-deadline reminders, 2026-10-30) - every registered
 * company_members email for this company, with NO daily_digest_opt_in
 * filter. The opt-in flag is a preference about the discovered-tenders
 * digest only (migration 0073's own "opt-in, not opt-out" intent was never
 * about whether someone hears their own active bid is missing a mandatory
 * document); gating these three on it would mean a company's own bidding
 * team silently misses an addendum or a closing deadline unless someone
 * found and clicked a toggle described as a generic "daily digest".
 *
 * Deliberately NOT sourced from people.email (Sarel, 2026-10-30): the
 * `people` table is the CV/personnel roster - external engineers,
 * specialists, subcontractors named on a submission, not necessarily this
 * company's own staff with a login. Emailing them this company's internal
 * bid-readiness state would leak information outside the company. Stays
 * strictly to company_members, same table operationalRecipients() reads,
 * just without that one filter.
 *
 * Same RPC as operationalRecipients() on purpose, not a second one:
 * company_notification_recipients() already returns daily_digest_opt_in
 * per member for the caller to filter (or not) - no new migration needed.
 */
export async function criticalBidRecipients(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("company_notification_recipients", { p_company_id: companyId });
  if (error) {
    console.error(`company_notification_recipients rpc failed for company ${companyId}`, error);
    return [];
  }
  return ((data ?? []) as { email: string }[]).filter((m) => !!m.email && m.email.includes("@")).map((m) => m.email);
}
