-- Standing solution-architect review finding, 2026-11-06: the notification
-- engine's own one-time-ever claim functions - claim_notification() (0093),
-- record_notification_sent() (0093), record_deadline_reminder_sent() (0080),
-- record_operational_alert_sent() (0092) - are all `security definer` and
-- were all granted `execute` to `anon` AND `authenticated`, the same two
-- roles PostgREST exposes every Supabase RPC call to using nothing but the
-- app's own public anon key (shipped in the client bundle by design, not a
-- secret - the exact framing migration 0108's own header comment, for the
-- sibling function lifecycle_unsubscribe_token_for(), already establishes).
--
-- A 2026-10-31 pass (Finding 110's own write-up) looked at exactly these 4
-- functions already, but under a different question - "does this leak
-- another tenant's data to a caller who doesn't own it" - and correctly
-- found no such leak (they're insert-only, nothing sensitive is read back),
-- so it noted them and moved on: "insert-only with no sensitive read, so an
-- ownership check doesn't apply the same way - noted, not flagged as a new
-- item." That's the right answer to THAT question. It is not the only
-- question an anon-reachable write-only function raises: notification_claims
-- (0093) is a bare `idempotency_key text primary key` with no delete/expiry
-- path at all, and this whole engine's entire design - documented in 0093's
-- own header, and the subject of this doc's own repeatedly-fixed "claim a
-- one-time-ever token too early" bug class - depends on a successful claim
-- meaning the real send either already happened or is about to. An anon
-- caller doesn't need to read anything back to do real damage: they only
-- need to WRITE a claim before the real sender ever tries to, which
-- permanently and silently burns that exact future notification for good,
-- with no retry and no error anywhere (by design - that's what "already
-- sent, do nothing" means for every real caller too).
--
-- Concretely reachable, not theoretical: scripts/send-founder-digest.ts's
-- own idempotency key is `founder-digest-${sastDateKey}` - an ISO date
-- string, zero secret/UUID material, 100% guessable in advance for any
-- future date. Anyone holding the app's public anon key (everyone) can call
-- `rpc("claim_notification", {p_idempotency_key: "founder-digest-2026-12-25",
-- p_notification_type: "founder_daily_digest"})` directly against the
-- Supabase REST endpoint today, for any date they like, and permanently
-- suppress the founder's own daily digest for that day with nothing to show
-- it ever happened. The other 3 functions carry the identical risk for
-- whichever of their own UUID-keyed notification types has its
-- company_id/tender_id learned or guessed some other way - a smaller but
-- real window, not zero, and the fix is the same one line either way.
--
-- None of the 4 functions has a genuine anon-context caller to preserve:
-- grepped every real call site across app/ - all four are called either (a)
-- from app/scripts/*.ts cron jobs, every one of which authenticates with
-- SUPABASE_SERVICE_ROLE_KEY (confirmed by reading each script's own `main()`
-- - a role that bypasses every grant/revoke here entirely, the same reason
-- migration 0108 gives for why lifecycle_unsubscribe_token_for() never
-- needed its own anon/authenticated grant to work), or (b) from
-- app/app/admin/notifications/actions.ts's sendTestNotificationEmail(),
-- which redirects to /login unless `supabase.auth.getUser()` already
-- returns a signed-in user - genuinely `authenticated`, never `anon`. No
-- other Server Action, API route, or SQL function calls any of these 4.
-- Revoking `anon` leaves every real, currently-working caller unaffected.
--
-- Reproduced directly in a scratch Postgres 16 database (not this app's
-- live DB; dropped immediately after both runs), replaying the real table +
-- function + grant verbatim from 0093: before this fix, `set role anon;
-- select claim_notification('founder-digest-2026-11-07',
-- 'founder_daily_digest')` returned `true` - a bare anon session, no login,
-- successfully pre-claiming tomorrow's founder digest - and a second,
-- `authenticated`-role claim of the identical key immediately after (the
-- real cron's own future attempt) correctly came back `false`, i.e. already
-- burned. After this revoke, the identical `set role anon; select
-- claim_notification(...)` raises `insufficient_privilege` instead, while
-- `set role authenticated; select claim_notification(...)` on a fresh key
-- still returns `true` exactly as before - the one real webapp caller is
-- unaffected.

revoke execute on function claim_notification(text, text) from anon;
revoke execute on function record_notification_sent(text, text, text, uuid, uuid, text, text, text, text) from anon;
revoke execute on function record_deadline_reminder_sent(uuid, uuid, int) from anon;
revoke execute on function record_operational_alert_sent(text, uuid, uuid, text) from anon;

comment on function claim_notification(text, text) is
  'Atomic "has this exact notification already been sent" gate - one row per idempotency_key, inserted by claim_notification() before any send is attempted. notification_type is denormalised here (not just in notification_logs) purely so a stuck/abandoned claim is diagnosable by type without a join. `authenticated` only (0119) - every real caller is either a service-role script (bypasses grants entirely) or a signed-in admin test-send; granting `anon` let anyone holding the app''s public key permanently pre-claim and so silence a future real notification, with nothing to show it happened.';
