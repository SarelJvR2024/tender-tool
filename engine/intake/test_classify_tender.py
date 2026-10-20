"""
Focused tests for classify_tender.py's classify_documents() - specifically its
.docx branch, which had no dedicated test file before this (test_manual_intake.py
needs Postgres so it isn't in CI; it also only covers the happy path end to end).

Finding (2026-10-20, thirty-fifth run, docs/specs/QA-Edge-Case-Findings.md): the
.xlsm branch already logs a note when a workbook can't be opened ("unreadable" ->
notes.append(...)), but the parallel .docx branch's `except Exception: continue`
silently dropped a corrupt/mislabeled SANRAL .docx form with no trace at all. The
downstream "missing documents" message then told the user the document was simply
"not found" even though they HAD uploaded it - it just couldn't be read. Fixed by
logging a note in the .docx branch's exception handler too, mirroring the .xlsm
branch's existing pattern.

Run: python3 engine/intake/test_classify_tender.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import classify_tender as ct  # noqa: E402
import docx  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _doc_entry(name, local, fmt="docx"):
    return {"name": name, "format": fmt, "_local": local, "unreadable": None}


def test_corrupt_docx_is_noted_not_silently_dropped(tmp_path="/tmp"):
    print("classify_documents: a corrupt/garbage .docx SANRAL form")
    path = os.path.join(tmp_path, "C.1.1.1 Form of Offer (corrupt).docx")
    with open(path, "wb") as f:
        f.write(b"not really a docx, just garbage bytes")
    decision = ct.classify_documents([_doc_entry("C.1.1.1 Form of Offer (corrupt).docx", path)],
                                      buyer="SANRAL", all_text="SANRAL tender")
    check("a note is logged for the unreadable .docx (not silently dropped)",
          any("C.1.1.1 Form of Offer (corrupt).docx" in n and "could not be opened" in n
              for n in decision["notes"]), decision["notes"])
    check("it is not registered as a found SANRAL file",
          "c111_form_of_offer" not in decision["sanral_files"])
    os.remove(path)


def test_valid_docx_is_classified_with_no_spurious_note(tmp_path="/tmp"):
    print("classify_documents: a real, readable C.1.1.1 Form of Offer .docx")
    path = os.path.join(tmp_path, "C.1.1.1 Form of Offer.docx")
    d = docx.Document()
    d.add_paragraph("C1.1.1 FORM OF OFFER (Incorporating SBD7)")
    d.save(path)
    decision = ct.classify_documents([_doc_entry("C.1.1.1 Form of Offer.docx", path)],
                                      buyer="SANRAL", all_text="SANRAL tender")
    check("no note is logged for a readable docx that matched", decision["notes"] == [], decision["notes"])
    os.remove(path)


def test_docx_already_marked_unreadable_is_skipped_without_a_note():
    print("classify_documents: a doc_entry already flagged unreadable upstream")
    entry = _doc_entry("whatever.docx", "/tmp/does-not-matter.docx")
    entry["unreadable"] = "already flagged by requirements.py"
    entry["_local"] = None  # not even checked since _local is falsy anyway, but exercises the real shape
    decision = ct.classify_documents([entry], buyer="SANRAL", all_text="SANRAL tender")
    check("no note is added for a doc_entry with no _local path at all", decision["notes"] == [])


def main():
    test_corrupt_docx_is_noted_not_silently_dropped()
    test_valid_docx_is_classified_with_no_spurious_note()
    test_docx_already_marked_unreadable_is_skipped_without_a_note()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
