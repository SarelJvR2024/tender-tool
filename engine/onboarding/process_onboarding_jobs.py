"""
Queue runner for the bulk onboarding document scan (migration 0063). Same
claim/process/store shape as engine/cv/extract_cv_fields.py's own queue
plumbing - the Supabase REST helper (`supabase_request`) is the identical
function imported from engine/cv/process_cv_jobs.py, not re-written.

Pipeline per claimed row (onboarding_uploads.status
'classification_requested' -> 'classifying' -> 'classified'/
'classification_failed'):
  1. claim the row (atomic conditional update, same pattern as cv_uploads).
  2. download the file from the private 'onboarding-documents' bucket.
  3. classify_documents.extract_from_file() - OCR fallback, one LLM call,
     quote-verification (see that module's own docstring for the detail).
  4. store the result as an onboarding_document_results row,
     review_status 'pending_review'.
A missing/invalid API key puts the row back in the queue (SetupError) rather
than failing it, exactly like extract_cv_fields.py - nobody has to re-upload
once a key is set.

Usage:
    python3 process_onboarding_jobs.py [--once]
    python3 process_onboarding_jobs.py --loop [--interval 30]
"""
import argparse
import datetime
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "worker"))
sys.path.insert(0, os.path.join(ENGINE, "cv"))

from poll_loop import poll_forever, DEFAULT_INTERVAL_SECONDS, system_alerts  # noqa: E402
from process_cv_jobs import supabase_request  # noqa: E402  (same REST helper, same env vars)
from extract_cv_fields import storage_download as _storage_download  # noqa: E402  (same Storage download helper)
import classify_documents as cd  # noqa: E402

STALE_AFTER_MINUTES = 30  # one API call + a text pull; 30 minutes means the worker died
BUCKET = "onboarding-documents"


def _now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def storage_download(url, key, object_path, dest):
    _storage_download(url, key, BUCKET, object_path, dest)


def claim_upload(url, key, upload):
    claimed = supabase_request(
        url, key, "PATCH", f"onboarding_uploads?id=eq.{upload['id']}&status=eq.classification_requested",
        {"status": "classifying", "classification_claimed_at": _now_iso(), "classification_error": None})
    return bool(claimed)


def release_upload(url, key, upload):
    supabase_request(url, key, "PATCH", f"onboarding_uploads?id=eq.{upload['id']}&status=eq.classifying",
                     {"status": "classification_requested", "classification_claimed_at": None})


def fail_upload(url, key, upload, reason):
    supabase_request(url, key, "PATCH", f"onboarding_uploads?id=eq.{upload['id']}", {
        "status": "classification_failed", "classification_error": reason, "classification_completed_at": _now_iso()})


def fail_stale_uploads(url, key, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=STALE_AFTER_MINUTES)
    for up in supabase_request(url, key, "GET", "onboarding_uploads?status=eq.classifying&select=id,classification_claimed_at"):
        claimed = up.get("classification_claimed_at")
        if claimed and datetime.datetime.fromisoformat(claimed.replace("Z", "+00:00")) < cutoff:
            supabase_request(url, key, "PATCH", f"onboarding_uploads?id=eq.{up['id']}&status=eq.classifying", {
                "status": "classification_failed", "classification_completed_at": _now_iso(),
                "classification_error": f"The classification worker stopped mid-job (no result after "
                                        f"{STALE_AFTER_MINUTES} minutes). Upload this file again."})
            print(f"[failed] onboarding_upload {up['id']}: stale 'classifying' since {claimed}")
            system_alerts.record("onboarding_scan", f"An onboarding document classification was stuck for over "
                                                     f"{STALE_AFTER_MINUTES} minutes (the worker died mid-job) and "
                                                     "was marked failed", "error", context={"onboarding_upload_id": up["id"]})


def process_upload(url, key, upload, client_factory=cd.default_llm_client):
    if not claim_upload(url, key, upload):
        print(f"[skipped] onboarding_upload {upload['id']}: already claimed by another worker")
        return False
    work_dir = tempfile.mkdtemp(prefix="onboarding_classify_")
    try:
        sp = upload.get("storage_path") or ""
        if not sp.startswith(f"{upload['company_id']}/") or ".." in sp or "//" in sp:
            raise cd.ClassificationFailed("This upload's file isn't in your company's own storage folder, so it "
                                          "wasn't read. Upload it again.")
        client = client_factory()  # SetupError here leaves the job queued
        local = os.path.join(work_dir, os.path.basename(upload["storage_path"]))
        storage_download(url, key, upload["storage_path"], local)
        proposal, warnings, info = cd.extract_from_file(local, upload["original_filename"], work_dir, client=client)
        supabase_request(url, key, "POST", "onboarding_document_results?on_conflict=onboarding_upload_id", {
            "company_id": upload["company_id"], "onboarding_upload_id": upload["id"],
            "document_kind": proposal["document_kind"], "document_kind_reason": proposal.get("document_kind_reason"),
            "fields": proposal["fields"], "warnings": warnings, "review_status": "pending_review",
            "text_method": info["text_method"], "source_pages": info["source_pages"],
            "source_text_chars": info["source_text_chars"], "model": info.get("model"), "usage": info.get("usage"),
        })
        supabase_request(url, key, "PATCH", f"onboarding_uploads?id=eq.{upload['id']}", {
            "status": "classified", "classification_completed_at": _now_iso(), "classification_error": None})
        print(f"[classified] onboarding_upload {upload['id']}: {proposal['document_kind']} "
              f"({len(proposal['fields'])} field(s), {len(warnings)} warning(s))")
        return True
    except (cd.SetupError, cd.TransientError) as e:
        release_upload(url, key, upload)
        if isinstance(e, cd.SetupError):
            raise
        system_alerts.record("onboarding_scan", f"Onboarding document classification hit a temporary problem and "
                                                 f"will retry: {e}", "warning",
                             context={"onboarding_upload_id": upload["id"], "company_id": upload.get("company_id")})
        print(f"[retry] onboarding_upload {upload['id']}: {e}")
        return False
    except cd.ClassificationFailed as e:
        fail_upload(url, key, upload, str(e))
        system_alerts.record("onboarding_scan", f"Onboarding document classification refused an upload: {e}", "warning",
                             context={"onboarding_upload_id": upload["id"], "company_id": upload.get("company_id")})
        print(f"[failed] onboarding_upload {upload['id']}: {e}")
        return True
    except Exception as e:
        system_alerts.record("onboarding_scan", f"Onboarding document classification crashed: {type(e).__name__}: {e}",
                             "error", exc=e, context={"onboarding_upload_id": upload["id"], "company_id": upload.get("company_id")})
        fail_upload(url, key, upload, f"Classification hit an unexpected error ({type(e).__name__}). Upload this "
                                      "file again or file it manually.")
        print(f"[failed] onboarding_upload {upload['id']}: unexpected {type(e).__name__}: {e}")
        return True
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def poll_once(url, key, quiet_when_empty=False, client_factory=cd.default_llm_client):
    fail_stale_uploads(url, key)
    uploads = supabase_request(
        url, key, "GET", "onboarding_uploads?status=eq.classification_requested&select=*&order=created_at.asc")
    if not uploads:
        if not quiet_when_empty:
            print("No pending onboarding document classification requests.")
        return 0
    handled = 0
    for up in uploads:
        if process_upload(url, key, up, client_factory=client_factory):
            handled += 1
    return handled


def run(loop=False, interval=DEFAULT_INTERVAL_SECONDS, max_cycles=None):
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see app/.env.local.example) before running this.")
        return 1
    if not loop:
        try:
            poll_once(url, key)
        except cd.SetupError as e:
            print(f"ERROR: {e}")
            return 1
        return 0
    poll_forever(lambda: poll_once(url, key, quiet_when_empty=True), interval=interval,
                 max_cycles=max_cycles, name="process_onboarding_jobs", alert_source="onboarding_scan")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="process queued uploads once and exit (the default)")
    mode.add_argument("--loop", "--daemon", dest="loop", action="store_true", help="keep polling until stopped")
    ap.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS)
    ap.add_argument("--max-cycles", type=int, default=None)
    args = ap.parse_args(argv)
    if args.interval <= 0:
        ap.error("--interval must be a positive number of seconds")
    return run(loop=args.loop, interval=args.interval, max_cycles=args.max_cycles)


if __name__ == "__main__":
    sys.exit(main())
