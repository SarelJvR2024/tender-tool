"""
The one way an engine/bridge/script records a failure for Sarel's attention
(Sarel, 2026-10-17: "A fail must be emailed to me and flagged for me to
review so that we can fix it. Any issues and breaks must be sent and flagged
to me to keep reviewing and improving the app.").

    sys.path.insert(0, <repo>/engine/alerts)
    import system_alerts
    system_alerts.record("pack", "Pack build crashed: ...", exc=e,
                         context={"job_id": job["id"], "company_id": job["company_id"]})

Writes one row to system_alerts (migration 0042) through the
record_system_alert() function: a new alert, or one more occurrence of the
same open alert (same source + the same message once ids and numbers are
blanked out - see fingerprint()). engine/alerts/check_system_alerts.py reports
what is new, and /admin shows and resolves them.

Rules:
  - record() NEVER raises and never blocks for long (10 s timeout). An alert
    that can't be stored is printed to stderr instead - recording a failure
    must not become a second failure in the bridge that hit the first.
  - It always prints one "[system-alert] ..." line to stderr too, so the
    worker log still shows it.
  - Service-role key from the environment (NEXT_PUBLIC_SUPABASE_URL +
    SUPABASE_SERVICE_ROLE_KEY), same as every engine/ writer. Without them
    (a local run) the alert is only printed.
  - SYSTEM_ALERTS_DISABLED=1 switches storing off (the stderr line stays).
  - Tests: set_sink(fn) receives the payload instead of the HTTP call.

Severity:
  critical  the worker/script itself can't run (crash, missing config)
  error     a real failure: an exception, a job that broke, a scoring error
  warning   the product refused something on purpose (a gate, an unreadable
            upload) - not a bug by itself, but recorded because a refusal can
            hide one (the MO/MA refusal was a real bug, Hardcoded-Assumptions-
            Audit §1). check_system_alerts.py reports warnings too unless
            --min-severity error.
"""
import hashlib
import json
import os
import re
import sys
import traceback
import urllib.error
import urllib.request

SEVERITIES = ("warning", "error", "critical")
RPC = "record_system_alert"
TIMEOUT = 10

_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
_HEX = re.compile(r"\b[0-9a-f]{12,}\b", re.I)
_NUM = re.compile(r"\d+")
_sink = None


def set_sink(fn):
    """Tests: route record()'s payload to fn(payload) instead of Supabase.
    set_sink(None) restores the real path."""
    global _sink
    _sink = fn


def fingerprint(source, message):
    """sha256 of the source + the message with ids, hex strings and numbers
    blanked out, so "job 3f2a... failed after 61 minutes" and "job 9c01...
    failed after 75 minutes" are one open alert with two occurrences."""
    norm = _NUM.sub("#", _HEX.sub("<hex>", _UUID.sub("<id>", message or "")))
    norm = re.sub(r"\s+", " ", norm).strip().lower()[:500]
    return hashlib.sha256(f"{source}|{norm}".encode()).hexdigest()


def _clean_source(source):
    s = re.sub(r"[^a-z0-9_.:-]+", "_", str(source or "unknown").lower()).strip("_") or "unknown"
    return s[:80]


def _truthy(v):
    return str(v or "").strip().lower() in ("1", "true", "yes")


def payload_for(source, message, severity="error", detail=None, context=None, exc=None):
    if severity not in SEVERITIES:
        severity = "error"
    if exc is not None and detail is None:
        detail = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    source = _clean_source(source)
    message = (str(message or "").strip() or "(no message)")[:2000]
    return {"p_source": source, "p_severity": severity, "p_message": message,
            "p_detail": detail[:50000] if detail else None,
            "p_context": json.loads(json.dumps(context or {}, default=str)),
            "p_fingerprint": fingerprint(source, message)}


def record(source, message, severity="error", detail=None, context=None, exc=None, url=None, key=None):
    """Record one failure. Returns the alert id, or None when it was only
    printed (no Supabase, disabled, or the write failed). Never raises."""
    try:
        payload = payload_for(source, message, severity, detail, context, exc)
    except Exception as e:  # a bad context object must not break the caller
        payload = payload_for(source, f"{message} (context not serialisable: {e})", severity, detail, None, exc)
    print(f"[system-alert] {payload['p_source']} {payload['p_severity']}: {payload['p_message'][:300]}",
          file=sys.stderr)
    if _sink is not None:
        try:
            return _sink(payload)
        except Exception as e:
            print(f"[system-alert] test sink failed: {e}", file=sys.stderr)
            return None
    if _truthy(os.environ.get("SYSTEM_ALERTS_DISABLED")):
        return None
    url = url or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[system-alert] not stored: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set",
              file=sys.stderr)
        return None
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/{RPC}", method="POST", data=json.dumps(payload).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
        out = json.loads(body) if body else None
        return out if isinstance(out, str) else None
    except urllib.error.HTTPError as e:
        print(f"[system-alert] not stored: {e.code} {e.read().decode(errors='replace')[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"[system-alert] not stored: {type(e).__name__}: {e}", file=sys.stderr)
    return None
