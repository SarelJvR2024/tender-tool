"""
Focused test for process_onboarding_jobs.py's process_upload() storage-path
guard - no dedicated test file existed for this module before this.

Finding (2026-10-20, forty-third run, docs/specs/QA-Edge-Case-Findings.md):
the guard that checks a claimed row's storage_path really sits under that
upload's OWN company folder (defence in depth against a corrupted/forged
row pointing at another tenant's files) rejected ".." as a bare SUBSTRING
anywhere in the path, not just as a real path-traversal SEGMENT. The upload
form's own safeFileName() (app/lib/onboardingScan.ts) keeps dots in a
filename unchanged, so a perfectly ordinary file like "Report..final.pdf"
(a double dot before the extension) produced a storage_path containing
".." and got rejected with "isn't in your company's own storage folder,
so it wasn't read. Upload it again." - even though it WAS in the right
company's folder; the file would fail the exact same way on every re-upload
with no indication the real problem is the filename, not the folder.

Runs the REAL process_upload() end to end (claim -> guard -> downstream),
with supabase_request faked (no network) and client_factory() made to raise
a distinguishable marker exception right after the guard, so a test can
tell "the guard let it through" apart from "the guard rejected it" by
reading what system_alerts.record() was actually told, without needing a
real LLM call or Storage download for either case.

Run: python3 engine/onboarding/test_process_onboarding_jobs.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "worker"))
sys.path.insert(0, os.path.join(ENGINE, "cv"))
sys.path.insert(0, os.path.join(ENGINE, "alerts"))
# The new fail_stale_uploads()/process_upload() error-path tests below don't
# monkeypatch system_alerts.record() the way the existing guard tests do
# (they check its real side effects via FakeDB instead) - set this BEFORE
# importing so a real system_alerts.record() call never makes a real network
# attempt against this sandbox's own Supabase credentials, same documented
# escape hatch Finding 88's test file uses.
os.environ["SYSTEM_ALERTS_DISABLED"] = "1"
import process_onboarding_jobs as poj  # noqa: E402
import classify_documents as cd  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class _ReachedClientFactory(Exception):
    """Marker: process_upload() got past the storage-path guard and called
    client_factory() - proves the guard did NOT reject this upload."""


def _fake_supabase_request(url, key, method, path, body=None):
    return [{"id": "u1"}]  # claim/patch always "succeeds" - no real DB


def _upload(storage_path, company_id="co-1", upload_id="u1"):
    return {"id": upload_id, "company_id": company_id, "storage_path": storage_path,
            "original_filename": os.path.basename(storage_path)}


def run_case(storage_path, company_id="co-1"):
    """Runs the real process_upload() and returns the system_alerts.record
    call it made (there is always exactly one on any of these paths)."""
    recorded = []
    real_record = poj.system_alerts.record
    real_request = poj.supabase_request
    poj.system_alerts.record = lambda *a, **kw: recorded.append((a, kw))
    poj.supabase_request = _fake_supabase_request
    try:
        poj.process_upload(
            "http://fake", "fake-key", _upload(storage_path, company_id),
            client_factory=lambda: (_ for _ in ()).throw(_ReachedClientFactory("reached client_factory")))
    finally:
        poj.system_alerts.record = real_record
        poj.supabase_request = real_request
    assert recorded, "process_upload must always record something on these paths"
    return recorded[0]


def test_legit_double_dot_filename_is_not_rejected_by_the_guard():
    print("a legitimate file whose name has two consecutive dots")
    (args, kw) = run_case("co-1/a1b2c3d4-Report..final.pdf")
    message = args[1]
    check("the guard let it through (reached client_factory, not the storage-folder rejection)",
          "_ReachedClientFactory" in message and "reached client_factory" in message, message)
    check("the misleading 'not in your company's own storage folder' message was NOT produced",
          "storage folder" not in message, message)


def test_real_traversal_via_dotdot_segment_is_still_rejected():
    print("a storage_path with a genuine '..' path segment (real traversal shape)")
    (args, kw) = run_case("co-1/../co-2/secret.pdf")
    message = args[1]
    check("the guard still rejects a real '..' segment",
          "storage folder" in message, message)
    check("client_factory was never reached", "_ReachedClientFactory" not in message, message)


def test_wrong_company_prefix_is_still_rejected():
    print("a storage_path under a DIFFERENT company's folder entirely")
    (args, kw) = run_case("co-OTHER/secret.pdf", company_id="co-1")
    message = args[1]
    check("the guard still rejects a path under another company's prefix",
          "storage folder" in message, message)


def test_double_slash_is_still_rejected():
    print("a storage_path with a double slash")
    (args, kw) = run_case("co-1//evil.pdf")
    message = args[1]
    check("the guard still rejects a double slash", "storage folder" in message, message)


# ---------------------------------------------------------------------------
# claim_upload()/release_upload()/fail_stale_uploads()/process_upload()'s own
# happy and error paths - every existing test above uses _fake_supabase_request,
# which ignores the querystring entirely (any GET/PATCH "succeeds" on every
# row regardless of filter), so none of these had ever been exercised against
# the real atomic-claim contract this bridge depends on. Same FakeDB shape
# as engine/narrative/test_process_narrative_jobs.py's own Finding-87 fix.
# QA pass, 2026-10-29.
# ---------------------------------------------------------------------------

def _parse_filters(qs):
    import urllib.parse
    filters = []
    for key, vals in urllib.parse.parse_qs(qs).items():
        if key in ("select", "order", "limit"):
            continue
        val = vals[0]
        if val.startswith("eq."):
            filters.append((key, val[3:]))
    return filters


def _row_matches(row, filters):
    return all(str(row.get(col)) == val for col, val in filters)


class FakeDB:
    def __init__(self, rows):
        self.tables = {"onboarding_uploads": list(rows)}
        self.calls = []

    def __call__(self, url, key, method, path, body=None):
        self.calls.append((method, path, body))
        resource, _, qs = path.partition("?")
        rows = self.tables.setdefault(resource, [])
        matched = [r for r in rows if _row_matches(r, _parse_filters(qs))]
        if method == "GET":
            return matched
        if method == "PATCH":
            for r in matched:
                r.update(body)
            return matched
        if method == "POST":
            rows.append(dict(body))
            return [body]
        raise ValueError(f"FakeDB does not support {method}")


def test_claim_upload_is_atomic_a_second_claim_on_the_same_row_fails():
    db = FakeDB([{"id": "u1", "status": "classification_requested"}])
    original = poj.supabase_request
    poj.supabase_request = db
    try:
        first = poj.claim_upload("url", "key", {"id": "u1"})
        second = poj.claim_upload("url", "key", {"id": "u1"})
    finally:
        poj.supabase_request = original
    check("the first claim on a 'classification_requested' row succeeds", first is True)
    check("a second claim on the SAME row (now 'classifying') fails, not re-claimed", second is False)
    check("the row really did move to 'classifying'", db.tables["onboarding_uploads"][0]["status"] == "classifying")
    check("classification_claimed_at was stamped by the successful claim",
          db.tables["onboarding_uploads"][0].get("classification_claimed_at") is not None)


def test_fail_stale_uploads_marks_old_classifying_rows_failed_and_leaves_fresh_ones_alone():
    import datetime
    now = datetime.datetime(2026, 10, 29, 12, 0, tzinfo=datetime.timezone.utc)
    old = (now - datetime.timedelta(minutes=30)).isoformat()   # past STALE_AFTER_MINUTES=10
    fresh = (now - datetime.timedelta(minutes=2)).isoformat()  # well within it
    db = FakeDB([
        {"id": "stuck", "status": "classifying", "classification_claimed_at": old},
        {"id": "running", "status": "classifying", "classification_claimed_at": fresh},
    ])
    original = poj.supabase_request
    poj.supabase_request = db
    try:
        poj.fail_stale_uploads("url", "key", now=now)
    finally:
        poj.supabase_request = original
    rows = {r["id"]: r for r in db.tables["onboarding_uploads"]}
    check("a row stuck 'classifying' for longer than STALE_AFTER_MINUTES is marked failed",
          rows["stuck"]["status"] == "classification_failed", rows["stuck"])
    check("...with a customer-facing reason, not left blank", bool(rows["stuck"].get("classification_error")))
    check("a row that only just started is left alone, not prematurely failed",
          rows["running"]["status"] == "classifying", rows["running"])


def test_process_upload_happy_path_writes_classified_with_every_result_field():
    db = FakeDB([{"id": "u1", "company_id": "co-1", "storage_path": "co-1/doc.pdf", "original_filename": "doc.pdf",
                 "status": "classification_requested"}])
    original_db, original_download, original_extract = poj.supabase_request, poj.storage_download, cd.extract_from_file
    poj.supabase_request = db
    poj.storage_download = lambda *a, **k: None
    cd.extract_from_file = lambda *a, **k: (
        {"document_kind": "cidb_certificate", "document_kind_reason": "heading match", "fields": {"grade": "7CE"}},
        ["a warning"],
        {"text_method": "native", "source_pages": 2, "source_text_chars": 400, "model": "claude-x", "usage": {}},
    )
    try:
        result = poj.process_upload("url", "key", db.tables["onboarding_uploads"][0], client_factory=lambda: object())
    finally:
        poj.supabase_request, poj.storage_download, cd.extract_from_file = original_db, original_download, original_extract
    check("process_upload returns True on a successful classification", result is True)
    row = db.tables["onboarding_uploads"][0]
    check("status moved all the way to classified", row["status"] == "classified", row)
    check("classification_error was cleared", row.get("classification_error") is None, row)
    results = db.tables.get("onboarding_document_results", [])
    check("exactly one onboarding_document_results row was written", len(results) == 1, results)
    if results:
        check("document_kind/fields/warnings were all recorded",
              results[0]["document_kind"] == "cidb_certificate" and results[0]["fields"] == {"grade": "7CE"}
              and results[0]["warnings"] == ["a warning"], results[0])


def test_process_upload_setup_error_releases_and_reraises_but_transient_error_releases_quietly():
    """Both 'not this upload's fault' exceptions release the row back to
    classification_requested - but SetupError re-raises (a missing API key
    stops this worker hammering every other queued upload with the same
    doomed call), while TransientError is swallowed so the loop carries on."""
    def _run(exc_cls):
        db = FakeDB([{"id": "u1", "company_id": "co-1", "storage_path": "co-1/doc.pdf",
                     "original_filename": "doc.pdf", "status": "classification_requested"}])
        original_db, original_factory = poj.supabase_request, None
        poj.supabase_request = db
        try:
            raised = False
            try:
                poj.process_upload("url", "key", db.tables["onboarding_uploads"][0],
                                   client_factory=lambda: (_ for _ in ()).throw(exc_cls("boom")))
            except exc_cls:
                raised = True
        finally:
            poj.supabase_request = original_db
        return db.tables["onboarding_uploads"][0]["status"], raised

    status, raised = _run(cd.TransientError)
    check("TransientError releases the row back to 'classification_requested'", status == "classification_requested", status)
    check("...and does not raise out of process_upload", raised is False)

    status, raised = _run(cd.SetupError)
    check("SetupError also releases the row back to 'classification_requested'", status == "classification_requested", status)
    check("...but DOES raise out of process_upload", raised is True)


def test_process_upload_classification_failed_marks_the_row_failed_without_raising():
    db = FakeDB([{"id": "u1", "company_id": "co-1", "storage_path": "co-1/doc.pdf", "original_filename": "doc.pdf",
                 "status": "classification_requested"}])
    original_db = poj.supabase_request
    poj.supabase_request = db
    try:
        result = poj.process_upload("url", "key", db.tables["onboarding_uploads"][0],
                                    client_factory=lambda: (_ for _ in ()).throw(cd.ClassificationFailed("not readable")))
    finally:
        poj.supabase_request = original_db
    row = db.tables["onboarding_uploads"][0]
    check("process_upload returns True (handled, not a crash) on ClassificationFailed", result is True)
    check("status moves to classification_failed with the real reason",
          row["status"] == "classification_failed" and row.get("classification_error") == "not readable", row)


def main():
    test_legit_double_dot_filename_is_not_rejected_by_the_guard()
    test_real_traversal_via_dotdot_segment_is_still_rejected()
    test_wrong_company_prefix_is_still_rejected()
    test_double_slash_is_still_rejected()
    test_claim_upload_is_atomic_a_second_claim_on_the_same_row_fails()
    test_fail_stale_uploads_marks_old_classifying_rows_failed_and_leaves_fresh_ones_alone()
    test_process_upload_happy_path_writes_classified_with_every_result_field()
    test_process_upload_setup_error_releases_and_reraises_but_transient_error_releases_quietly()
    test_process_upload_classification_failed_marks_the_row_failed_without_raising()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
