"""
System-alerts check: what has broken since the last check, for Sarel.

Sarel, 2026-10-17: "A fail must be emailed to me and flagged for me to review
so that we can fix it. Any issues and breaks must be sent and flagged to me
to keep reviewing and improving the app."

RETIRED as a live alert channel, 2026-10-24 (Sarel: "retire the old
Python+Gmail alert mechanism ... consolidate all system and Scout exception
alerts into the new Resend path"). The scheduled Claude-session-with-Gmail
trigger that used to run this script with --out and e-mail what it listed
(trig_01U6pzsyxHEiqZzEKmE7SZ9f, "System alerts check-in") has been disabled,
not deleted - re-enabling it would resume double-reporting, now that
scripts/send-scout-alerts.ts (app/, Tier 3, every 10 minutes) and
scripts/send-founder-digest.ts (07:00 SAST) cover the same system_alerts
table via Resend, with their own idempotency (notification_claims, migration
0093) deliberately independent of this script's own reported_at/
reported_occurrences bookkeeping below - see lib/scoutAnomalyAlerts.ts's own
header comment for the full reasoning. This script itself is left in place,
unchanged and still correct for a manual --dry-run look (same reasoning any
other read-only diagnostic script in this repo stays available) - it is the
automated Gmail delivery that is retired, not this file's own logic.

Same family and same deliberate boundary as
engine/discovery/watch_new_tenders.py and engine/compliance/watch_deadlines.py:
find what is new, diff against a seen store IN THE DATABASE, print one line
per item, and - with --out - write the full list as JSON for a caller to turn
into a real notification. Nothing here sends an e-mail. There is no
SMTP/e-mail code anywhere in this repo (confirmed: no smtplib, no mail API
client, no cron file); until 2026-10-24 the e-mail to Sarel was sent by an
EXTERNAL scheduled Claude session check-in that has real Gmail access: it ran
this script with --out, read the JSON and e-mailed what it listed - now
retired in favour of the Resend path above.

What it reads: system_alerts (migration 0042), written by every engine and
bridge through engine/alerts/system_alerts.py. Not tenant-scoped (Sarel's
own operational view); the service-role key is required.

The seen store is the table itself (no local file - a file on one host
would re-report everything on the next host, or forget it):
  new              unresolved, never reported (reported_at is null)
  still_occurring  unresolved, already reported, and it has happened again
                   since (occurrences > reported_occurrences) - a failure that
                   keeps happening is not silently absorbed into an old e-mail
After printing, each reported alert gets reported_at = now and
reported_occurrences = its occurrence count, so a second run with nothing new
reports nothing. A RESOLVED alert (marked in /admin, "System alerts") is never
reported again; if the same failure happens after it was resolved, the
engines write a NEW alert row, which is reported as new.

--dry-run reports without marking anything reported (a manual look).

Usage:
    python3 engine/alerts/check_system_alerts.py [--out alerts.json]
        [--min-severity warning|error|critical] [--dry-run]
Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

Exit code: 0 when the check ran (whether or not anything was found); 1 when
the database could not be read or written - loudly, so the scheduled
check-in notices that the alert channel itself is broken.
"""
import argparse
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

TABLE = "system_alerts"
SEVERITY_RANK = {"warning": 1, "error": 2, "critical": 3}
PAGE = 1000  # PostgREST's default max rows on Supabase
REPORT_FIELDS = ("id", "source", "severity", "message", "detail", "context", "occurrences", "first_seen_at",
                 "last_seen_at", "reported_at", "reported_occurrences")


class AlertsRest:
    """GET/PATCH on system_alerts with the service-role key (plain urllib,
    same as every other engine/ script)."""

    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    @classmethod
    def from_env(cls):
        url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        return cls(url, key) if url and key else None

    def _req(self, method, path, body=None):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json",
             "Prefer": "return=representation"}
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", method=method, headers=h,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read()
                return json.loads(text) if text else []
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} failed: {e.code} {e.read().decode(errors='replace')[:300]}")

    def open_alerts(self):
        """Every unresolved alert, newest first, all pages."""
        out, offset = [], 0
        while True:
            page = self._req("GET", f"{TABLE}?resolved_at=is.null&select=*&order=last_seen_at.desc,id.asc"
                                    f"&limit={PAGE}&offset={offset}")
            out += page
            if len(page) < PAGE:
                return out
            offset += PAGE

    def mark_reported(self, alert_id, occurrences, when):
        return self._req("PATCH", f"{TABLE}?id=eq.{urllib.parse.quote(alert_id, safe='')}",
                         {"reported_at": when, "reported_occurrences": occurrences})


def classify(alerts, min_severity="warning"):
    """(new, still_occurring, open_total) from the unresolved alerts."""
    floor = SEVERITY_RANK.get(min_severity, 1)
    wanted = [a for a in alerts if SEVERITY_RANK.get(a.get("severity"), 2) >= floor]
    new = [a for a in wanted if not a.get("reported_at")]
    again = [a for a in wanted if a.get("reported_at") and (a.get("occurrences") or 0) > (a.get("reported_occurrences") or 0)]
    return new, again, len(alerts)


def check(client, min_severity="warning", dry_run=False, now=None, log=print):
    """QA pass, 2026-10-30: the mark_reported() loop below used to have no
    try/except at all - a transient PATCH failure on any ONE alert (a
    Supabase blip, or the alert row resolved/deleted between open_alerts()'s
    read and this write) raised straight out of this function. main()'s own
    try/except then caught that and returned exit code 1 with NO --out file
    written at all - so the Claude-scheduled trigger that reads this
    script's report to email Sarel got NOTHING that run, not even the
    OTHER, perfectly fine new/still-occurring alerts already identified
    before the failing PATCH (confirmed directly: a failure on the second
    of three alerts lost the first, CRITICAL one from the report too, along
    with the third). The one system this exists to catch "something went
    wrong" going silent is exactly the worst place for this bug class
    (watch_deadlines.days_until(), Finding 99's fail_stale_jobs(), Finding
    104's opportunity_requirements.classify_all()) to recur."""
    now = now or datetime.datetime.now(datetime.timezone.utc).isoformat()
    alerts = client.open_alerts()
    new, again, open_total = classify(alerts, min_severity)
    if not dry_run:
        for a in new + again:
            try:
                client.mark_reported(a["id"], a.get("occurrences") or 1, now)
            except Exception as e:
                log(f"  WARNING: could not mark alert {a['id']} as reported ({type(e).__name__}: {e}) - "
                    "it may be reported again next time.")

    def line(a):
        n = a.get("occurrences") or 1
        return (f"  [{a.get('severity')}] {a.get('source'):<12} {a.get('message', '')[:160]}"
                f"  ({n} occurrence{'s' if n != 1 else ''}, last {str(a.get('last_seen_at'))[:19]})")
    log(f"{len(new)} new system alert(s) since the last check:")
    for a in new:
        log(line(a))
    log(f"\n{len(again)} already-reported alert(s) still happening (new occurrences since the last report):")
    for a in again:
        log(line(a) + f"  - was {a.get('reported_occurrences')} at the last report")
    log(f"\n{open_total} unresolved alert(s) in total - review and mark resolved in /admin (System alerts).")
    return {"checked_at": now, "min_severity": min_severity, "dry_run": dry_run,
            "new": [{k: a.get(k) for k in REPORT_FIELDS} for a in new],
            "still_occurring": [{k: a.get(k) for k in REPORT_FIELDS} for a in again],
            "open_unresolved_total": open_total,
            "review_at": "/admin#system-alerts"}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None, help="write the report (new + still_occurring alerts) to this JSON file")
    ap.add_argument("--min-severity", choices=sorted(SEVERITY_RANK, key=SEVERITY_RANK.get), default="warning",
                    help="lowest severity to report (default warning: everything)")
    ap.add_argument("--dry-run", action="store_true", help="report without marking the alerts reported")
    args = ap.parse_args(argv)

    client = AlertsRest.from_env()
    if client is None:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see app/.env.local.example).")
        return 1
    try:
        report = check(client, args.min_severity, args.dry_run)
    except Exception as e:
        print(f"ERROR: could not read/update {TABLE}: {type(e).__name__}: {e}")
        return 1
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2, default=str)
        print(f"\nWrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
