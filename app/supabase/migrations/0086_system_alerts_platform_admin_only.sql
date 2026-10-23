-- UX audit re-review, 2026-10-23: system_alerts (0042) still used the
-- pre-platform-admin "company owner" proxy rule ("Readable by a company
-- owner (0005's 'trusted admin' proxy, same rule as admin_harness_runs)")
-- - but admin_harness_runs itself was migrated to the real platform_admins
-- check in 0043 ("Now a separate platform_admins list"), and system_alerts
-- was simply never carried along. The result, confirmed live: ANY company
-- owner on the platform - not just Sarel - could SELECT the full table
-- directly (verified with a non-platform-admin company-owner account's own
-- access token against PostgREST, bypassing the app entirely). system_alerts
-- is a platform-wide operational log (discovery failures, worker crashes,
-- OCR status, other companies' upload ids in `context`/`detail`, stack
-- tracebacks with server file paths) - never meant to be company-scoped or
-- customer-visible at all. This is the same bug class app/admin/layout.tsx
-- just fixed at the page level (RLS alone isn't admin-only unless it
-- actually checks is_platform_admin()), on a table that layout's own guard
-- does not reach (REST/RPC calls don't go through it).

drop policy if exists "system_alerts: owners can select" on system_alerts;
drop policy if exists "system_alerts: owners can resolve" on system_alerts;

create policy "system_alerts: platform admins can select" on system_alerts
  for select to authenticated using (is_platform_admin());

create policy "system_alerts: platform admins can resolve" on system_alerts
  for update to authenticated
  using (is_platform_admin())
  with check (is_platform_admin() and (resolved_by is null or resolved_by = auth.uid()));
