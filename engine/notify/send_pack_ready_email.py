"""
Bid Pack Compilation Complete email (notification engine migration,
2026-10-27, item B12). Called by engine/general/process_general_jobs.py
right after a generate_pack job's status flips to "ready".

Architecture (Sarel's own explicit decision, 2026-10-27): Python sends via
Resend's own HTTP API directly - instant delivery matters here, teams are
often working against tight courier/print deadlines, so this does not wait
for a scheduled script's next run. The one canonical branded template still
lives in TypeScript (lib/emailTemplatesTier1.ts's packReadyEmail) - never
duplicated as a second, driftable HTML string in Python - rendered via a
subprocess call to scripts/render-pack-ready-email.ts, a thin render-only
bridge with no Resend/Supabase access of its own.

Dedup + audit: the SAME notification_claims/record_notification_sent RPCs
every TypeScript sender already uses (migration 0093) - called here via
client.rpc(), not a second Python-only dedupe mechanism. Shows up in
/admin/notifications identically to every other notification type.

Recipients: every company_members email, with no daily_digest_opt_in
filter - same reasoning as lib/notificationRecipients.ts's own
criticalBidRecipients() (2026-10-30). That flag is the unrelated
"new tenders discovered" digest opt-in (migration 0073); filtering a
pack-ready notification on it would mean a company's own bidding team
silently never hears their pack - with its own tight courier/print
deadline - is ready, unless someone found and clicked a toggle labelled
"daily digest" (fixed 2026-11-07, standing review finding).

Never raises into the caller: a failure here (render, Resend, logging) must
not fail the pack job itself - the pack is real and already uploaded by the
time this runs, so the worst case is a missed/delayed email, not a lost
pack. Every failure is recorded as a system_alerts row instead.
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
_ALERTS_DIR = os.path.normpath(os.path.join(_HERE, "..", "alerts"))
if _ALERTS_DIR not in sys.path:
    sys.path.insert(0, _ALERTS_DIR)
import system_alerts  # noqa: E402

APP_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "app"))
RENDER_SCRIPT = os.path.join(APP_DIR, "scripts", "render-pack-ready-email.ts")
RESEND_URL = "https://api.resend.com/emails"

# Same WAF-block fix as engine/notify/send_digest_emails.py (standing
# solution-architect review, 2026-11-06) - this module's own
# urllib.request.Request had no User-Agent header either, so this
# instant-delivery "pack ready" send is exposed to the identical Resend
# edge block (confirmed live against the real endpoint: a bare urllib
# request with no User-Agent gets `HTTP 403 error code: 1010` even with a
# bogus key, before Resend's own auth layer is ever reached; adding any
# real User-Agent reaches it). See send_digest_emails.py's own comment for
# the full reproduction. This path is claimed via a one-time
# claim_notification() token before sending (see send_pack_ready_email()
# below), so a blocked send here would have permanently lost that pack's
# one and only "ready" email, not just delayed it.
USER_AGENT = "TenderTool-PackReady/1.0 (+https://tenderready.app)"


def _render(opts):
    """Invokes scripts/render-pack-ready-email.ts, returns {subject, html, text}. Raises on any failure - callers decide how to handle it."""
    result = subprocess.run(
        ["node", "--experimental-strip-types", RENDER_SCRIPT, json.dumps(opts)],
        cwd=APP_DIR, capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"render-pack-ready-email.ts exited {result.returncode}: {result.stderr[:500]}")
    return json.loads(result.stdout)


def _send_via_resend(to, subject, html, text):
    """Mirrors app/lib/resendEmail.ts's sendTransactionalEmail() for the "ops" sender profile - same env vars, same skip-not-fail rule for a missing key, same per-profile fallback (RESEND_FROM_BIDS -> this profile's own hardcoded default). Standing-review fix, 2026-11-09: this used to fall back to RESEND_FROM_ADDRESS (Tier 0's own address) when RESEND_FROM_BIDS was unset, then to a Tier-0-flavoured literal - but the real TS resolveFromAddress() (commit 80d4b6c, which predates this file) resolves each profile's env var independently with NO cross-profile fallback at all; an unset RESEND_FROM_BIDS falls straight to the "ops" profile's own hardcoded default ("Tender Ready Bids <bids@tenderready.app>"), never to RESEND_FROM_ADDRESS. The old chain here never matched that real behaviour, not even on day one - it would have silently sent a pack-ready (Tier 1/bids) email from the Tier 0 address, or an unbranded default, the moment RESEND_FROM_BIDS was ever unset while RESEND_FROM_ADDRESS was still set, a partially-configured state the TS side's own header comment explicitly documents as a supported degraded state."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return {"status": "skipped_no_api_key"}
    from_addr = os.environ.get("RESEND_FROM_BIDS") or "Tender Ready Bids <bids@tenderready.app>"
    reply_to = os.environ.get("RESEND_REPLY_TO") or "support@tenderready.app"
    body = json.dumps({"from": from_addr, "to": [to], "reply_to": reply_to, "subject": subject, "html": html, "text": text}).encode()
    req = urllib.request.Request(RESEND_URL, data=body, method="POST",
                                  headers={
                                      "Authorization": f"Bearer {api_key}",
                                      "Content-Type": "application/json",
                                      "User-Agent": USER_AGENT,
                                  })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
            return {"status": "sent", "resend_id": data.get("id", "")}
    except urllib.error.HTTPError as e:
        return {"status": "failed", "error": e.read().decode(errors="replace")[:500]}
    except Exception as e:  # noqa: BLE001 - genuinely any failure here must become "failed", never raise
        return {"status": "failed", "error": f"{type(e).__name__}: {e}"}


def send_pack_ready_email(client, job, page_count, app_url):
    """Best-effort - every failure is caught, logged as a system alert, and swallowed. Never raises: the pack job that just succeeded must not be turned into a failure by an email problem."""
    company_id = job.get("company_id")
    tender_id = job.get("tender_id")
    if not company_id or not tender_id:
        return
    try:
        # Checked BEFORE claiming, not after - same reasoning and same bug
        # class lib/notificationEngine.ts's own sendNotification() is
        # deliberately written to avoid (see its own header comment):
        # notification_claims is a one-time-only token, and this job will
        # never run again for this job id (no cron/retry re-invokes this
        # function once the pack is "ready"), so claiming it while
        # RESEND_API_KEY happens to be unset would permanently lose this
        # pack's one and only "ready" email, even once the key is added
        # later - QA pass, 2026-10-28.
        if not os.environ.get("RESEND_API_KEY"):
            print(f"RESEND_API_KEY not set - not sending or claiming pack-ready-{job['id']} "
                  "(would be lost forever once claimed with no key to send with).")
            return

        recipients_raw = client.rpc("company_notification_recipients", {"p_company_id": company_id})
        # NOT gated on daily_digest_opt_in - same reasoning as
        # lib/notificationRecipients.ts's own criticalBidRecipients()
        # (2026-10-30, used for corrigenda/returnables/closing-deadline
        # alerts): that flag is the "new tenders discovered" digest opt-in
        # only (migration 0073; app/app/company/Notifications.tsx's own
        # toggle is literally labelled "daily digest", default off), not a
        # general "do I want email from this company" switch. Found
        # 2026-11-07: this file was filtering on it anyway, so any company
        # member who never opted into the unrelated discovered-tenders
        # digest silently never got told their own bid pack - with its own
        # tight courier/print deadline, per this module's own header
        # comment - was ready.
        recipients = [r["email"] for r in recipients_raw if r.get("email") and "@" in r["email"]]
        if not recipients:
            return

        tenders = client.select("tenders", {"id": tender_id})
        tender = tenders[0] if tenders else {}
        companies = client.select("companies", {"id": company_id})
        company = companies[0] if companies else {}

        email = _render({
            "reference": tender.get("contract_no") or tender_id,
            "tenderTitle": tender.get("description"),
            "buyerShortName": tender.get("buyer") or "the buyer",
            "companyName": company.get("legal_name") or "your company",
            "pageCount": page_count,
            "appUrl": app_url,
            "tenderId": tender_id,
        })

        # Claimed only now, immediately before the first real send - same
        # position lib/notificationEngine.ts's own sendNotification() claims
        # in (render happens in its caller, before it's ever invoked). Found
        # 2026-10-30: this used to claim BEFORE the recipients lookup, the
        # tender/company select and _render() - every one of those can raise
        # (a network blip, a bad render-script exit, an empty lookup), and
        # since this job never runs again for this job id, any one of them
        # failing AFTER the old claim point would have permanently burned
        # this pack's one and only "ready" email - the exact bug class the
        # API-key check above was already written to avoid, just not closed
        # for these other failure modes too.
        idempotency_key = f"pack-ready-{job['id']}"
        claimed = client.rpc("claim_notification", {"p_idempotency_key": idempotency_key, "p_notification_type": "pack_ready"})
        if not claimed:
            return

        for to in recipients:
            result = _send_via_resend(to, email["subject"], email["html"], email["text"])
            # QA pass, 2026-11-05: record_notification_sent() is a real network
            # RPC call with no guard of its own - a transient blip on IT (not
            # the Resend send, which _send_via_resend() already never lets
            # raise) used to abort this whole loop via the outer except below,
            # silently losing every OTHER recipient too, not just this one.
            # Since claim_notification above is a one-shot token and this job
            # never runs again for the same job id, that permanently lost the
            # rest of the company's "pack ready" email - the exact bug class
            # this file's own claim-timing fixes (2026-10-28, 2026-10-30)
            # already exist to avoid, just not closed for a per-recipient
            # failure after the claim has already succeeded. The Resend send
            # itself already happened for `to` by this point regardless of
            # whether the audit write below succeeds - only the record of it
            # is at risk, so this recipient's own alert names that precisely.
            try:
                client.rpc("record_notification_sent", {
                    "p_idempotency_key": idempotency_key,
                    "p_notification_type": "pack_ready",
                    "p_recipient_email": to,
                    "p_company_id": company_id,
                    "p_tender_id": tender_id,
                    "p_subject": email["subject"],
                    "p_status": result["status"],
                    "p_resend_id": result.get("resend_id"),
                    "p_error": result.get("error"),
                })
            except Exception as e:
                system_alerts.record(
                    "general", f"pack_ready email for job {job.get('id')} was sent to {to} (status "
                    f"{result['status']!r}) but recording it failed: {type(e).__name__}: {e} - the send itself "
                    "already happened; only its audit log entry may be missing", "warning", exc=e,
                    context={"job_id": job.get("id"), "company_id": company_id, "tender_id": tender_id, "recipient": to})
    except Exception as e:  # noqa: BLE001 - see this function's own docstring
        system_alerts.record("general", f"pack_ready email failed for job {job.get('id')}: {type(e).__name__}: {e}",
                             "warning", exc=e, context={"job_id": job.get("id"), "company_id": company_id, "tender_id": tender_id})
