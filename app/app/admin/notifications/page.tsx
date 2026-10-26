import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { formatDateTime } from "@/lib/dates";

// Reads per-request session/DB data (notification_logs, RLS-gated to
// platform admins - migration 0093) - same escape hatch as ../page.tsx.
export const instant = false;

const ROWS_SHOWN = 300;

type NotificationLogRow = {
  id: string;
  notification_type: string;
  recipient_email: string;
  company_id: string | null;
  tender_id: string | null;
  subject: string;
  status: "sent" | "failed" | "skipped_no_api_key";
  resend_id: string | null;
  error: string | null;
  sent_at: string;
};

// Every notification_type this engine has ever sent (lib/notificationEngine.ts's
// own NotificationType union for Tier 0/3, plus the 4 Tier 1/2 types
// scripts/send-deadline-reminders.ts/send-operational-alerts.ts now log here
// too - see those files' own record_notification_sent() calls, added
// alongside this page). A type with no entry here still renders fine (falls
// back to the raw value) - this is a display label, never a filter.
const TYPE_LABEL: Record<string, string> = {
  welcome_user: "Welcome email",
  nudge_vault_kickstart: "Vault kickstart nudge",
  nudge_first_tender: "First tender nudge",
  trial_day_7_milestone: "Trial day-7 milestone",
  trial_expiring_48h: "Trial expiring (48h)",
  trial_expired: "Trial expired",
  team_invite: "Team invite",
  admin_new_signup: "Admin: new signup",
  admin_paid_conversion: "Admin: paid conversion",
  deadline_reminder: "Deadline reminder",
  print_sign_cutoff: "Print & transit cutoff",
  briefing_reminder: "Briefing countdown",
  compliance_expiry: "Compliance document expiry",
  scout_anomaly: "Quality Scout anomaly",
  founder_daily_digest: "Founder daily digest",
};

const TIER_LABEL: Record<string, string> = {
  welcome_user: "Tier 0", nudge_vault_kickstart: "Tier 0", nudge_first_tender: "Tier 0",
  trial_day_7_milestone: "Tier 0", trial_expiring_48h: "Tier 0", trial_expired: "Tier 0",
  team_invite: "Tier 0", admin_new_signup: "Tier 0", admin_paid_conversion: "Tier 0",
  deadline_reminder: "Tier 1", print_sign_cutoff: "Tier 1", briefing_reminder: "Tier 1",
  compliance_expiry: "Tier 2",
  scout_anomaly: "Tier 3", founder_daily_digest: "Tier 3",
};

// "Delivered"/"Failed" match the brief's own wording. skipped_no_api_key is
// deliberately NOT relabelled "Throttled" - this codebase has no actual
// send-throttling mechanism for individual notifications (Scout's anti-noise
// batching, PR #151, throttles which ALERTS get raised, not whether an
// already-raised one's email goes out) - mislabelling a missing-API-key skip
// as "throttled" would misdescribe a config problem as a rate limit.
const STATUS_LABEL: Record<NotificationLogRow["status"], string> = {
  sent: "Delivered",
  failed: "Failed",
  skipped_no_api_key: "Skipped (no API key)",
};
const STATUS_CHIP_CLASS: Record<NotificationLogRow["status"], string> = {
  sent: "bg-success/10 text-success border-success/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  skipped_no_api_key: "bg-warning/10 text-warning border-warning/20",
};

export default async function AdminNotificationsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notification_logs")
    .select("id, notification_type, recipient_email, company_id, tender_id, subject, status, resend_id, error, sent_at")
    .order("sent_at", { ascending: false })
    .limit(ROWS_SHOWN);
  if (error) console.error("notification_logs select failed", error);

  const rows = (data ?? []) as NotificationLogRow[];
  const sentCount = rows.filter((r) => r.status === "sent").length;
  const failedCount = rows.filter((r) => r.status === "failed").length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="notifications" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Notification dispatch log</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Every email Resend was asked to send, across Tier 0 (onboarding), Tier 1 (tender operations), Tier 2
          (compliance) and Tier 3 (founder/Scout) - most recent {ROWS_SHOWN} first.{" "}
          {rows.length > 0 ? `${sentCount} delivered, ${failedCount} failed, of ${rows.length} shown.` : ""}
        </p>

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {"Couldn't load the notification log - try refreshing. If it keeps happening, let us know."}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {rows.length === 0 && !error && (
            <div className="p-4.5 text-[13px] text-muted-foreground">No notifications sent yet.</div>
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-4.5 py-2 font-semibold">Sent (SAST)</th>
                    <th className="px-4.5 py-2 font-semibold">Recipient</th>
                    <th className="px-4.5 py-2 font-semibold">Template</th>
                    <th className="px-4.5 py-2 font-semibold">Tier</th>
                    <th className="px-4.5 py-2 font-semibold">Status</th>
                    <th className="px-4.5 py-2 font-semibold">Resend message ID</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-b-0">
                      <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{formatDateTime(r.sent_at) ?? r.sent_at}</td>
                      <td className="max-w-[220px] truncate px-4.5 py-2 text-foreground" title={r.recipient_email}>{r.recipient_email}</td>
                      <td className="px-4.5 py-2 text-foreground">{TYPE_LABEL[r.notification_type] ?? r.notification_type}</td>
                      <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{TIER_LABEL[r.notification_type] ?? "—"}</td>
                      <td className="whitespace-nowrap px-4.5 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_CHIP_CLASS[r.status]}`}
                          title={r.status === "failed" && r.error ? r.error : undefined}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className="max-w-[160px] truncate px-4.5 py-2 font-mono text-[11px] text-muted-foreground" title={r.resend_id ?? undefined}>
                        {r.resend_id ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
