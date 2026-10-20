"""
Actually sends the daily digest JSON that engine/notify/daily_digest.py
builds, as a real email, to the real person it names - the one piece this
family of scripts never had at all. An earlier audit confirmed (by grep)
that there is no smtplib/sendgrid/resend/nodemailer/send_email anywhere in
this repo, and daily_digest.py's own docstring says plainly it only
ASSEMBLES a report. This module is the missing send step, and nothing else:
it does not score tenders, does not decide who's opted in (daily_digest.py's
filter_opted_in() already dropped everyone who hasn't - see that module's
docstring for migration 0073), and does not re-read Supabase.

Provider: Resend (https://resend.com), chosen because sending is a single
authenticated HTTPS POST (https://resend.com/docs/api-reference/emails/send-email)
with no SMTP setup. Nothing else about Resend is assumed or hardcoded beyond
that one endpoint.

REQUIRED SETUP (not done yet - this repo has no email-sending env var at
all, confirmed by grep before writing this module):
  1. Sign up at https://resend.com
  2. Verify a sending domain under Domains (add the DNS records Resend gives
     you - SPF/DKIM - to whichever DNS host the tender-tool.* domain uses).
     Sending from an unverified domain is rejected by Resend itself, not by
     this script.
  3. Create an API key under API Keys (sending permission is enough - this
     script never reads anything back from Resend).
  4. Add RESEND_API_KEY to the environment the daily_digest.py cron/worker
     actually runs in (same place NEXT_PUBLIC_SUPABASE_URL and
     SUPABASE_SERVICE_ROLE_KEY already live for that job - .env on the host,
     or that host's secrets manager).
  5. Also set DIGEST_FROM_ADDRESS (e.g. "Tender Tool <digest@yourdomain.com>")
     once step 2's domain is verified - see DEFAULT_FROM below for what
     happens if this is left unset.

If RESEND_API_KEY is missing, this script DOES NOT send anything, DOES NOT
crash, and DOES NOT pretend to have sent anything - every run logs exactly
how many people it would have emailed and why it stopped, with a loud
single warning rather than one line per person (same "don't flood Sarel"
philosophy as the discovery/compliance watches' system_alerts). A
transient Resend failure (timeout, 5xx, rate limit) on ONE person's email
never aborts the rest of the run - same "one bad item never aborts the
batch" rule as watch_new_tenders.py's document fetch and
discovered_opportunity_documents' downloads (migration 0071).

Usage:
    python3 daily_digest.py --mode live --out digest_report.json
    python3 send_digest_emails.py digest_report.json
        (requires RESEND_API_KEY; DIGEST_FROM_ADDRESS strongly recommended)

    python3 send_digest_emails.py digest_report.json --dry-run
        (never POSTs to Resend, regardless of RESEND_API_KEY - prints what
        would have been sent; use this to check a run before real customers
        are opted in)
"""
import os
import sys
import json
import argparse
import urllib.request
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "alerts"))
import system_alerts  # noqa: E402

RESEND_ENDPOINT = "https://api.resend.com/emails"

# A generic sender only works if/until Resend's shared pool is used, which
# Resend itself may restrict for volume/deliverability. DIGEST_FROM_ADDRESS
# (step 5 above) should be set to an address on a verified domain as soon as
# one exists - this default exists only so a --dry-run / first real test can
# run before that domain work is done.
DEFAULT_FROM = "Tender Tool Daily Digest <onboarding@resend.dev>"

# Sections in the order they should read in the email, each with the label
# shown above it. Matches daily_digest.build_digest_for_person()'s own keys -
# not re-declared there, so a role-visibility change there needs no change here.
SECTION_LABELS = [
    ("new_tenders", "New matching tenders"),
    ("submission_due", "Closing soon"),
    ("document_expiry", "Documents & registrations due"),
    ("tender_tasks", "Tasks due"),
    ("readiness_changes", "Readiness changes"),
    ("tender_updates", "Tender updates"),
    ("listing_changes", "Listing changes"),
    ("reassessed_tenders", "Re-assessed tenders"),
]


def section_count(value):
    """A section is either a list of items, or (role=viewer) a
    {"count": N, ...} summary dict - daily_digest.build_digest_for_person()
    decides which per role. Either way, this is how many items it holds."""
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        return int(value.get("count") or 0)
    return 0


def has_content(digest):
    """Quiet on zero results (same rule the recommended trigger below must
    also follow): a digest with nothing in any section is not sent at all -
    there is no value in emailing someone "nothing happened today", and it
    trains people to ignore the digest."""
    return any(section_count(digest.get(key)) for key, _ in SECTION_LABELS)


def render_text(digest):
    lines = [f"Hi {digest['person'].get('name') or 'there'},", "",
             f"Your Tender Tool daily digest for {digest.get('company_name') or 'your company'}:", ""]
    for key, label in SECTION_LABELS:
        if key not in digest:
            continue
        n = section_count(digest[key])
        if not n:
            continue
        lines.append(f"{label}: {n}")
        items = digest[key]
        if isinstance(items, list):
            for item in items[:10]:
                bit = (item.get("title") or item.get("description") or item.get("field")
                       or item.get("field_key") or item.get("contract_number") or "item")
                lines.append(f"  - {bit}")
            if len(items) > 10:
                lines.append(f"  ... and {len(items) - 10} more")
        lines.append("")
    lines.append("You're receiving this because you opted in to the daily digest at /company. "
                 "You can turn it off there at any time.")
    return "\n".join(lines)


def send_one(api_key, from_addr, digest, dry_run=False):
    """Returns (status, detail): status is 'sent', 'skipped_empty',
    'skipped_no_email', 'dry_run' or 'failed'. Never raises - a send failure
    is reported, not propagated, so one person's bad address/timeout never
    stops the batch (see module docstring)."""
    email = digest["person"].get("email")
    if not email or "@" not in email:
        return "skipped_no_email", "no e-mail on file for this person"
    if not has_content(digest):
        return "skipped_empty", "nothing to report today"

    subject = f"Your Tender Tool daily digest - {digest.get('company_name') or ''}".strip()
    body = render_text(digest)

    if dry_run:
        return "dry_run", f"would send to {email!r} ({len(body)} chars)"

    payload = json.dumps({"from": from_addr, "to": [email], "subject": subject, "text": body}).encode("utf-8")
    req = urllib.request.Request(
        RESEND_ENDPOINT, data=payload, method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            resp.read()
        return "sent", email
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        return "failed", f"Resend rejected the send to {email!r}: HTTP {e.code} {detail}"
    except Exception as e:
        return "failed", f"Could not send to {email!r}: {type(e).__name__}: {e}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("digest_json", help="the --out file daily_digest.py wrote")
    ap.add_argument("--dry-run", action="store_true",
                     help="never POSTs to Resend regardless of RESEND_API_KEY - just prints what would be sent")
    args = ap.parse_args()

    try:
        digests = json.load(open(args.digest_json))
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR: could not read {args.digest_json!r} ({e}).")
        sys.exit(1)

    api_key = os.environ.get("RESEND_API_KEY")
    from_addr = os.environ.get("DIGEST_FROM_ADDRESS") or DEFAULT_FROM

    if not api_key and not args.dry_run:
        # Honest degradation (task requirement): never crash, never pretend
        # to have sent anything, log clearly why, once - not once per person.
        print(f"RESEND_API_KEY is not set - {len(digests)} digest(s) were built but NONE will be sent.")
        print("See this module's own docstring ('REQUIRED SETUP') for exactly what to add and where to get it.")
        system_alerts.record(
            "digest_send",
            f"RESEND_API_KEY is not set - {len(digests)} daily digest(s) were built but not sent. "
            "See engine/notify/send_digest_emails.py's docstring for setup.",
            "warning",
        )
        sys.exit(0)

    results = {"sent": 0, "skipped_empty": 0, "skipped_no_email": 0, "failed": 0, "dry_run": 0}
    failures = []
    for d in digests:
        # send_one()'s own try/except only guards the actual Resend call -
        # a malformed entry (e.g. no "person" key at all, from a partial/
        # corrupted --out write) raises a bare KeyError before that, which
        # used to abort every subsequent digest in the batch uncaught, with
        # no alert. Enterprise-readiness audit round 2, 2026-10-20.
        try:
            status, detail = send_one(api_key, from_addr, d, dry_run=args.dry_run)
            results[status] += 1
            label = d["person"].get("name") or d["person"].get("email") or "(unnamed)"
            print(f"  {status:<16} {label:<28} {detail}")
            if status == "failed":
                failures.append(detail)
        except Exception as e:
            results["failed"] += 1
            print(f"  failed           (unreadable digest entry)      {type(e).__name__}: {e}")
            failures.append(f"Could not process one digest entry: {type(e).__name__}: {e}")

    print(f"\n{results['sent']} sent, {results['skipped_empty']} skipped (nothing to report), "
          f"{results['skipped_no_email']} skipped (no e-mail on file), {results['failed']} failed"
          + (f", {results['dry_run']} dry-run" if args.dry_run else "") + ".")

    # One summary alert if anything failed - never one per person (same
    # "don't flood Sarel" rule as discovered_opportunity_documents, 0071).
    if failures and not args.dry_run:
        system_alerts.record(
            "digest_send",
            f"{len(failures)} of {len(digests)} daily digest email(s) failed to send:\n" + "\n".join(failures[:20]),
            "error",
        )


if __name__ == "__main__":
    main()
