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
    """Mirrors app/lib/resendEmail.ts's sendTransactionalEmail() - same env vars, same skip-not-fail rule for a missing key, same sender-profile fallback chain (RESEND_FROM_BIDS -> RESEND_FROM_ADDRESS -> a literal default)."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        return {"status": "skipped_no_api_key"}
    from_addr = os.environ.get("RESEND_FROM_BIDS") or os.environ.get("RESEND_FROM_ADDRESS") or "Tender Ready <onboarding@resend.dev>"
    reply_to = os.environ.get("RESEND_REPLY_TO") or "support@tenderready.app"
    body = json.dumps({"from": from_addr, "to": [to], "reply_to": reply_to, "subject": subject, "html": html, "text": text}).encode()
    req = urllib.request.Request(RESEND_URL, data=body, method="POST",
                                  headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
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

        idempotency_key = f"pack-ready-{job['id']}"
        claimed = client.rpc("claim_notification", {"p_idempotency_key": idempotency_key, "p_notification_type": "pack_ready"})
        if not claimed:
            return

        recipients_raw = client.rpc("company_notification_recipients", {"p_company_id": company_id})
        recipients = [r["email"] for r in recipients_raw if r.get("daily_digest_opt_in") and r.get("email") and "@" in r["email"]]
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

        for to in recipients:
            result = _send_via_resend(to, email["subject"], email["html"], email["text"])
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
    except Exception as e:  # noqa: BLE001 - see this function's own docstring
        system_alerts.record("general", f"pack_ready email failed for job {job.get('id')}: {type(e).__name__}: {e}",
                             "warning", exc=e, context={"job_id": job.get("id"), "company_id": company_id, "tender_id": tender_id})
