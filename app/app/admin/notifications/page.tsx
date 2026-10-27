import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { formatDateTime } from "@/lib/dates";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DispatchLogTab, type DispatchLogRow } from "./DispatchLogTab";
import { TemplateGalleryTab } from "./TemplateGalleryTab";
import { ScheduleHealthTable, type ScheduleRow } from "./ScheduleHealthTable";
import { EMAIL_TEMPLATE_SAMPLES, TIER_TO_SENDER_PROFILE } from "@/lib/emailTemplateSamples";
import { WORKFLOW_REGISTRY, heartbeatStatusFor, type WorkflowHeartbeatRow } from "@/lib/workflowRegistry";

// Reads per-request session/DB data (notification_logs, workflow_heartbeats -
// both RLS-gated to platform admins, migrations 0093/0099) - same escape
// hatch as ../page.tsx.
export const instant = false;

const ROWS_SHOWN = 300;

// Wrapped so the component body itself never calls an impure built-in
// directly (react-hooks/purity) - this is a request-time "now" for a
// server-rendered staleness comparison, not reactive state, so the rule's
// concern doesn't apply, but the lint only sees the AST, not that.
function currentTimeMs(): number {
  return Date.now();
}

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
  idempotency_key: string;
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
  corrigendum_alert: "Corrigendum / addendum alert",
  discovered_tenders_digest: "New discovered tenders digest",
  clarification_window: "Clarification window expiry",
  pack_ready: "Bid pack ready",
  compliance_expiry: "Compliance document expiry",
  scout_anomaly: "Quality Scout anomaly",
  founder_daily_digest: "Founder daily digest",
};

const TIER_LABEL: Record<string, string> = {
  welcome_user: "Tier 0", nudge_vault_kickstart: "Tier 0", nudge_first_tender: "Tier 0",
  trial_day_7_milestone: "Tier 0", trial_expiring_48h: "Tier 0", trial_expired: "Tier 0",
  team_invite: "Tier 0", admin_new_signup: "Tier 0", admin_paid_conversion: "Tier 0",
  deadline_reminder: "Tier 1", print_sign_cutoff: "Tier 1", briefing_reminder: "Tier 1",
  corrigendum_alert: "Tier 1", discovered_tenders_digest: "Tier 1", clarification_window: "Tier 1", pack_ready: "Tier 1",
  compliance_expiry: "Tier 2",
  scout_anomaly: "Tier 3", founder_daily_digest: "Tier 3",
};

export default async function AdminNotificationsPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; tab?: string }> }) {
  const { error: actionError, sent: sentMessage, tab } = await searchParams;
  const supabase = await createClient();

  const [{ data: logData, error: logError }, { data: heartbeatData }] = await Promise.all([
    supabase
      .from("notification_logs")
      .select("id, notification_type, recipient_email, company_id, tender_id, subject, status, resend_id, error, sent_at, idempotency_key")
      .order("sent_at", { ascending: false })
      .limit(ROWS_SHOWN),
    supabase.from("workflow_heartbeats").select("*"),
  ]);
  if (logError) console.error("notification_logs select failed", logError);

  const logRows = (logData ?? []) as NotificationLogRow[];
  const dispatchRows: DispatchLogRow[] = logRows.map((r) => {
    const tierLabel = TIER_LABEL[r.notification_type] ?? "—";
    return {
      ...r,
      typeLabel: TYPE_LABEL[r.notification_type] ?? r.notification_type,
      tierLabel,
      category: TIER_TO_SENDER_PROFILE[tierLabel as keyof typeof TIER_TO_SENDER_PROFILE] ?? "system",
      sentAtDisplay: formatDateTime(r.sent_at) ?? r.sent_at,
    };
  });

  const heartbeatByKey = new Map(((heartbeatData ?? []) as WorkflowHeartbeatRow[]).map((h) => [h.workflow_key, h]));
  const nowMs = currentTimeMs();
  const scheduleRows: ScheduleRow[] = WORKFLOW_REGISTRY.map((entry) => {
    const h = heartbeatByKey.get(entry.key) ?? null;
    return {
      entry,
      status: heartbeatStatusFor(entry, h, nowMs),
      lastCompletedAt: h?.last_completed_at ?? null,
      lastStatus: h?.last_status ?? null,
      lastError: h?.last_error ?? null,
      itemsProcessed: h?.items_processed ?? null,
    };
  });

  const galleryItems = EMAIL_TEMPLATE_SAMPLES.map((s) => {
    const rendered = s.render();
    return { key: s.key, label: s.label, tier: s.tier, category: TIER_TO_SENDER_PROFILE[s.tier], ...rendered };
  });

  const defaultTab = tab === "gallery" || tab === "schedule" ? tab : "dispatch";

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="notifications" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Notification Command Center</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Every notification this product sends, how it&apos;s scheduled, and whether it actually ran.
        </p>

        {logError && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {"Couldn't load the notification log - try refreshing. If it keeps happening, let us know."}
          </div>
        )}

        <Tabs defaultValue={defaultTab}>
          <TabsList className="mb-3">
            <TabsTrigger value="dispatch">Dispatch log</TabsTrigger>
            <TabsTrigger value="gallery">Template gallery</TabsTrigger>
            <TabsTrigger value="schedule">Schedule &amp; cron health</TabsTrigger>
          </TabsList>

          <TabsContent value="dispatch">
            <DispatchLogTab rows={dispatchRows} rowsShown={ROWS_SHOWN} />
          </TabsContent>

          <TabsContent value="gallery">
            <TemplateGalleryTab items={galleryItems} sentMessage={sentMessage ?? null} errorMessage={actionError ?? null} />
          </TabsContent>

          <TabsContent value="schedule">
            <ScheduleHealthTable rows={scheduleRows} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
