"""
scan_ocr.py had no dedicated test file at all before this pass (confirmed by
a repo-wide search - only indirectly exercised through
engine/cv/test_extract_cv_fields.py's and
engine/onboarding/test_classify_documents.py's own "Tesseract not installed,
skip" guard, never through a real OCR call).

QA Finding, 2026-10-30: ocr_image_file()'s own "the image could not be
opened" failure (a corrupted upload, a file renamed to an image extension
that isn't really one) returned early without ever calling
_alert_failures() - unlike every OTHER OCR-infrastructure break in this
module (Tesseract missing, a PDF page that couldn't be rendered, a page OCR
errored or timed out), all of which DO reach it. The user-facing refusal
(via extract_cv_fields.read_cv_text()/failure_sentence()) was already
correct either way - only the operator-visible system_alerts record was
missing, so a real, repeated instance of this failure (a library
incompatibility, a corrupted-upload bug) would have been invisible to
Sarel while every sibling failure mode was reported.

available() is monkeypatched to force ok=True in every test here, so this
runs with no real Tesseract dependency (CI doesn't need it installed to
run the parts of this module that don't actually call tesseract).

Run: python3 engine/ocr/test_scan_ocr.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ENGINE, "alerts"))
import scan_ocr  # noqa: E402
import system_alerts  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _with_fake_tesseract(fn):
    real_available = scan_ocr.available
    scan_ocr.available = lambda: (True, "tesseract 5.0.0 (faked for test)")
    try:
        return fn()
    finally:
        scan_ocr.available = real_available


def test_corrupted_image_file_is_alerted_not_silently_invisible():
    print("ocr_image_file(): a file that can't be opened as an image is reported to system_alerts, "
          "the same as every other OCR-infrastructure break")
    tmp = tempfile.mkdtemp(prefix="scan_ocr_test_")
    fake = os.path.join(tmp, "broken.png")
    with open(fake, "wb") as f:
        f.write(b"this is not a real PNG file at all")

    alerts = []
    real_record = system_alerts.record
    system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        res = _with_fake_tesseract(lambda: scan_ocr.ocr_image_file(fake, work_dir=tmp))
    finally:
        system_alerts.record = real_record

    check("the result reports the real reason, not a guessed one",
          res["error"] is not None and "could not be opened" in res["error"], res)
    check("nothing was read (no page silently treated as ok)", res["read"] == [], res)
    check("a system alert was recorded for this break - previously none ever were", len(alerts) == 1, alerts)
    check("...under the 'ocr' source, so it reaches the same place every other OCR break does",
          bool(alerts) and alerts[0][0][0] == "ocr", alerts)


def test_missing_file_is_also_alerted():
    print("ocr_image_file(): a file that doesn't exist at all hits the same guard, same alert")
    tmp = tempfile.mkdtemp(prefix="scan_ocr_test_")
    missing = os.path.join(tmp, "does_not_exist.png")

    alerts = []
    real_record = system_alerts.record
    system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        res = _with_fake_tesseract(lambda: scan_ocr.ocr_image_file(missing, work_dir=tmp))
    finally:
        system_alerts.record = real_record

    check("the result reports a could-not-be-opened error", res["error"] is not None
          and "could not be opened" in res["error"], res)
    check("a system alert was recorded for this break too", len(alerts) == 1, alerts)


def test_tesseract_unavailable_still_alerts_as_before():
    # Forces the pre-existing "Tesseract unavailable" branch directly, rather
    # than relying on whether tesseract happens to be installed in whatever
    # environment runs this (CI installs it for the sibling CV-extraction
    # step; a local dev box may not) - deterministic either way.
    print("ocr_image_file(): Tesseract unavailable still alerts (regression check, forced unavailable)")
    tmp = tempfile.mkdtemp(prefix="scan_ocr_test_")
    fake = os.path.join(tmp, "whatever.png")
    with open(fake, "wb") as f:
        f.write(b"irrelevant - available() itself will refuse before this is ever opened")

    real_available = scan_ocr.available
    scan_ocr.available = lambda: (False, "Tesseract OCR is not installed on this worker")
    alerts = []
    real_record = system_alerts.record
    system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        res = scan_ocr.ocr_image_file(fake, work_dir=tmp)
    finally:
        system_alerts.record = real_record
        scan_ocr.available = real_available

    check("the pre-existing 'Tesseract unavailable' path still alerts, unaffected by this fix",
          len(alerts) == 1 and alerts[0][0][0] == "ocr", alerts)


def main():
    test_corrupted_image_file_is_alerted_not_silently_invisible()
    test_missing_file_is_also_alerted()
    test_tesseract_unavailable_still_alerts_as_before()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
