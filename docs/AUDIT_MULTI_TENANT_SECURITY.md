# Multi-Tenant Security & Enterprise-Readiness Audit

**Date:** 2026-10-24
**Scope:** Row-Level Security / tenant isolation, API & server-action authorization, document
storage isolation, background worker & scheduled-job health — across the full current schema
(80 migration files, through `0090_submission_logistics.sql`).
**Method:** Not a read-of-the-code-only pass. Every RLS claim below was checked against a real,
disposable Postgres 16 instance with every migration replayed in order
(`engine/security/replay_schema.sh`), then verified by actually running the project's own
adversarial cross-tenant test suite (`engine/security/test_tenant_isolation.py`, 18 attack-scenario
cases) against that live schema — not just read. Every table's RLS/policy state below was queried
directly from `pg_class`/`pg_policy`/`pg_proc` on that replayed database, not grepped from
migration files (a grep can be wrong when a later migration redefines something; a live query
cannot).
**This is a read-only audit.** No application code, migration, or UI file was changed to produce
it. This file is the only new artifact.

**Relationship to the existing audit.** `docs/specs/POPIA-Security-Audit.md` (2026-10-17/18) is
the prior formal audit. It is authoritative for its own scope but stops at migration `0045` — this
schema is now at `0090` (35 more migrations: company subscriptions, PayFast payments, savings
counter, narrative documents, submission logistics, platform admin console expansions, employee
role, and more). This document re-verifies that audit's conclusions still hold on the *current*
schema and extends coverage to everything added since. It does not repeat that document's POPIA
legal-compliance section (section 6 there) or its paperwork action items (section 7, Sarel's own
actions) — those stand as written.

---

## 1. Executive Summary

| Area | Verdict | Basis |
|---|---|---|
| RLS enabled on every table | 🟢 **PASS** | 63/63 tables in `public` have `rowsecurity = true`. Zero exceptions, live-queried. |
| Tenant-boundary enforcement (company A cannot read/write/infer company B's data) | 🟢 **PASS** | Full 18-case adversarial suite (cross-tenant reads, inserts, storage, admin bypass, deletion, employee-role scoping) run against a real Postgres with all 80 migrations replayed: **ALL PASSED**, zero failures. |
| Service-role bridge bypass (the one way RLS itself is routinely bypassed, by design, for background workers) | 🟢 **PASS** | The 7 historical exfiltration paths this exact failure mode produced (POPIA audit, section 2) remain closed under the current schema; the newest service-role bridge added since that audit (`engine/narrative/`) was independently checked and does not introduce the same class of leak. |
| API routes / server actions | 🟢 **PASS** | Only 2 Next.js API routes and 21 server-action files exist. Authorization is consistently delegated to RLS or to `SECURITY DEFINER` functions that check `is_company_member()` / `is_platform_admin()` themselves — verified by reading every admin and payment-adjacent one, not assumed. |
| Document storage isolation | 🟢 **PASS** | All 9 Storage buckets are `public = false`. Cross-company object listing/read/write is refused — confirmed live in the test suite (case 10), not just by reading policy SQL. |
| Background worker / scheduled job health | 🟡 **WARNING** | Design is sound (per-item failure isolation, `system_alerts` instead of silent drops, safe no-op when secrets are missing) but one real production outage already happened this week and one workflow's timeout is an unverified estimate. Not a tenant-isolation issue — flagged for completeness since it was explicitly in scope. |
| Hygiene regression | 🟡 **WARNING** | Two `SECURITY DEFINER` functions reintroduce a `search_path` gap this project explicitly closed once already (migration `0074`). Not currently exploitable (see Finding 1), but it is a drift from an established, deliberate hardening convention. |

**No CRITICAL findings.** No path was found by which Company A can read, write, or infer Company
B's tender prices, CVs, draft methodologies, vault documents, or any other tenant-owned data. The
two WARNING items are real but low-severity and already explained below with exact locations.

---

## 2. Table-by-table RLS matrix (live-queried, all 63 tables)

"Tenant scoping" describes the real mechanism in force, not an assumption. `true` as a `SELECT`
qualifier below means "every signed-in user may read this table" — this is only marked safe where
the table holds no per-company confidential data (shared taxonomy/reference/public-tender data),
confirmed per-row against each migration's own stated intent.

| Table | RLS on | Policies | Tenant scoping |
|---|---|---|---|
| `companies` | ✅ | 3 | `is_company_member(id)`; own-row only |
| `company_members` | ✅ | 1 | membership row itself |
| `company_invites` | ✅ | 1 | `company_id` |
| `bank_accounts` | ✅ | 2 | `company_id`, owners/admins only |
| `company_document_templates` | ✅ | 2 | `company_id` |
| `company_offices` | ✅ | 2 | `company_id` |
| `company_principals` | ✅ | 2 | `company_id` |
| `company_properties` | ✅ | 2 | `company_id` |
| `property_documents` | ✅ | 2 | `company_id` |
| `held_registrations` | ✅ | 2 | `company_id` |
| `company_subscriptions` | ✅ | 1 | `company_id`, select-only for members (writes are RPC-only) |
| `company_tender_preferences` | ✅ | 3 | `company_id` |
| `people` | ✅ | 2 | `company_id` |
| `projects` | ✅ | 2 | `company_id` |
| `experience_items` | ✅ | 2 | `company_id` |
| `cv_uploads` | ✅ | 2 | `company_id` |
| `generated_cvs` | ✅ | 2 | `company_id` |
| `cv_extraction_results` | ✅ | 3 | `company_id` + same-company CV-upload check |
| `person_role_eligibility` | ✅ | 2 | `company_id` |
| `pack_generation_jobs` | ✅ | 5 | `company_id` |
| `pack_review_confirmations` | ✅ | 2 | `company_id` |
| `tender_pack_assignments` | ✅ | 2 | join to `tender_packs.company_id` |
| `tender_packs` | ✅ | 4 | `company_id` |
| `tender_private_documents` | ✅ | 4 | `company_id` |
| `tender_documents` | ✅ | 1 | `company_id` nullable = shared buyer copy; see §5 below |
| `tender_requirements` | ✅ | 1 | `company_id` nullable, same shared/own split |
| `tender_answers` | ✅ | 2 | `company_id` |
| `tender_comments` | ✅ | 4 | `company_id` |
| `tender_tasks` | ✅ | 2 | `company_id` |
| `tender_subcontracting_plans` | ✅ | 2 | `company_id` |
| `signatory_scopes` | ✅ | 2 | `company_id` |
| `financial_captures` | ✅ | 2 | `company_id` |
| `generated_documents` | ✅ | 2 | `company_id` |
| `narrative_documents` | ✅ | 2 | `company_id`, employee-no-access restrictive policy |
| `savings_counted_steps` | ✅ | 1 | `company_id` |
| `onboarding_uploads` / `onboarding_document_results` | ✅ | 3 each | `company_id` |
| `discipline_category_suggestions` | ✅ | 5 | `company_id` (suggesting company) |
| `requirement_extraction_reviews` | ✅ | 1 | platform-admin read only |
| `field_provenance` | ✅ | 2 | join to `tender_packs.company_id` |
| `discovered_opportunities` | ✅ | 2 | `company_id` (per-company scored row) |
| `discovery_seen_releases` | ✅ | 2 | `company_id` |
| `deadline_reminders_seen` / `digest_readiness_seen` | ✅ | 2 each | `company_id` |
| `tender_update_notifications` | ✅ | 2 | `company_id` |
| `tenders` | ✅ | 2 | shared buyer table; `owner_company_id` null = public, set = private to that company |
| `tender_watched_documents` | ✅ | 2 | join to `tenders.owner_company_id`, same public/private rule |
| `discovered_opportunity_documents` / `_requirements` | ✅ | 1 each | **not** per-company by design — keyed by `release_key`, the buyer's own published documents for a release everyone sees discovered, never a company's confidential content (0071's own header comment). Readable by every authenticated user; correct, not a leak. |
| `discipline_categories` / `registration_types` / `tender_roles` / `tender_scope_records` / `public_tender_outcomes` / `tender_listing_changes` / `tender_listing_snapshots` | ✅ | varies | genuine shared/global reference or published-outcome data, `true`/platform-admin-write. Not company data. |
| `admin_harness_runs` | ✅ | 2 | platform-admin only |
| `platform_admins` | ✅ | **0** | service-role only, by design (bootstrap table; see POPIA audit §3) |
| `platform_settings` | ✅ | **0** | service-role / platform-admin-RPC only, never queried directly from app code (confirmed by repo-wide grep) |
| `payfast_payment_attempts` | ✅ | **0** | written only via `SECURITY DEFINER` RPCs granted to `anon`, called only after the ITN webhook independently verifies PayFast's signature + server confirmation (see §4) |
| `sent_deadline_reminders` / `tender_watch_state` | ✅ | **0** | backend bookkeeping for the cron scripts; never queried from `app/` client/server code (confirmed by grep) |
| `system_alerts` | ✅ | 2 | platform-admin read/resolve only |

**Zero tables** have RLS disabled. **Zero** policies use an unconditional `true` on a table holding
per-company confidential data — every `true` policy above was individually traced to a genuinely
shared/global table.

---

## 3. Live adversarial test result (not merely "policies exist")

Ran directly against the current schema, for this audit, today:

```
engine/security/replay_schema.sh -d tenant_iso           # all 80 migrations replay clean
TENANT_PSQL="psql -d tenant_iso" python3 engine/security/test_tenant_isolation.py
```

Result: **ALL PASSED** — all 18 cases, covering:
- the 7 historical service-role-bridge exfiltration paths (SANRAL pack, CV bridge, CV extraction,
  general pack, field provenance) — still closed;
- direct cross-company `INSERT` attempts on 15 tables — all refused by RLS;
- cross-company Storage object read/write on all buckets — all refused;
- private (non-public) tender visibility — company B's manual tender invisible to company A;
- cross-company foreign-key references and storage-path check constraints (the "what a row may
  point at" class of bug) — all refused, including a `../` path-traversal probe;
- the shared-vs-own-copy template system (migration `0045`) — no cross-company template/position
  leak in either direction;
- the `platform_admins` admin console — a company owner gets zero admin access;
- data-subject deletion (POPIA s24) — a person/user can be deleted without orphaning data or
  leaking it into another company's rankings;
- the restricted **employee** role (migration `0077`) — an employee sees only their own record,
  nothing of a colleague's, nothing company-wide, and no more than a `member` would of another
  company.

This is the same test the project's own CI (`bridge-worker-ci.yml`, job `tenant-isolation-db`)
runs on every push touching `engine/**` or `app/supabase/migrations/**` — this audit independently
re-ran it rather than trusting that CI's last green run, and got the same result.

---

## 4. API & server-action authorization audit

The whole application surface here is small: **2** Next.js API routes and **21** server-action
files (`app/app/**/actions.ts`).

- **`app/app/api/billing/payfast/itn/route.ts`** (the one route that accepts unauthenticated,
  internet-facing POSTs — PayFast's own webhook, no Supabase session exists here by design) does
  all three of PayFast's documented ITN checks, in order, failing closed: signature
  (`lib/payfast.ts:169` `verifyItnSignature`), source-IP-resolves-to-PayFast's-own-hostnames, and
  server-side confirmation against PayFast's own `/eng/query/validate` endpoint requiring the
  literal response `"VALID"`. Only after all three pass does it call the narrow `SECURITY DEFINER`
  RPC `apply_payfast_itn`, which matches on a server-generated, unguessable `m_payment_id` scoped
  to one company's one checkout attempt (`0083_finalize_pricing_tiers_and_usage_limits.sql:153`).
  No forged-webhook path to another company's subscription was found.
- **`app/app/api/billing/checkout/route.ts`** requires `supabase.auth.getUser()` before issuing
  anything, derives the company from the session (not from client input), and HTML-escapes every
  value it interpolates into the self-submitting redirect form.
- **Admin server actions** (`app/app/admin/**/actions.ts`): `admin/taxonomy/actions.ts` checks
  `is_platform_admin()` itself for a friendly error message, *and* every write goes through RLS or
  a `SECURITY DEFINER` function that checks it again. `admin/discovered-opportunities/actions.ts`
  and `admin/requirement-extractions/actions.ts` skip the friendly client-side check but their
  underlying RPCs (`platform_admin_override_opportunity_confidence`,
  `submit_requirement_extraction_review`) both `raise exception` on `not is_platform_admin()`
  themselves (`0072_platform_admin_discovered_opportunities.sql:129`) — confirmed by reading the
  function bodies, not assumed from the name. **Not a vulnerability**, but see Finding 2 for a
  minor consistency note.
- No debug or test-only route is reachable in production: `bridge-worker-ci.yml`'s container-build
  job confirms the worker image itself refuses to run with no Supabase credentials set (exit 1).
- `SUPABASE_SERVICE_ROLE_KEY` does not appear anywhere under `app/app/api` or `app/lib` — it is
  used only by the Python bridge workers and the scheduled-job scripts, never by the deployed
  Next.js app. The app talks to Supabase only with the anon key, under RLS. This matches the
  POPIA audit's own finding and still holds.

---

## 5. Document storage isolation

All 9 Storage buckets are created with `public = false`:
`cv-documents`, `experience-documents`, `company-documents`, `submission-packs`,
`tender-documents`, `admin-harness-artifacts`, `onboarding-documents`,
`discovered-tender-documents`, `narrative-documents`.

No bucket is public; there is no world-readable or anonymously-guessable object URL scheme in
this schema. Cross-company object access is enforced by per-bucket, path-prefix RLS policies on
`storage.objects` (e.g. `<company_id>/...`), and the live test suite's case 10 confirms, for every
bucket, that company A can neither list nor write into company B's prefix, and case 17 confirms
the same for the shared-template bucket's buyer-vs-own-copy split (migration `0045`, still correct
under the current schema).

CSD certificates, vault documents (tax clearance, insurance, B-BBEE, etc.), CVs, and generated
packs all live under one of these private, path-scoped buckets — none are exposed by a public URL.

---

## 6. Background worker & scheduled job health

Three scheduled GitHub Actions (`daily-digest.yml`, `daily-discovery.yml`,
`deadline-reminders.yml`) plus one always-on container (the bridge worker, covered by
`bridge-worker-ci.yml`, not itself a cron job).

**What's good:**
- Per-item failure isolation is real, not just claimed: a bad recipient address, one government
  source being down, or one malformed job does not fail the whole run — it is logged and/or
  recorded as a `system_alerts` row (visible on `/admin`), confirmed by reading
  `send_digest_emails.py`, `gov_sources.py`'s per-source `try/except`, and
  `engine/alerts/test_system_alerts.py`.
- Missing secrets degrade safely: `daily-digest.yml` and `deadline-reminders.yml` both exit 0 and
  log "built but not sent" rather than crashing or silently claiming success, if `RESEND_API_KEY`
  is absent.
- `concurrency: cancel-in-progress: false` on all three — a running send/scoring pass is never cut
  off mid-batch by an overlapping scheduled trigger.
- The one genuinely alarming failure mode — a missing Python dependency (`lxml`) silently losing
  an entire day's digest and discovery run on 2026-10-24 — has already happened once, was already
  diagnosed and fixed (both workflow files now `pip install lxml==6.1.3` at a pinned version:
  `daily-digest.yml:119`, `daily-discovery.yml:110`), and this audit independently confirmed the
  fix is still present in both files today, not just trusting the earlier commit message.

**What's not fully nailed down (Finding 3 below):** `daily-discovery.yml`'s `timeout-minutes: 90`
and `daily-digest.yml`'s `timeout-minutes: 120` are both stated in their own comments to be
estimates, not confirmed measurements from a real completed scheduled run. Neither workflow has
failed on a timeout yet, but this is unverified headroom, not a verified one.

---

## 7. Findings

### Finding 1 — `search_path` hardening regression (LOW severity, not currently exploitable)

- **File:** `app/supabase/migrations/0089_opportunity_tags_interest.sql:42-43` and `:82-83`
- **Functions:** `set_opportunity_tag(uuid, text, text)`, `set_opportunity_interest(uuid, text)`
- **Issue:** Both are `SECURITY DEFINER` with `set search_path = public` only. Confirmed live
  against `pg_proc` on the replayed schema: of this schema's **51** `SECURITY DEFINER` functions,
  these are the only **2** missing `pg_temp` from that setting. This is the exact gap migration
  `0074_search_path_consistency.sql` was written to close for two *other*, earlier functions
  (`discipline_category_suggestions_guard`, `acknowledge_discovery_downgrade`) — `0074`'s own
  comment states plainly "NOT a live exploit... an inconsistency, not a reopened hole, but worth
  closing so every function in this schema follows the exact same convention." `0089` (written
  after `0074`) reintroduced the same inconsistency in two new functions.
- **Why it's not currently exploitable:** both functions only read/write
  `discovered_opportunities` by `id`, qualify every reference inside their own body, and call no
  unqualified helper that a search-path-hijack could plausibly shadow in this schema today. Risk
  is latent (schema hygiene / defense-in-depth), not active.
- **Recommendation:** a new migration (do not edit `0089` in place — this project's own standing
  rule against editing an already-possibly-live migration) adding, mirroring `0074` exactly:
  ```sql
  alter function set_opportunity_tag(uuid, text, text) set search_path = public, pg_temp;
  alter function set_opportunity_interest(uuid, text) set search_path = public, pg_temp;
  ```

### Finding 2 — Inconsistent client-side admin pre-check (INFORMATIONAL, not a vulnerability)

- **Files:** `app/app/admin/discovered-opportunities/actions.ts`,
  `app/app/admin/requirement-extractions/actions.ts`
- **Issue:** Unlike `app/app/admin/taxonomy/actions.ts`'s `requireAdmin()` helper, these two call
  their RPC directly after only `auth.getUser()`, relying entirely on the RPC's own
  `is_platform_admin()` check (confirmed present in both:
  `0072_platform_admin_discovered_opportunities.sql:129`,
  `0074_search_path_consistency.sql`-era `submit_requirement_extraction_review`). A non-admin
  calling either gets a generic RPC error instead of a friendly message — a UX inconsistency, not
  an authorization gap.
- **Recommendation:** optional, low priority — adopt the same `requireAdmin()` pattern for a
  clearer error message. No security action required.

### Finding 3 — Unverified scheduled-job timeout headroom (LOW, operational)

- **Files:** `.github/workflows/daily-digest.yml:90` (`timeout-minutes: 120`),
  `.github/workflows/daily-discovery.yml:85` (`timeout-minutes: 90`)
- **Issue:** Both values are explicitly documented in-file as estimates derived from a single
  partial/interrupted manual run, not a completed scheduled run's measured wall-clock time.
- **Recommendation:** once each workflow has completed a real scheduled run end-to-end, record its
  actual duration and tighten (or confirm) the timeout from measurement rather than estimate.

### Finding 4 — Formal audit document is 35 migrations stale (INFORMATIONAL)

- **File:** `docs/specs/POPIA-Security-Audit.md`
- **Issue:** Explicitly scoped to migrations through `0045`; schema is now at `0090`. This document
  (`AUDIT_MULTI_TENANT_SECURITY.md`) extends live-verified coverage through the current schema, but
  does not replace that document's POPIA legal-compliance assessment (its §6) or Sarel's own
  outstanding paperwork action items (its §7) — those remain open exactly as that document states.
- **Carried forward, still open, not newly found by this audit:** no download audit trail for
  Storage objects; a user belonging to two companies has an untested UI path (not a cross-tenant
  leak, since the user genuinely belongs to both); orphaned pre-`0045` template objects in Storage
  are hidden but not deleted; this schema's RLS has still never been verified against a live
  Supabase project, only against a replayed local Postgres (POPIA audit's own Gap #9).

---

## 8. Recommended remediation, in priority order

1. **(5 minutes, no risk)** Land a small migration pinning `search_path = public, pg_temp` on
   `set_opportunity_tag` and `set_opportunity_interest`, per Finding 1. Mirrors an already-accepted
   pattern (`0074`) exactly; purely additive, no behavior change.
2. **(No code change, process only)** Once `daily-digest.yml` / `daily-discovery.yml` have each
   completed one real scheduled run, record the actual duration in the workflow's own comment and
   confirm or tighten `timeout-minutes` (Finding 3).
3. **(Optional, cosmetic)** Add a `requireAdmin()`-style client-side check to the two admin actions
   named in Finding 2, purely for a friendlier error message — not required for security.
4. **(Carried forward, Sarel's own call, not newly raised here)** The still-open items already
   listed in `docs/specs/POPIA-Security-Audit.md` §7 (download audit trail, retention periods,
   POPIA paperwork, live-Supabase verification) remain exactly as open as that document states —
   this audit found nothing that changes their status.

No action in this list is urgent in the sense of an active exploit. Items 1 and 3 are safe to batch
into a routine migration whenever one is next cut; item 2 just needs a real scheduled run to
happen and someone to glance at its duration afterward.
