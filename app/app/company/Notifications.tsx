import { createClient } from "@/lib/supabase/server";
import { setDailyDigestOptIn } from "./digestActions";

/**
 * "Email notifications" - the opt-in toggle for the role-based daily digest
 * email (migration 0073, Sarel 2026-10-20: "yes let's make this an optional
 * email that the customer can decide if they want to receive it."). Reads
 * and writes the SIGNED-IN USER'S OWN company_members row only - never
 * another member's - via set_my_daily_digest_opt_in() (that migration's own
 * comment explains why an RPC, not a plain update).
 *
 * Self-contained server component, same reason as OfficeLocations.tsx: does
 * its own read under RLS, so company/page.tsx only mounts it.
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
    <div id="notifications" style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, padding: "16px 18px", marginBottom: 14 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: "#8A93A0", textTransform: "uppercase", letterSpacing: "0.04em", margin: "0 0 12px" }}>
        Email notifications
      </h2>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#16233B", marginBottom: 3 }}>Daily digest</div>
          <div style={{ fontSize: 12.5, color: "#5B6472", lineHeight: 1.5 }}>
            A once-a-day email built for your role (new matching tenders, documents and tasks due,
            tenders closing soon). Off by default - this sets only your own preference, not the
            whole company&apos;s.
          </div>
        </div>
        <form action={setDailyDigestOptIn}>
          <input type="hidden" name="opt_in" value={optedIn ? "false" : "true"} />
          <button
            type="submit"
            aria-pressed={optedIn}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44,
              padding: "0 18px", borderRadius: 9, fontSize: 14, fontWeight: 600, border: "1px solid",
              cursor: "pointer", boxSizing: "border-box", flexShrink: 0,
              background: optedIn ? "#FFFFFF" : "#D97706",
              color: optedIn ? "#16233B" : "#FFFFFF",
              borderColor: optedIn ? "#E3E6EA" : "#D97706",
            }}
          >
            {optedIn ? "Subscribed - turn off" : "Turn on daily digest"}
          </button>
        </form>
      </div>
    </div>
  );
}
