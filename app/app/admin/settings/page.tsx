import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { setPlatformSetting } from "../actions";
import { formatDateTime } from "@/lib/dates";

// Reads per-request session/DB data (platform_admin_settings RPC, 0064) -
// same escape hatch as ../page.tsx.
export const instant = false;

type Setting = { key: string; value: boolean; description: string; updated_at: string };

const SETTING_LABEL: Record<string, string> = {
  signups_enabled: "Public sign-ups",
};

// Super admin portal, part 2 (0064): switches a platform admin can flip
// without a deploy. Deliberately small and real - each row here actually
// gates something (signups_enabled checked live by /signup), not a toggle
// that looks wired but does nothing.
//
// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout. The on/off toggle button's "on" state moved from plain navy
// ink to bg-accent/text-accent-foreground - an enabled platform switch is
// exactly the "single most important state" accent is reserved for, and
// bumped to a 44px touch target (was 40px).
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("platform_admin_settings");
  if (error) console.error("platform_admin_settings rpc failed", error);
  const settings = (data ?? []) as Setting[];

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1000px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="settings" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">System settings</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Platform-wide switches, applied the moment you flip them - no deploy needed.
        </p>

        {(error || actionError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {error ? "Couldn't load settings - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {settings.length === 0 && !error && (
            <div className="p-4.5 text-[13px] text-muted-foreground">No settings recorded.</div>
          )}
          {settings.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4.5 py-4 first:border-t-0">
              <div className="min-w-0 flex-[1_1_320px]">
                <div className="text-[13.5px] font-semibold text-foreground">{SETTING_LABEL[s.key] ?? s.key}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.description}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">Last changed {(formatDateTime(s.updated_at) ?? "—")}</div>
              </div>
              <form action={setPlatformSetting}>
                <input type="hidden" name="key" value={s.key} />
                <input type="hidden" name="value" value={(!s.value).toString()} />
                <button
                  type="submit"
                  className={`min-h-11 rounded-md px-3.5 text-xs font-semibold ${
                    s.value ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s.value ? "On - click to turn off" : "Off - click to turn on"}
                </button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
