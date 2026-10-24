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
