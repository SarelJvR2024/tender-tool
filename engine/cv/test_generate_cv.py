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


def test_null_contract_no_is_logged_missing_not_falsely_confirmed():
    print("cover page: tender has no contract/NRA number on file (e.g. a manually-entered, "
          "non-SANRAL tender - app/app/tenders/new/ never collects one)")
    d = docx.Document()
    log = ProvenanceLog(source="test")
    person = {"name": "Jane Doe"}
    candidate = {"specialism_warning": False, "rationale": "Matches DS1 keyword overlap", "score": 0.82}
    tender_ctx = {
        "contract_no": None, "closing_date": "2026-12-01",
        "position": {"code": "DS1", "description": "Structures specialist"},
        "candidate": candidate,
    }
    gc.add_cover_page(d, person, "person_3", tender_ctx, log)
    entry = next(e for e in log.entries if e["field_key"] == "cv_cover.contract_no")
    check("Finding 371: a null contract_no is logged 'missing' (with a reason), never "
          "'confirmed' with a null value - the real bug was a bare log.confirmed(..., None)",
          entry["status"] == "missing" and entry["value"] is None and bool(entry["reason"]), entry)
    check("the cover table cell itself is still left blank, not crashed or printed as 'None'",
          not any("None" in (p.text or "") for p in d.paragraphs)
          and not any("None" in c.text for t in d.tables for r in t.rows for c in r.cells))


def test_real_contract_no_is_still_confirmed():
    print("cover page: tender DOES have a contract/NRA number on file (regression guard - "
          "the fix above must not turn a real value into 'missing' too)")
    d = docx.Document()
    log = ProvenanceLog(source="test")
    person = {"name": "Jane Doe"}
    gc.add_cover_page(d, person, "person_3", _tender_ctx(None), log)
    entry = next(e for e in log.entries if e["field_key"] == "cv_cover.contract_no")
    check("a real contract_no on file is still logged 'confirmed' with the real value",
          entry["status"] == "confirmed" and entry["value"] == "X.001-001-2026/1F", entry)


def test_person_name_cannot_escape_out_dir_via_path_traversal():
    print("output filename: a person name containing path-traversal characters")
    import tempfile
    out_dir = tempfile.mkdtemp(prefix="test_cv_out_")
    base_name = gc._safe_name("../../../../tmp/pwned_poc_cv")
    docx_path = os.path.join(out_dir, base_name + ".docx")
    real_out, real_docx = os.path.realpath(out_dir), os.path.realpath(docx_path)
    check("the resolved output path stays inside out_dir (no CWE-22 path traversal)",
          real_docx.startswith(real_out + os.sep), real_docx)


def test_person_name_extremely_long_does_not_crash_the_filename():
    print("output filename: an extremely long person name (free text, no DB/form length limit)")
    import tempfile
    long_name = "A" * 5000
    base_name = gc._safe_name(long_name)
    check("the sanitized name portion is truncated to a safe length (not 5000 chars)",
          len(base_name) <= 80, len(base_name))

    out_dir = tempfile.mkdtemp(prefix="test_cv_out_")
    profile_path = os.path.join(out_dir, "profile.json")
    import json
    json.dump({
        "company": {"legal_name": "Test Co"},
        "key_people": [{"name": long_name, "projects": [], "qualifications": {}}],
    }, open(profile_path, "w"))
    try:
        gc.generate(profile_path, 0, out_dir, "sanral_keyperson", "summary")
        check("generate() writes a real .docx for an extremely long name instead of "
              "raising OSError('File name too long')", True)
    except OSError as e:
        check("generate() writes a real .docx for an extremely long name instead of "
              "raising OSError('File name too long')", False, f"{type(e).__name__}: {e}")


def test_null_projects_and_qualifications_degrade_instead_of_crashing():
    print("a person row with explicit null projects/qualifications (not just missing)")
    person = {"name": "Jane Doe", "projects": None, "qualifications": None}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    try:
        gc.build_world_bank(profile, person, "person_1", "summary", None, None, log)
        check("build_world_bank does not crash on projects=None/qualifications=None", True)
    except Exception as e:
        check("build_world_bank does not crash on projects=None/qualifications=None", False, f"{type(e).__name__}: {e}")


def test_control_characters_are_stripped_not_crashed_on():
    print("a control character (realistic OCR artifact) in name/project text")
    person = {"name": "Jane\x0bDoe", "qualifications": {},
              "projects": [{"client_and_number": "Proj\x01A", "value_rm": 5, "position_held": "Engineer",
                             "start": "2020", "end": "2021", "contact": "Bob", "contact_phone": "012"}]}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    import tempfile
    try:
        doc = gc.build_world_bank(profile, person, "person_1", "summary", None, None, log)
        with tempfile.TemporaryDirectory() as d:
            doc.save(os.path.join(d, "test_control_char.docx"))
        check("a control character in profile text does not crash docx generation", True)
    except Exception as e:
        check("a control character in profile text does not crash docx generation", False, f"{type(e).__name__}: {e}")


def test_company_legal_name_control_character_in_footer_is_stripped_not_crashed_on():
    print("a control character in company legal_name (the footer every CV format shares) does not crash docx generation")
    person = {"name": "Jane Doe", "qualifications": {},
              "projects": [{"client_and_number": "Proj A", "value_rm": 5, "position_held": "Engineer",
                             "start": "2020", "end": "2021", "contact": "Bob", "contact_phone": "012"}]}
    profile = {"company": {"legal_name": "Test\x0bCo (Pty) Ltd"}}
    log = ProvenanceLog(source="test")
    import tempfile
    try:
        doc = gc.build_world_bank(profile, person, "person_1", "summary", None, None, log)
        footer_text = doc.paragraphs[-1].text
        with tempfile.TemporaryDirectory() as d:
            doc.save(os.path.join(d, "test_control_char_footer.docx"))
        check("a control character in company legal_name does not crash docx generation", True)
        check("the footer paragraph itself has the control character stripped", "\x0b" not in footer_text, repr(footer_text))
    except Exception as e:
        check("a control character in company legal_name does not crash docx generation", False, f"{type(e).__name__}: {e}")


def test_years_experience_uses_sast_not_naive_utc_today():
    print("Form B2.1: years-of-experience fallback 'as of today' uses SAST, not a naive UTC date")
    # Finding (2026-10-21): the standard (non-tender) CV path's fallback
    # "as of today" date was a naive datetime.date.today() - a bridge worker
    # container has no TZ set and runs in UTC by default, so this is one
    # calendar day behind real SAST for the 00:00-01:59 SAST window every
    # day (same bug class as Finding 37, engine/fill_a_forms.py). Fed
    # straight into suggest_pack.years_experience_at()'s rounded year count
    # (round((closing_date - grad).days / 365.25)) - a one-day shift flips
    # the rounded figure whenever a person's initial_graduated date sits
    # near the rounding boundary. "2026-04-21" is confirmed (by direct
    # search) to be exactly such a date for this SAST/UTC pair. Simulates
    # the system clock at UTC 2026-10-20 23:30 (= SAST 2026-10-21 01:30,
    # inside the bad window) by monkeypatching datetime.datetime.now,
    # restored immediately after.
    import datetime as real_datetime

    class FixedDateTime(real_datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            base = real_datetime.datetime(2026, 10, 20, 23, 30, tzinfo=real_datetime.timezone.utc)
            return base.astimezone(tz) if tz else base

    class FixedDate(real_datetime.date):
        @classmethod
        def today(cls):
            # What a naive datetime.date.today() would read under the same
            # fake UTC clock as FixedDateTime above - patched too so this
            # test still catches a regression to the OLD naive form, not
            # just a hypothetical one that happens to keep using datetime.now.
            return real_datetime.date(2026, 10, 20)

    profile = {"company": {"legal_name": "Test Co", "cipc_registration_number": "", "registered_address": ""}}
    person = {"name": "Test Person", "role": "Engineer",
              "qualifications": {"initial_graduated": "2026-04-21"}, "projects": []}
    real_dt, real_date = gc.datetime.datetime, gc.datetime.date
    gc.datetime.datetime, gc.datetime.date = FixedDateTime, FixedDate
    try:
        log = ProvenanceLog(source="test")
        gc.build_sanral_keyperson(profile, person, "p1", "summary", None, None, log)
    finally:
        gc.datetime.datetime, gc.datetime.date = real_dt, real_date
    entry = next(e for e in log.entries if e["field_key"] == "cv.b21.years_of_relevant_experience")
    check("years-of-experience is computed from the real SAST date (1), not the naive UTC one (0)",
          entry["value"] == "1", entry)


def test_world_bank_project_with_null_fields_does_not_print_the_word_none():
    print("build_world_bank: an ongoing project (end_date=None) and a missing referee/value "
          "must not render the literal word 'None' into a real, client-facing CV")
    # Finding (2026-10-21): dict.get(key, default) only substitutes `default`
    # when the key is ABSENT, not when it's present with value None -
    # start_date/end_date/value_rm/contact_name/contact_phone are all
    # nullable columns (0001_init_schema.sql's projects table), so a real
    # ongoing project (no end date yet - the single most common real shape,
    # true for almost any currently-employed person's latest project) or a
    # referee not yet captured sailed straight through as the bare string
    # "None" in the generated document. build_sanral_keyperson (same file,
    # same data) already guards the identical fields with `or` - this
    # sibling builder didn't.
    person = {"name": "Jane Doe", "role": "Engineer", "qualifications": {},
              "projects": [{"client_and_number": "Ongoing Project A/2022", "position_held": "Site Engineer",
                             "start": "2022-01-01", "end": None, "value_rm": None,
                             "contact": None, "contact_phone": None}]}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_world_bank(profile, person, "person_1", "full", None, None, log)
    text = next(p.text for p in doc.paragraphs if "Ongoing Project" in p.text)
    check("the open-ended project's end date reads '?', not the word 'None'",
          "None" not in text, text)
    check("a missing referee still reads 'MISSING', not 'None'", "MISSING" in text, text)
    check("the start date is still shown correctly", "2022-01-01" in text, text)


def test_world_bank_project_with_null_position_held_does_not_print_the_word_none():
    print("build_world_bank: a real project row with no captured position title "
          "(position_held=None) must not render the literal word 'None' into a real CV")
    # Finding 80 (2026-10-26): the Finding-49 test just above this one deliberately set
    # position_held="Site Engineer" (a valid value) because it was exercising the OTHER
    # nullable fields (end/value_rm/contact/contact_phone) - it never covered position_held
    # itself for THIS function. The 2026-10-23 fix for the sibling bug (build_sanral_keyperson
    # crashing on position_held=None) only touched that function and its own test - this one,
    # a plain f-string interpolation with no `or` guard at all, was left behind. Unlike
    # build_sanral_keyperson's _safe_text(None) crash, an f-string never raises - it silently
    # renders "Position: None" in a real, client-facing CV instead.
    person = {"name": "Jane Doe", "role": "Engineer", "qualifications": {},
              "projects": [{"client_and_number": "Real Project A/2022", "position_held": None,
                             "start": "2022-01-01", "end": "2023-01-01", "value_rm": 10,
                             "contact": "A Buyer", "contact_phone": "012 345 6789"}]}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_world_bank(profile, person, "person_1", "full", None, None, log)
    text = next(p.text for p in doc.paragraphs if "Real Project" in p.text)
    check("the missing position title reads '?', not the literal word 'None'",
          "None" not in text and "Position: ?" in text, text)
    check("the rest of the entry is unaffected (dates/value/referee all still correct)",
          "2022-01-01" in text and "2023-01-01" in text and "R10m" in text and "A Buyer" in text, text)


def test_sanral_keyperson_project_with_null_position_held_does_not_crash():
    print("build_sanral_keyperson: a real project row with no captured position title "
          "(position_held=None) must not crash CV generation for that person")
    # Finding (2026-10-23): dict.get(key, default) only substitutes `default`
    # when the key is ABSENT, not when it's present with value None -
    # position_held is a nullable column (0001_init_schema.sql's projects
    # table), and _safe_text(None) itself crashes (re.sub needs a string,
    # not None) - every OTHER nullable project field in this same function
    # already guards with `or ""` (the "or" pattern that fixed the sibling
    # build_world_bank() bug, Finding 49), position_held was the one left
    # behind. Worse than Finding 49's "prints the word None": this one
    # failed the whole CV generation job, not just rendered wrong text.
    person = {"name": "Jane Doe", "role": "Engineer", "qualifications": {},
              "projects": [{"client_and_number": "Real Project A/2022", "position_held": None,
                             "start": "2022-01-01", "end": "2023-01-01", "value_rm": 10,
                             "contact": "A Buyer", "contact_phone": "012 345 6789"}]}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    row = next(r for t in doc.tables for r in t.rows if any("Real Project" in c.text for c in r.cells))
    cells = [c.text for c in row.cells]
    check("the project renders at all (no crash) and the position cell is blank, not the word 'None'",
          cells[2] == "", cells)
    check("the rest of the row is unaffected (client/value/start/end/contact all still correct)",
          cells[0] == "Real Project A/2022" and cells[1] == "10" and cells[3] == "2022-01-01"
          and cells[4] == "2023-01-01" and cells[5] == "A Buyer", cells)


def test_world_bank_education_with_null_institution_does_not_log_the_word_none():
    print("build_world_bank: a qualification with a description but no institution/graduation "
          "date yet must not log 'confirmed' with the literal word 'None' in its provenance entry")
    # Finding (2026-10-25, standing review pass): highest_description/
    # highest_institution/highest_graduated are three independently nullable
    # columns (0001_init_schema.sql's people table) - a real person can have
    # a qualification description on file with the institution or graduation
    # date not yet captured. The document cells already guard with `or ""`
    # (rendering blank, not "None"), but the field_provenance log entry
    # interpolated institution/date raw, so it recorded "confirmed" with the
    # literal word "None" in it - same bug class as Finding 49/73, just in
    # the provenance record rather than the visible document.
    person = {
        "name": "Jane Doe", "role": "Engineer", "projects": [],
        "qualifications": {
            "highest_description": "BSc Civil Engineering", "highest_institution": None, "highest_graduated": None,
        },
    }
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_world_bank(profile, person, "person_1", "full", None, None, log)
    text = next(p.text for p in doc.paragraphs if "BSc Civil Engineering" in p.text) if any(
        "BSc Civil Engineering" in p.text for p in doc.paragraphs) else ""
    entry = next(e for e in log.entries if e["field_key"] == "cv.wb.education.BSc Civil Engineering")
    check("the provenance entry is 'confirmed', not downgraded", entry["status"] == "confirmed", entry)
    check("the provenance entry's value does not contain the literal word 'None'",
          "None" not in entry["value"], entry["value"])
    check("the visible document cell for institution is blank, not the word 'None'", "None" not in text, text)


def test_sacpcmp_registration_date_now_appears_on_form_b21():
    print("build_sanral_keyperson: Form B2.1's own SACPCMP registration date, not just the "
          "number, must now reach the generated CV document")
    # Finding 120 (2026-11-03): fill_tender.py/fill_conventional.py's own
    # B["sacpcmp_date"] = "P41" proves the real SANRAL Form B2.1 has a
    # SACPCMP registration DATE field, same shape as ECSA's level+number+date -
    # but this function, which explicitly claims to mirror Form B2.1, only
    # ever showed SACPCMP's number, silently dropping a confirmed date a
    # company may have on file (extract_cv_fields.py's own PERSON_DATE_FIELDS
    # already extracts it, and process_pack_jobs.py's adapt_person() already
    # reads it - this was the one consumer that didn't).
    person = {"name": "Jane Doe", "role": "Engineer", "projects": [],
              "qualifications": {"sacpcmp_number": "SACPCMPREG12345", "sacpcmp_date": "2018-06-01"}}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    text = "\n".join(p.text for t in doc.tables for r in t.rows for p in r.cells[1].paragraphs)
    check("the SACPCMP registration date is now printed on the document",
          "2018-06-01" in text, text)
    entry = next(e for e in log.entries if e["field_key"] == "cv.b21.sacpcmp_registration_date")
    check("it is logged as confirmed (a real value on file), not missing",
          entry["status"] == "confirmed" and entry["value"] == "2018-06-01", entry)


def test_sacpcmp_registration_date_missing_degrades_honestly():
    print("build_sanral_keyperson: no SACPCMP registration date on file reads MISSING, not blank")
    person = {"name": "Jane Doe", "role": "Engineer", "projects": [],
              "qualifications": {"sacpcmp_number": "SACPCMPREG12345"}}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    entry = next(e for e in log.entries if e["field_key"] == "cv.b21.sacpcmp_registration_date")
    check("no date on file is logged as missing, with a reason, not silently blank",
          entry["status"] == "missing" and entry["reason"], entry)


def test_sacnasp_expiry_now_appears_on_form_b21():
    print("build_sanral_keyperson: a SACNASP/SAGC registration's own expiry date, not just its "
          "category and number, must now reach the generated CV document")
    # Finding (2026-11-03): people.sacnasp_expiry/sagc_expiry (0040) are real,
    # already-extracted, already-watched (watch_deadlines.py) columns - but
    # this row only ever printed category + number, same "stored and used
    # elsewhere, never reaches the CV" shape as Finding 120's SACPCMP date.
    person = {"name": "Jane Doe", "role": "Geologist", "projects": [],
              "qualifications": {"sacnasp_category": "Pr.Sci.Nat", "sacnasp_number": "SACNASP999",
                                  "sacnasp_expiry": "2027-06-30"}}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    text = "\n".join(p.text for t in doc.tables for r in t.rows for p in r.cells[1].paragraphs)
    check("the SACNASP expiry date is now printed on the document",
          "expires 2027-06-30" in text, text)
    entry = next(e for e in log.entries if e["field_key"] == "cv.b21.sacnasp_registration")
    check("it is logged as confirmed, with the expiry folded into the one composite value",
          entry["status"] == "confirmed" and "2027-06-30" in entry["value"], entry)


def test_sacnasp_expiry_missing_degrades_honestly():
    print("build_sanral_keyperson: a SACNASP registration with no expiry on file still prints "
          "category + number, with no 'expires None' text and no crash")
    person = {"name": "Jane Doe", "role": "Geologist", "projects": [],
              "qualifications": {"sacnasp_category": "Pr.Sci.Nat", "sacnasp_number": "SACNASP999"}}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    text = "\n".join(p.text for t in doc.tables for r in t.rows for p in r.cells[1].paragraphs)
    check("category and number still print", "SACNASP999" in text and "Pr.Sci.Nat" in text, text)
    check("no 'expires None' text leaked onto the document", "expires None" not in text, text)


def test_ecsa_and_sacpcmp_expiry_now_appear_on_form_b21():
    print("build_sanral_keyperson: ECSA's and SACPCMP's own registration EXPIRY, not just the "
          "date registered, must now reach the generated CV document")
    # Finding 121 (2026-11-03): people.ecsa_expiry/sacpcmp_expiry are real
    # columns (migration 0035_person_registration_expiry.sql) -
    # watch_deadlines.py's own TRACKED_PERSON_EXPIRY_FIELDS already watches
    # both for compliance reminders, proving they're real, live, actively
    # used data - but this function never displayed either expiry at all,
    # even after Finding 120 added SACPCMP's registration DATE and a sibling
    # pass added SACNASP/SAGC's own expiry two rows below. Same bug class,
    # just the two bodies that pass's own commit title didn't cover.
    person = {"name": "Jane Doe", "role": "Engineer", "projects": [],
              "qualifications": {"ecsa_level": "Professional Engineer", "ecsa_expiry": "2028-01-15",
                                  "sacpcmp_number": "SACPCMPREG12345", "sacpcmp_expiry": "2027-09-30"}}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    doc = gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    text = "\n".join(p.text for t in doc.tables for r in t.rows for p in r.cells[1].paragraphs)
    check("the ECSA registration expiry is now printed on the document", "2028-01-15" in text, text)
    check("the SACPCMP registration expiry is now printed on the document", "2027-09-30" in text, text)
    ecsa_entry = next(e for e in log.entries if e["field_key"] == "cv.b21.ecsa_registration_expiry")
    sacpcmp_entry = next(e for e in log.entries if e["field_key"] == "cv.b21.sacpcmp_registration_expiry")
    check("ECSA expiry is logged as confirmed", ecsa_entry["status"] == "confirmed" and ecsa_entry["value"] == "2028-01-15", ecsa_entry)
    check("SACPCMP expiry is logged as confirmed", sacpcmp_entry["status"] == "confirmed" and sacpcmp_entry["value"] == "2027-09-30", sacpcmp_entry)


def test_ecsa_and_sacpcmp_expiry_missing_degrades_honestly():
    print("build_sanral_keyperson: no ECSA/SACPCMP registration expiry on file reads MISSING")
    person = {"name": "Jane Doe", "role": "Engineer", "projects": [],
              "qualifications": {"ecsa_level": "Professional Engineer", "sacpcmp_number": "SACPCMPREG12345"}}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    gc.build_sanral_keyperson(profile, person, "person_1", "full", None, None, log)
    ecsa_entry = next(e for e in log.entries if e["field_key"] == "cv.b21.ecsa_registration_expiry")
    sacpcmp_entry = next(e for e in log.entries if e["field_key"] == "cv.b21.sacpcmp_registration_expiry")
    check("no ECSA expiry on file is logged as missing, with a reason", ecsa_entry["status"] == "missing" and ecsa_entry["reason"], ecsa_entry)
    check("no SACPCMP expiry on file is logged as missing, with a reason", sacpcmp_entry["status"] == "missing" and sacpcmp_entry["reason"], sacpcmp_entry)


def test_sanral_keyperson_position_in_team_is_logged_when_present():
    print("build_sanral_keyperson: Form B1.1's 'Position in team:' row - a real tender position "
          "description on file must be logged as confirmed, like every sibling field in the same "
          "table (Name, ID Number) already is")
    # Finding (standing solution-architect review, 2026-11-11): 'Position in team:' is written
    # into the real document (line 293) but, unlike Name (log.confirmed) and ID Number
    # (log.confirmed/log.missing) two lines below it in the exact same _kv_table call, NO
    # field_provenance entry was ever written for it at all - not confirmed, not missing,
    # nothing. generate_action_checklist.py only ever reads field_provenance entries, so a
    # genuinely blank 'Position in team:' cell (below) was completely invisible to
    # ACTIONS_TO_SIGN.md, worse than Findings 368/369/371/372 (which at least produced a
    # provenance entry, just the wrong status).
    person = {"name": "Jane Doe", "id_number": "8001015009087", "role": "Engineer", "projects": []}
    profile = {"company": {"legal_name": "Test Co"}}
    tender_ctx = {
        "contract_no": "X.001-001-2026/1F", "closing_date": "2026-12-01",
        "position": {"code": "DS1", "description": "Structures specialist"},
        "candidate": {"specialism_warning": False, "rationale": "r", "score": 0.5},
    }
    log = ProvenanceLog(source="test")
    gc.build_sanral_keyperson(profile, person, "person_1", "full", tender_ctx, None, log)
    entries = [e for e in log.entries if e["field_key"] == "cv.b11.position"]
    check("a field_provenance entry for the position now exists at all (the real bug: it didn't)",
          len(entries) == 1, entries)
    if entries:
        check("a real tender position description on file is logged 'confirmed' with that value",
              entries[0]["status"] == "confirmed" and entries[0]["value"] == "Structures specialist",
              entries[0])


def test_sanral_keyperson_position_in_team_blank_tender_description_logged_missing():
    print("build_sanral_keyperson: this tender's own stored SETUP-sheet position description is "
          "blank (a real shape - suggest_pack.read_required_positions() reads SETUP!<col>7 with no "
          "fallback at all) - must be logged 'missing', not silently absent from provenance")
    person = {"name": "Jane Doe", "id_number": "8001015009087", "role": "Engineer", "projects": []}
    profile = {"company": {"legal_name": "Test Co"}}
    tender_ctx = {
        "contract_no": "X.001-001-2026/1F", "closing_date": "2026-12-01",
        "position": {"code": "DS1", "description": ""},
        "candidate": {"specialism_warning": False, "rationale": "r", "score": 0.5},
    }
    log = ProvenanceLog(source="test")
    gc.build_sanral_keyperson(profile, person, "person_1", "full", tender_ctx, None, log)
    entry = next((e for e in log.entries if e["field_key"] == "cv.b11.position"), None)
    check("a blank tender position description is logged 'missing' (with a reason), not absent "
          "from provenance and not falsely 'confirmed' with an empty value",
          entry is not None and entry["status"] == "missing" and bool(entry["reason"]), entry)


def test_world_bank_position_blank_tender_description_logged_missing_not_falsely_confirmed():
    print("build_world_bank: a blank tender position description must be logged 'missing', not "
          "'confirmed' with the misleading placeholder sentence '(standard CV - no tender "
          "position)' - which falsely implies there IS no tender context when there actually is one")
    # Before the fix: log.confirmed("cv.wb.position", position_desc or "(standard CV - no tender "
    # "position)") ran unconditionally - a real tender_ctx with a genuinely blank SETUP-sheet
    # description got the exact same 'confirmed'-with-a-fabricated-sentence treatment as a
    # standalone CV with no tender context at all, hiding the real gap from ACTIONS_TO_SIGN.md
    # and mislabeling its own cause.
    person = {"name": "Jane Doe", "role": "Engineer", "qualifications": {}, "projects": []}
    profile = {"company": {"legal_name": "Test Co"}}
    tender_ctx = {
        "contract_no": "X.001-001-2026/1F", "closing_date": "2026-12-01",
        "position": {"code": "DS1", "description": ""},
        "candidate": {"specialism_warning": False, "rationale": "r", "score": 0.5},
    }
    log = ProvenanceLog(source="test")
    gc.build_world_bank(profile, person, "person_1", "full", tender_ctx, None, log)
    entry = next((e for e in log.entries if e["field_key"] == "cv.wb.position"), None)
    check("a blank tender position description is logged 'missing', not 'confirmed' with a "
          "fabricated placeholder sentence",
          entry is not None and entry["status"] == "missing" and bool(entry["reason"]), entry)
    check("the placeholder sentence is no longer written into field_provenance as a fake value",
          entry is not None and entry["value"] != "(standard CV - no tender position)", entry)


def test_world_bank_standalone_cv_no_role_logged_missing():
    print("build_world_bank: a standalone (non-tender) CV for a person with no 'role' on file - "
          "the position row must still be logged (missing, with a clear reason), not silently "
          "dropped from provenance the way it was before this fix")
    person = {"name": "Jane Doe", "qualifications": {}, "projects": []}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    gc.build_world_bank(profile, person, "person_1", "full", None, None, log)
    entry = next((e for e in log.entries if e["field_key"] == "cv.wb.position"), None)
    check("no role on file for a standalone CV is logged 'missing', with a reason",
          entry is not None and entry["status"] == "missing" and bool(entry["reason"]), entry)


def test_world_bank_standalone_cv_with_role_still_confirmed():
    print("build_world_bank: regression guard - a standalone CV for a person who DOES have a "
          "role on file must still log it as confirmed, same as before this fix")
    person = {"name": "Jane Doe", "role": "Senior Engineer", "qualifications": {}, "projects": []}
    profile = {"company": {"legal_name": "Test Co"}}
    log = ProvenanceLog(source="test")
    gc.build_world_bank(profile, person, "person_1", "full", None, None, log)
    entry = next((e for e in log.entries if e["field_key"] == "cv.wb.position"), None)
    check("a real role on file is still logged 'confirmed' with that value",
          entry is not None and entry["status"] == "confirmed" and entry["value"] == "Senior Engineer",
          entry)


def main():
    test_unmatched_candidate_reason_is_not_nonsensical()
    test_matched_candidate_logs_score_not_rationale_on_page()
    test_specialism_warning_shown_and_logged()
    test_null_contract_no_is_logged_missing_not_falsely_confirmed()
    test_real_contract_no_is_still_confirmed()
    test_person_name_cannot_escape_out_dir_via_path_traversal()
    test_person_name_extremely_long_does_not_crash_the_filename()
    test_null_projects_and_qualifications_degrade_instead_of_crashing()
    test_control_characters_are_stripped_not_crashed_on()
    test_company_legal_name_control_character_in_footer_is_stripped_not_crashed_on()
    test_years_experience_uses_sast_not_naive_utc_today()
    test_world_bank_project_with_null_fields_does_not_print_the_word_none()
    test_world_bank_project_with_null_position_held_does_not_print_the_word_none()
    test_sanral_keyperson_project_with_null_position_held_does_not_crash()
    test_world_bank_education_with_null_institution_does_not_log_the_word_none()
    test_sacpcmp_registration_date_now_appears_on_form_b21()
    test_sacpcmp_registration_date_missing_degrades_honestly()
    test_sacnasp_expiry_now_appears_on_form_b21()
    test_sacnasp_expiry_missing_degrades_honestly()
    test_ecsa_and_sacpcmp_expiry_now_appear_on_form_b21()
    test_ecsa_and_sacpcmp_expiry_missing_degrades_honestly()
    test_sanral_keyperson_position_in_team_is_logged_when_present()
    test_sanral_keyperson_position_in_team_blank_tender_description_logged_missing()
    test_world_bank_position_blank_tender_description_logged_missing_not_falsely_confirmed()
    test_world_bank_standalone_cv_no_role_logged_missing()
    test_world_bank_standalone_cv_with_role_still_confirmed()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
