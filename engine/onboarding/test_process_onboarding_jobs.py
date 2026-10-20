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


def main():
    test_legit_double_dot_filename_is_not_rejected_by_the_guard()
    test_real_traversal_via_dotdot_segment_is_still_rejected()
    test_wrong_company_prefix_is_still_rejected()
    test_double_slash_is_still_rejected()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
