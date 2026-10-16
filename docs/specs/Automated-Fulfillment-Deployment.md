# Automated fulfilment: keeping the document bridges running

Written 2026-10-16. Status: **the worker is built and tested locally. It is not deployed.**
Deploying it needs Sarel's own Railway account and the Supabase keys. Neither exists yet.

## The problem

Sarel wants SANRAL tenders to run end to end "without any manual input besides answering all
necessary questions needed for the tender."

The web app is Next.js on Vercel. Vercel functions can't run Python or LibreOffice, and the
document engines need both. That limit is permanent. So the app never builds a document
itself. It inserts a request row, and a separate Python bridge script fulfils it:

| Queue table | Bridge script | Status |
| --- | --- | --- |
| `generated_cvs` (migration `0008`) | `engine/cv/process_cv_jobs.py` | Exists |
| `pack_generation_jobs` (migration `0017`) | `engine/pack/process_pack_jobs.py` | Another agent is building it. When this was written, `0017` and `engine/pack/assemble_pack.py` / `pdf_merge.py` / `harness_pack.py` were in the working tree uncommitted, and `process_pack_jobs.py` didn't exist yet |

Until now, a person had to run each bridge by hand. That is manual input Sarel didn't ask for.
What's fixable is who starts the bridge, not where the documents get built.

## What was built

1. **`engine/worker/poll_loop.py`**: one polling loop, shared by every bridge. It polls, sleeps
   for the interval (default 30 s), and repeats.
   - If a poll fails (say Supabase blips), it logs the error and tries again next cycle. The
     old hand-written loop in `process_cv_jobs.py` had no error handling, so one failed HTTP
     call ended the process.
   - On SIGTERM or SIGINT (what Railway, Docker and systemd send on redeploy or stop), it
     finishes the current job, then exits. It wakes from a sleep straight away.
2. **`process_cv_jobs.py --loop` (alias `--daemon`), plus `--interval N` and `--max-cycles N`.**
   The default is one-shot: process the queue once and exit. `--once` still works exactly as
   before.
   - **This changes the no-flag default.** Before, running it with no flag looped forever,
     sleeping a hard-coded 30 s, and only `--once` exited. Nothing in the repo ran it without
     `--once` (checked with grep). A cron entry running it with no flag would have started a
     new, never-ending process every time.
3. **Atomic job claim in `process_cv_jobs.py`.** A job moves from `requested` to `generating`
   only while it's still `requested`. If another worker already took it, it's skipped. So a
   hosted worker and a hand-run `--once` can overlap without building the same CV twice.
   Empty polls no longer print a log line in loop mode.
4. **`engine/worker/run_bridges.py`**: one process runs every bridge, every cycle. This is what
   the worker container runs (`--loop`).
   - Each bridge runs as `python3 <script> --once` in its own subprocess. So the runner
     doesn't need the pack bridge's internal function names, and a crash in one bridge can't
     take down the other.
   - The bridges are registered by name (`cv`, `pack`). `--script PATH` adds any other
     script that supports `--once`.
   - A bridge whose file doesn't exist yet is skipped, logged once, and checked again every
     cycle.
   - Each bridge pass times out after 30 minutes.
5. **`engine/worker/Dockerfile`** (+ `requirements.txt`, root `.dockerignore`): the always-on
   worker image.
   - Python 3.13-slim, plus `libreoffice-writer-nogui` and metric-compatible fonts.
   - The engine code and `templates/`.
   - Runs as a non-root user. Starts with `run_bridges.py --loop`.
6. **`.github/workflows/bridge-worker-ci.yml`**: CI only. On engine changes it runs the
   smoke test and the CV self-test, then builds the image and checks that the runner starts in
   it. It needs no secrets and doesn't fulfil real jobs. See below for why the worker itself
   isn't a GitHub Action.
7. **`engine/worker/test_poll_loop.py`** + **`fake_supabase.py`**: the smoke test (see
   Verification). The fake is a small in-memory stand-in for the Supabase REST and Storage
   calls the CV bridge makes. It's used only by the test.

### Pointing it at the pack bridge

If `process_pack_jobs.py` lands at `engine/pack/process_pack_jobs.py` and supports `--once`
(exit 0 = the pass ran, non-zero = the pass itself broke), there's nothing to do. The runner
already looks for it there, and the deployed worker picks it up on the next deploy. Railway
redeploys on every push to `main`.

If it lands at a different path, change `BRIDGES["pack"]` in `run_bridges.py`. If it has no
`--once`, add one: that's the contract. If it needs Python packages beyond python-docx, PyYAML
and pypdf, add them to `engine/worker/requirements.txt`. `pypdf` is already there because
`engine/pack/pdf_merge.py` imports it. The pack bridge should also claim jobs atomically, the
same way `claim_job()` does. Its migration comment says it "claims" them.

## The options, with evidence

| Option | Cost | Latency | Verdict |
| --- | --- | --- | --- |
| **(a) Always-on worker on Railway** (Hobby plan), running the Dockerfile above | $5/month, which includes $5 of usage (railway.com/pricing, read 2026-10-16). RAM is about $10/GB-month and CPU about $20/vCPU-month. Idle, the container used **9 MiB and 0% CPU** in the local test, so normal use should stay inside the included $5 | ~30 s (the poll interval) | **Recommended** |
| (a2) The same container on Render, Fly.io or a small VPS | Not verified. Render's pricing and background-worker pages didn't show a price when fetched today. Fly and VPS prices weren't checked | ~30 s | Works the same way, because it's a plain Dockerfile. Fallback if Railway doesn't suit |
| (a3) The same `run_bridges.py --loop` on Sarel's own always-on PC | Free | ~30 s, but only while that PC is on and online | Fine as a stopgap. Needs Python, LibreOffice and the two env vars on that machine |
| (b) GitHub Actions on a schedule (cron) running `run_bridges.py --once` | The repo is **public** (checked with `gh api`), so runner minutes are free | **5 minutes at best.** GitHub's docs say scheduled runs "can be delayed during periods of high loads" and "some queued jobs may be dropped". Each run also has to install LibreOffice first | **Not built.** See below |
| (c) GitHub Actions started per request (a Supabase Database Webhook calling `repository_dispatch`) | Free on a public repo | About 1–2 min (runner start plus LibreOffice install) | **Not built.** Same terms problem as (b). It also needs a GitHub token stored in Supabase, and a webhook per queue table |
| (d) Supabase Edge Functions or Vercel Cron | Free tier | n/a | **Not viable.** Edge Functions are Deno and Vercel functions can't run LibreOffice. That's the original constraint |

### Why the worker isn't a GitHub Action

The brief expected the GitHub Action to be the buildable option. These facts, checked on
2026-10-16, ruled it out:

- **GitHub's own terms.** GitHub's Additional Product Terms say Actions should not be used for
  "Any activity that places a burden on our servers, where that burden is disproportionate to
  the benefits provided to users". They give the example "don't use Actions as a content
  delivery network or **as part of a serverless application**". For GitHub-hosted runners
  they also exclude "any other activity unrelated to the production, testing, deployment, or
  publication" of the project. A job queue polled every 5 minutes to serve a live web app's
  users is a serverless backend. Building Sarel's production path on that is a real risk:
  GitHub can disable Actions on the repo.
- **It switches itself off.** "In a public repository, scheduled workflows are automatically
  disabled when no repository activity has occurred in 60 days." Once development slows, CV
  and pack generation would stop without warning.
- **Latency.** The fastest schedule is every 5 minutes. Runs can be delayed or dropped, and
  each run reinstalls LibreOffice. Answering the tender questions and then waiting 5 to 15
  minutes for a CV is not "automatic" in the sense Sarel means.

What was built for GitHub Actions is the legitimate use: CI that tests and builds the worker
on every engine change.

## Recommendation

**Deploy `engine/worker/Dockerfile` as a Railway service on the Hobby plan ($5/month), running
`run_bridges.py --loop` all the time.**

Why this one, for a solo operator:

- **Cheapest always-on option with a confirmed price.**
- **Nothing to maintain:** no server to patch, no cron to babysit. Railway rebuilds from GitHub
  on every push to `main`, so when the pack bridge lands it goes live on its own.
- **About 30 seconds from request to document.**
- **Two settings only:** the Supabase URL and the service-role key.
- **Not tied to Railway.** It's a standard Dockerfile, so moving to Render, Fly or a VPS later
  means pointing that host at the same file.

A note on Railway's own config: Railway's `railway.json` "config as code" is deprecated
(Railway's docs say existing files work for legacy services until 2026-12-01). So no
`railway.json` is committed. The Dockerfile path is set as a variable instead (step 4 below).

## What Sarel needs to do (once Supabase is live)

This can't be done from this sandbox. It needs your own accounts and keys.

1. **Get the two Supabase values.** In the Supabase dashboard, go to Settings → API. Copy the
   Project URL and the `service_role` key. The service-role key bypasses all security rules, so
   only ever paste it into Railway's variables screen. Never into code, a chat or a commit.
2. **Create a Railway account** at railway.com and choose the Hobby plan ($5/month, card
   needed). The free trial ($5 credit for 30 days) is enough to test first.
3. **New Project → Deploy from GitHub repo → `SarelJvR2024/tender-tool`.** Give Railway
   access to that repo when asked.
4. **In the new service's Variables tab, add:**
   - `RAILWAY_DOCKERFILE_PATH` = `engine/worker/Dockerfile`
   - `NEXT_PUBLIC_SUPABASE_URL` = the Project URL from step 1
   - `SUPABASE_SERVICE_ROLE_KEY` = the service-role key from step 1
   - optional: `BRIDGE_POLL_INTERVAL` = `30` (seconds; the default)
5. **Don't add a domain or port.** This is a background worker. It only calls out to Supabase.
6. **Deploy, then open the service's logs.** You should see
   `run_bridges: polling every 30s`. Until the pack bridge is committed, you'll also see
   `pack: engine/pack/process_pack_jobs.py not present yet, skipping`.
7. **Test it:** request a CV from a person's page or the Tender Workspace. Within about a
   minute it should show as ready, and the logs should show a `cv: [ready] ...` line.

To stop it, remove or pause the service in Railway. Nothing else depends on it: requests just
wait in the queue until it's running again.

## Verification (2026-10-16, in this sandbox, no live Supabase)

- **The loop really loops (unit test).** `poll_forever` with a recording sleep:
  - job A is handled on cycle 1, then the loop sleeps 45 s;
  - job B, inserted *during* that sleep, is handled on cycle 2;
  - cycle 3 raises a simulated connection error, which is logged and survived;
  - job C is handled on cycle 4;
  - sleeps were `[45, 45, 45]`, with no sleep after the last cycle.
- **End to end, as a real subprocess.** `process_cv_jobs.py --loop --interval 3 --max-cycles 3`
  ran against the fake Supabase:
  - j1 became ready;
  - j2 was inserted while the worker slept, and became ready on cycle 2, about 4.7 s later;
  - exactly 3 queue polls were made, no "No pending" noise, and the process exited cleanly;
  - real `.docx` files were built and uploaded.
- **Atomic claim.** A row already `generating` is skipped: nothing is built or uploaded.
- **Runner.**
  - It fulfilled a CV job.
  - It skipped the missing pack bridge, logging that once rather than every cycle.
  - A bridge that exits 2 was logged, and the loop carried on.
  - SIGTERM in the middle of a 60 s sleep stopped it in under a second.
- **The container image was built locally and run against the fake Supabase.**
  - Job 1 was ready 3 s after start. Job 2, inserted while the worker slept, was ready 4.4 s
    later.
  - Both **`.docx` and `.pdf`** were uploaded, so LibreOffice works inside the image.
  - Idle use was 9 MiB RAM and 0% CPU.
  - `docker stop` took 0.1 s, with exit code 0 and `stopped (signal)` in the logs.
  - With no credentials, `run_bridges.py --once` inside the image exits 1 with the "set
    NEXT_PUBLIC_SUPABASE_URL..." message.
  - Sandbox-only difference: this sandbox's HTTPS proxy needs its CA certificate, and Docker
    Hub rate-limited the pull. So the local build used a scratch copy of the Dockerfile with
    the proxy CA added and the base image pulled from `mirror.gcr.io`. The committed
    Dockerfile has neither.
- **One-shot behaviour unchanged.** The same 3-job queue (standard CV, tender CV, and a job for
  a missing person) was run through the old and new code, with `--once` and with no flag:
  - stdout, exit code, final row states, uploaded files and local files were all
    **identical**;
  - `--self-test` output was identical;
  - the no-credentials error and exit code 1 were identical;
  - the request sequence has the same 21 calls, with two deliberate differences: the queue
    read adds `&order=requested_at.asc` (oldest first), and the claim adds
    `&status=eq.requested` (atomic claim).
- **Workflow:** `actionlint` clean; the YAML parses.

Re-run with: `python3 engine/worker/test_poll_loop.py` (about 20 s).

## Not yet automatic, or not yet known

- **Nothing is deployed.** Until Sarel does the steps above, requests sit in `requested`.
  Running `python3 engine/worker/run_bridges.py --loop` on any machine with Python,
  LibreOffice and the two env vars is the stopgap.
- **Never run against a real Supabase project** (System-Status Gap #9). The REST calls follow
  the existing pattern. The conditional-PATCH claim relies on PostgREST returning the updated
  rows (`Prefer: return=representation`, which the script already sends). That's standard
  PostgREST behaviour, but it hasn't been seen against a live project.
- **A job can get stuck in `generating`.** If the worker is hard-killed mid-job (out of memory,
  host crash; a normal SIGTERM is handled), the row stays `generating` forever.
  `generated_cvs` has no "started at" column, so the worker can't tell a stuck job from a slow
  one. The fix is a small migration (a `claimed_at` column) plus a reclaim rule. That wasn't
  done here, to avoid a migration-number collision with the concurrent `0017` work. Until
  then, reset a stuck row to `requested` by hand in the Supabase table editor.
- **The pack bridge itself** isn't running yet. See "Pointing it at the pack bridge" above.
- **Log privacy.** CV log lines include the person's name, because it's part of the storage
  path. Railway logs are private to the account. Don't forward them anywhere public. (The CI
  workflow only ever sees the fake test person.)
