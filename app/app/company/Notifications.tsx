import { createClient } from "@/lib/supabase/server";
import { setDailyDigestOptIn } from "./digestActions";
import { VaultSection } from "./_components/shared";
import { Button } from "@/components/ui/button";

/**
 * "Email notifications" - the opt-in toggle for the daily NEW-OPPORTUNITY
 * digest email only (migration 0073, Sarel 2026-10-20: "yes let's make this
 * an optional email that the customer can decide if they want to
 * receive it."). Reads and writes the SIGNED-IN USER'S OWN company_members
 * row only - never another member's - via set_my_daily_digest_opt_in()
 * (that migration's own comment explains why an RPC, not a plain update).
 *
 * Narrowed to "new opportunities only" (Sarel, 2026-10-30), after finding
 * this one flag was ALSO gating corrigenda/addenda alerts, the returnables-
 * blocker digest and closing-deadline reminders - all 3 critical, bid-
 * protecting alerts, not a discretionary digest - and that 32 of 33 real
 * companies had never turned it on. Those 3 now bypass this flag entirely
 * (lib/notificationRecipients.ts's criticalBidRecipients(), used by
 * scripts/send-corrigendum-alerts.ts, send-returnables-digest.ts and
 * send-deadline-reminders.ts) - this toggle only ever controlled
 * scripts/send-discovered-tenders.ts from here on.
 *
 * Self-contained server component, same reason as OfficeLocations.tsx: does
 * its own read under RLS, so company/page.tsx only mounts it.
 *
 * Migrated to the design system's tokens/Tailwind (Company vault sub-PR 2 -
 * see app/AGENTS.md) - the stale amber/navy this card still carried was a
 * visible seam beside the shell sub-PR's already-migrated sections on the
 * same page. Same VaultSection shell the other sections use.
 */
export async function Notifications() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership, error } = await supabase
    .from("company_members")
    .select("daily_digest_opt_in")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("company_members select failed for Notifications", error);
    return null;
  }
  // No row yet (e.g. mid-onboarding) - nothing to toggle.
  if (!membership) return null;

  const optedIn = membership.daily_digest_opt_in === true;

  return (
    <VaultSection id="notifications" title="Email notifications">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[520px]">
          <div className="mb-0.5 text-sm font-semibold text-foreground">Daily New Opportunity Alerts</div>
          <div className="text-xs leading-relaxed text-muted-foreground">
            A once-a-day email when a new tender matching your profile is found. Off by default -
            this sets only your own preference, not the whole company&apos;s.
          </div>
          <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Active bid alerts (addenda/corrigenda, returnable checklists, and closing deadline
            reminders for tenders you are actively bidding on) are always delivered to keep your
            submissions compliant.
          </div>
        </div>
        <form action={setDailyDigestOptIn}>
          <input type="hidden" name="opt_in" value={optedIn ? "false" : "true"} />
          <Button type="submit" variant={optedIn ? "outline" : "accent"} size="lg" aria-pressed={optedIn} className="min-h-11 shrink-0 px-[18px]">
            {optedIn ? "Subscribed - turn off" : "Turn on daily digest"}
          </Button>
        </form>
      </div>
    </VaultSection>
  );
}
