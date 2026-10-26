"""
The live OCDS discovery feed's fetch_pdf_text() only ever ran pdftotext - any
attached .docx/.doc document came back "pdftotext could not read this file",
indistinguishable from a genuinely corrupt download (PR #118's own diagnosis,
app/AGENTS.md). assess_tender.fetch_document_text() is the fix: a .docx/.doc
URL is now read with engine/general/requirements.read_document() (the richer,
already-existing format-dispatch reader, wired into manual intake but never
into this live feed before now); a PDF, or anything whose extension isn't
confidently docx/doc, goes through fetch_pdf_text exactly as before.

Real samples, read over a file:// URL - the same code path a live eTenders
document link takes (same convention as test_discovery_fanout.py's own
TN051.pdf/SCMU5-26-27-0007SB.pdf):
  mthashana_tvet  .docx, 2026-10-26's live corpus - a 40KB panel tender with
                  a real "COMPULSORY BRIEFING: NO" line and a "pricing
                  schedule" structural marker, so it reads as full_document.
  raf_pr10118921  .doc  - goes through requirements.py's own LibreOffice
                  .doc -> .docx conversion before docx_text() reads it.

No real "pure scanned image" sample exists in templates/general_samples (every
committed sample has real extractable text), so one is built here: a .docx
with no real paragraph text at all - requirements.read_document()'s own
<50-real-character rule (the same rule it applies to a scanned PDF) fires
identically whether the near-empty text came from an actual scanned image or
an empty document; this is the real code path being tested, not a simulation
of it.

    python3 engine/discovery/test_document_reader_fallback.py
"""
import os
import sys
import tempfile

import docx

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import assess_tender  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def sample_url(key, filename):
    return "file://" + os.path.join(ROOT, "templates", "general_samples", key, filename)


def make_blank_docx(work_dir):
    """A .docx with no real text at all (python-docx's own default empty
    body paragraph only) - the same near-zero-real-text shape a scanned
    image pasted into a Word doc with no text run would produce."""
    path = os.path.join(work_dir, "scanned.docx")
    docx.Document().save(path)
    return "file://" + path


def part1_fetch_document_text():
    print("fetch_document_text(): per-format behaviour")

    text, err = assess_tender.fetch_document_text(
        sample_url("mthashana_tvet", "TENDER-DOCUMENT-PANEL OF HEALTH AND WELLNESS PRACTITIONERS.docx"))
    check(err is None, f"a real .docx tender document reads without error (err={err!r})")
    check(len(text) > 1000, f"real text came back from the .docx ({len(text)} chars)")
    check("COMPULSORY BRIEFING" in text, "the .docx's own real content is in the extracted text, not a stub")

    text, err = assess_tender.fetch_document_text(sample_url("raf_pr10118921", "SCM-Bid Documents SBD 4.doc"))
    check(err is None, f"a real legacy .doc tender document reads without error (err={err!r})")
    check(len(text) > 1000, f"real text came back from the .doc, via the LibreOffice conversion path ({len(text)} chars)")
    check("BIDDER" in text.upper(), "the .doc's own real content is in the extracted text, not a stub")

    with tempfile.TemporaryDirectory() as td:
        scanned_url = make_blank_docx(td)
        text, err = assess_tender.fetch_document_text(scanned_url)
        check(text == "", "a pure scanned-image docx yields no text")
        check(err == "Document is a scanned image — full text requires OCR during tender intake",
              f"the scanned-image case gets its own honest, OCR-free status note, not a generic failure (err={err!r})")

    # A PDF, or an unrecognised/missing extension, must still go through
    # fetch_pdf_text exactly as before - this function changes nothing there.
    real_calls = []
    real_fetch_pdf_text = assess_tender.fetch_pdf_text

    def counting_fetch_pdf_text(url, timeout=30):
        real_calls.append(url)
        return real_fetch_pdf_text(url, timeout=timeout)

    assess_tender.fetch_pdf_text = counting_fetch_pdf_text
    try:
        pdf_url = sample_url("dawid_kruiper_tn051", "TN051.pdf")
        text, err = assess_tender.fetch_document_text(pdf_url)
        check(err is None and len(text) > 1000, "a real .pdf tender document still reads correctly through the fallback entry point")
        check(real_calls == [pdf_url], "a .pdf URL is delegated to fetch_pdf_text, not read_document()")

        real_calls.clear()
        # the query string, not a real extension, must not be misread as one
        no_ext_url = pdf_url + "?v=1"
        assess_tender.fetch_document_text(no_ext_url)
        check(real_calls == [no_ext_url], "a URL with no confident docx/doc extension still defaults to fetch_pdf_text")
    finally:
        assess_tender.fetch_pdf_text = real_fetch_pdf_text


def part2_read_release_end_to_end():
    print("\nread_release() + score_release(): the fallback feeds the real pipeline end to end")
    profile = {"disciplines": ["professional_services"], "bee_level": 1, "has_cidb_grading": False}

    def release(key, filename):
        return {"categories": ["uncategorized"], "closed": False, "is_closed": False, "title": "", "description": "",
                "documents": [{"url": sample_url(key, filename), "title": filename}]}

    rel = release("mthashana_tvet", "TENDER-DOCUMENT-PANEL OF HEALTH AND WELLNESS PRACTITIONERS.docx")
    reading = assess_tender.read_release(rel)
    check(reading["depth"] == "full_document", f"a real .docx with structural markers reads as full_document (got {reading['depth']!r})")
    check(reading["signals"]["compulsory_briefing_mentioned"] is True,
          "the .docx's own 'COMPULSORY BRIEFING' line is picked up as a real signal, not just raw text")
    scored = assess_tender.score_release(rel, reading, profile)
    check(scored["document_depth"] == "full_document", "score_release() completes on the .docx-derived reading without crashing")

    with tempfile.TemporaryDirectory() as td:
        scanned_url = make_blank_docx(td)
        rel = {"categories": ["uncategorized"], "closed": False, "is_closed": False, "title": "", "description": "",
               "documents": [{"url": scanned_url, "title": "scanned.docx"}]}
        reading = assess_tender.read_release(rel)
        check(reading["depth"] == "no_extractable_text", f"a pure scanned-image .docx reads as no_extractable_text (got {reading['depth']!r})")
        check("scanned image" in reading["confidence"],
              f"the honest scanned-image note reaches read_release()'s own confidence field (got {reading['confidence']!r})")
        scored = assess_tender.score_release(rel, reading, profile)
        check(scored["document_depth"] == "no_extractable_text",
              "score_release() completes on the scanned-image reading without crashing - one bad document never takes out the run")


if __name__ == "__main__":
    part1_fetch_document_text()
    part2_read_release_end_to_end()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
