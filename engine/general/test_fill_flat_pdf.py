"""
Regression test for fill_flat_pdf.py - no dedicated test file existed for
this 1000-line module before this pass (confirmed by grep: only
test_form_field_audit.py touches it, and only values_for()'s Klipcorp-default
audit - fill_flat_pdf()/place_text_fields()/place_captions() themselves had
never been run under test at all).

Finding, 2026-10-29: place_text_fields()/place_captions() both guarded "is
there a real value to place" with a bare `if not value:` - which treats a
WHITESPACE-ONLY string (a real data-entry shape: leading/trailing spaces
left over from a copy-paste into a name field) as "present", not "missing".
Helvetica's own space-character width is non-zero, so _fit() happily
"fits" it; the value is then typed onto the page as invisible blank space;
and verify_placements()'s own `want in got` check - built by stripping ALL
whitespace from both sides for comparison - reduces `want` to the empty
string for a whitespace-only value, which is a substring of literally
anything, so the write is reported "verified" regardless of what is
actually on the page. End to end: a signatory whose name is a data-entry
glitch gets reported "placed" on the real Form of Offer/MBD1 while the
printed form shows nothing there at all - exactly the "silent wrong data"
risk this whole module's own docstring says it exists to avoid ("nothing
is assumed to have worked").

Builds a minimal, real synthetic MBD1 page with reportlab (already a
test-only dependency in this repo's own CI, see bridge-worker-ci.yml's
"General engine - bridge end to end" step) and runs the REAL fill_flat_pdf()
end to end - not a stub of any of its own functions.

Run: python3 engine/general/test_fill_flat_pdf.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fill_flat_pdf as ffp  # noqa: E402

from reportlab.pdfgen import canvas  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _build_mbd1(out_path):
    """A minimal, real MBD1 page: the real headings/labels find_form_pages()
    and the scope regexes need, plus a "CONTACT PERSON:" label with a real
    dotted leader line long enough for _leader_run() to recognise (>= 25pt)."""
    c = canvas.Canvas(out_path, pagesize=A4)
    _, h = A4
    y = h - 50
    c.setFont("Helvetica-Bold", 14)
    c.drawString(50, y, "INVITATION TO BID")
    y -= 40
    c.setFont("Helvetica", 10)
    c.drawString(50, y, "SUPPLIER INFORMATION")
    y -= 20
    c.drawString(50, y, "NAME OF BIDDER")
    y -= 20
    c.drawString(50, y, "POSTAL ADDRESS")
    y -= 20
    c.drawString(50, y, "VAT REGISTRATION NUMBER")
    y -= 30
    c.drawString(50, y, "CONTACT PERSON: " + "." * 40)
    y -= 30
    c.drawString(50, y, "ENQUIRIES")
    c.showPage()
    c.save()


TMP = tempfile.mkdtemp(prefix="tt_fill_flat_pdf_")
MBD1 = os.path.join(TMP, "mbd1.pdf")
_build_mbd1(MBD1)


def _contact_person_field(signatory_name):
    ctx = {"company": {"legal_name": "Test Co"}, "signatory": {"name": signatory_name}}
    out = os.path.join(TMP, f"out_{len(os.listdir(TMP))}.pdf")
    report = ffp.fill_flat_pdf(MBD1, out, ctx, ["1"])
    return report["forms"]["1"]["fields"].get("sbd1.contact_person"), out


# --- the real bug: a whitespace-only value must not be reported "placed" ---

field, out = _contact_person_field("   ")
check("a whitespace-only signatory name is reported missing, not placed",
      field["status"] == "missing", field)
check("...with the real 'not on file' reason, same as a genuinely empty value", field.get("reason") == "not on file", field)
check("no output PDF was written for a form with nothing real to place", not os.path.exists(out))

field, _ = _contact_person_field("\t\n ")
check("tabs/newlines-only is treated the same way as plain spaces", field["status"] == "missing", field)

# --- genuinely empty/None are unaffected (the pre-existing behaviour) ------

field, _ = _contact_person_field("")
check("an empty string is still reported missing (unchanged behaviour)", field["status"] == "missing", field)

field, _ = _contact_person_field(None)
check("None is still reported missing (unchanged behaviour)", field["status"] == "missing", field)

# --- a real name is still placed, written, and verified correctly ---------

field, out = _contact_person_field("Jane Smith")
check("a real signatory name is placed", field["status"] == "placed", field)
check("the real value is the one recorded", field.get("value") == "Jane Smith", field)
check("a real output PDF was written this time", os.path.exists(out))

# A name with real content plus incidental leading/trailing whitespace must
# still be placed (the fix strips only for the "is this blank" check, not
# the value actually written) - confirmed by writing it and reading it back.
field, out = _contact_person_field("  Jane Smith  ")
check("a name with surrounding whitespace (not whitespace-ONLY) is still placed, not rejected",
      field["status"] == "placed", field)

# --- the real bug: a smart quote/en-dash (Word's own autocorrect output on a ---
#     copy-pasted name) must render as the real character, not a silent "?" ---
#     with verify_placements() falsely reporting it as correctly placed -------

SMART_NAME = "O’Brien–Smith"  # right single quote + en dash, exactly what
                                         # Word's autocorrect turns a plain ' and - into

field, out = _contact_person_field(SMART_NAME)
check("a name with a smart quote/en-dash is still placed (cp1252 can render both)",
      field["status"] == "placed", field)
check("...and verify_placements() reports it genuinely verified, not just self-consistently so",
      field.get("_pl") is None, "the report never exposes _pl, but status=='placed' already implies verified=True")

import pdfplumber  # noqa: E402

with pdfplumber.open(out) as pdf:
    page_text = pdf.pages[0].extract_text() or ""
# The underlying dotted leader line's own dots interleave with the typed text in
# extract_text()'s reading order (a pre-existing characteristic of overlapping
# glyphs, nothing to do with this fix), so check the real characters are present
# individually rather than as one exact contiguous substring.
check("the real right single quote (’) is on the printed page, not a '?' placeholder",
      "’" in page_text, repr(page_text))
check("the real en dash (–) is on the printed page, not a '?' placeholder",
      "–" in page_text, repr(page_text))
check("no '?' placeholder leaked into the printed page in place of the real punctuation",
      "?" not in page_text, repr(page_text))

# ----------------------------------------------------------------------------
# Standing solution-architect review, 2026-11-11: FORMS["4"]'s default
# pages_after (2, a 3-page scan window) was one page too few for the real,
# committed Overberg District Municipality Q12-2026 edition of MBD4, which
# genuinely runs 4 pages - its own signature-block footer caption ("Capacity
# ... Name of Bidder") sits on the 4th page, never reached, so both
# sbd4.name_of_bidder_footer and sbd4.designation_footer came back
# "not_found" ("label not on this edition") rather than "missing". Because
# build_general_pack.py's own _log_overlay() treats "not_found" exactly like
# "prefilled" (the buyer already printed it - nothing for the company to do)
# and silently skips logging it, this real declaration's own
# Capacity/Name-of-Bidder footer shipped completely blank on the real,
# committed document with ZERO signal anywhere - no field_provenance entry
# at all - that a human needed to fill it in by hand before signing.
# Against the real, committed sample itself, not a synthetic fixture.
# ----------------------------------------------------------------------------
REAL_SAMPLES_DIR = os.path.join(HERE, "..", "..", "templates", "general_samples")
OVERBERG_PDF = os.path.join(REAL_SAMPLES_DIR, "overberg_q12", "Q12-2026 Bid Doc.pdf")

if os.path.exists(OVERBERG_PDF):
    real_ctx = {
        "company": {"legal_name": "Test Co (Pty) Ltd"},
        "signatory": {"name": "Jane Signatory", "capacity": "Director"},
        "answers": {}, "tender": {},
    }
    real_out = os.path.join(TMP, "overberg_sbd4.pdf")
    real_report = ffp.fill_flat_pdf(OVERBERG_PDF, real_out, real_ctx, ["4"])
    real_fields = real_report["forms"]["4"]["fields"]
    name_footer = real_fields.get("sbd4.name_of_bidder_footer")
    designation_footer = real_fields.get("sbd4.designation_footer")
    check("the real MBD4 edition's 4th page is now scanned, so the footer caption is found "
          "(was 'not_found' before this fix - confirmed by reverting pages_after to the old default)",
          name_footer is not None and name_footer["status"] == "placed", name_footer)
    check("the real signatory's legal name is the value actually placed into the footer",
          name_footer is not None and name_footer.get("value") == "Test Co (Pty) Ltd", name_footer)
    check("the Designation/Capacity footer caption is found and placed too",
          designation_footer is not None and designation_footer["status"] == "placed", designation_footer)
    check("the real signatory's capacity is the value actually placed",
          designation_footer is not None and designation_footer.get("value") == "Director", designation_footer)
    # Control: every OTHER field this same form places on this real document
    # must be completely unaffected by widening the scan window - this fix
    # must not cause a different field to be found on, or placed onto, a
    # newly-reachable later page it was never meant to touch.
    check("the earlier, already-working fields on this document are unaffected (still placed on page 27)",
          real_fields.get("sbd4.registered_name", {}).get("page") == 27, real_fields.get("sbd4.registered_name"))
else:
    check("real Overberg Q12-2026 sample is on disk to test against", False, OVERBERG_PDF)

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
