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

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
