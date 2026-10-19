"""
Focused tests for generate_cv.py's cover page (add_cover_page()) - the
tender-specific "this is why this person fits this position" page built on
top of suggest_pack.py's own stored scoring (never a new matcher). No
dedicated test file existed for generate_cv.py before this (the standard,
non-tender-specific CV path is already smoke-tested end to end by
process_cv_jobs.py --self-test; this file covers the --tender/--position
cover-page path specifically, which that self-test doesn't exercise).

Finding (2026-10-19, thirtieth run, docs/specs/QA-Edge-Case-Findings.md): when
a person wasn't among suggest_pack.py's own scored candidates for a position,
add_cover_page()'s own "missing" provenance reason interpolated
`tender_ctx['candidate']!r` - which is exactly the `None` this branch is
guarded on, so the stored reason always rendered as the nonsensical
"<name> not present in None candidates list for position <code>..." on
literally every occurrence. Fixed to describe the real situation instead.

Run: python3 engine/cv/test_generate_cv.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import generate_cv as gc  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402
import docx  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _tender_ctx(candidate):
    return {
        "contract_no": "X.001-001-2026/1F", "closing_date": "2026-12-01",
        "position": {"code": "DS1", "description": "Structures specialist"},
        "candidate": candidate,
    }


def test_unmatched_candidate_reason_is_not_nonsensical():
    print("cover page: person not among suggest_pack.py's scored candidates for this position")
    d = docx.Document()
    log = ProvenanceLog(source="test")
    person = {"name": "Jane Doe"}
    gc.add_cover_page(d, person, "person_3", _tender_ctx(None), log)
    entry = next(e for e in log.entries if e["field_key"] == "cv_cover.position_match")
    check("the real bug: reason no longer says 'not present in None candidates list'",
          "None candidates" not in entry["reason"], entry["reason"])
    check("the fixed reason names the actual person_id and position code instead",
          "person_3" in entry["reason"] and "DS1" in entry["reason"], entry["reason"])
    check("status is still 'missing' (unchanged - only the wording was wrong)",
          entry["status"] == "missing")


def test_matched_candidate_logs_score_not_rationale_on_page():
    print("cover page: person IS a scored candidate for this position")
    d = docx.Document()
    log = ProvenanceLog(source="test")
    person = {"name": "Jane Doe"}
    candidate = {"specialism_warning": False, "rationale": "Matches DS1 keyword overlap", "score": 0.82}
    gc.add_cover_page(d, person, "person_3", _tender_ctx(candidate), log)
    check("match score is confirmed in provenance",
          any(e["field_key"] == "cv_cover.match_score" and e["value"] == "0.82" for e in log.entries))
    check("rationale is kept in provenance only (never printed on the buyer-facing page)",
          not any("Matches DS1 keyword overlap" in (p.text or "") for p in d.paragraphs))
    check("no specialism-warning paragraph for a candidate with no warning",
          not any("does not show direct evidence" in (p.text or "") for p in d.paragraphs))


def test_specialism_warning_shown_and_logged():
    print("cover page: a candidate flagged with no specialism evidence")
    d = docx.Document()
    log = ProvenanceLog(source="test")
    person = {"name": "Jane Doe"}
    candidate = {"specialism_warning": True, "rationale": "No keyword overlap found", "score": 0.3}
    gc.add_cover_page(d, person, "person_3", _tender_ctx(candidate), log)
    check("the warning paragraph is actually printed on the page",
          any("does not show direct evidence" in (p.text or "") for p in d.paragraphs))
    check("the warning is logged as assumed_default, not silently applied",
          any(e["field_key"] == "cv_cover.specialism_warning" and e["status"] == "assumed_default"
              for e in log.entries))


def main():
    test_unmatched_candidate_reason_is_not_nonsensical()
    test_matched_candidate_logs_score_not_rationale_on_page()
    test_specialism_warning_shown_and_logged()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
