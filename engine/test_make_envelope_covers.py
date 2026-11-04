"""
Regression test for make_envelope_covers.py's own _safe_text() sanitizer.

Finding 125 (2026-11-04, SANRAL pack rotation): every text field this file
prints (contract_no, nra_ref, description, delivery_address, and the
company's own legal_name/registered_address/cipc_registration_number) is
read from a real, uncontrolled source - description/nra_ref/delivery_address
straight out of a tender's own scanned/OCR'd document text
(classify_tender.find_nra_reference()/find_delivery_address()), the same OCR
path already confirmed capable of misreading characters (see generate_cv.py's
own identically-named _safe_text(), fixed for this exact bug class in a
different file). python-docx (via lxml) raises ValueError("All strings must
be XML compatible...") on a control character - before this fix, one stray
control character anywhere in those fields crashed every paragraph in all
three envelope covers, and assemble_pack.py's own envelope-covers step has
no try/except around it, so this took down the WHOLE pack build, not just
the cover sheets.

No network, no real docx template needed - make_outer()/make_inner() only
need python-docx itself, which this repo already depends on.

Run: python3 engine/test_make_envelope_covers.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_envelope_covers as mec  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _profile(**company_overrides):
    comp = {"legal_name": "Klipcorp (Pty) Ltd"}
    comp.update(company_overrides)
    return {"company": comp}


def test_control_character_in_description_does_not_crash_the_outer_cover():
    print("make_outer(): a control character in the tender's own description (a realistic "
          "OCR artifact) must not crash cover generation")
    with tempfile.TemporaryDirectory() as out_dir:
        try:
            path = mec.make_outer(
                _profile(), None, out_dir, "SANRAL R.396-010-2025/1F", "NRA 2026/0071",
                "Routine ad-hoc\x0bmaintenance of R396 Section 1",  # \x0b: the exact control
                "2026-10-22", "12:00",                              # character this bug guards
            )
            check("make_outer() does not crash on a control character in description", True)
            check("the cover file was actually written", os.path.exists(path), path)
        except Exception as e:
            check("make_outer() does not crash on a control character in description", False,
                  f"{type(e).__name__}: {e}")


def test_control_character_in_delivery_address_does_not_crash_an_inner_cover():
    print("make_inner(): a control character in a delivery-address line (read straight out of "
          "OCR'd document text) must not crash cover generation")
    with tempfile.TemporaryDirectory() as out_dir:
        try:
            path = mec.make_inner(
                _profile(), None, out_dir, "SANRAL R.396-010-2025/1F", "NRA 2026/0071",
                "Routine ad-hoc maintenance of R396 Section 1", "2026-10-22", "12:00",
                1, "TECHNICAL SUBMISSION", "CONTAINS NO PRICING INFORMATION",
                delivery_address=["The Reception\x01Area", "20 Shoreward Drive", "Bay West"],
            )
            check("make_inner() does not crash on a control character in a delivery-address line", True)
            check("the cover file was actually written", os.path.exists(path), path)
        except Exception as e:
            check("make_inner() does not crash on a control character in a delivery-address line", False,
                  f"{type(e).__name__}: {e}")


def test_control_character_in_company_fields_does_not_crash():
    print("make_outer(): a control character in the company's own legal_name/registered_address/"
          "cipc_registration_number must not crash cover generation")
    with tempfile.TemporaryDirectory() as out_dir:
        profile = _profile(legal_name="Klip\x02corp (Pty) Ltd", registered_address="1 Main\x03Road",
                           cipc_registration_number="2015/12345\x0406")
        try:
            path = mec.make_outer(profile, None, out_dir, "SANRAL R.396-010-2025/1F", "NRA 2026/0071",
                                  "Routine maintenance of R396 Section 1", "2026-10-22", "12:00")
            check("make_outer() does not crash on control characters in company fields", True)
            d = mec.docx.Document(path)
            text = "\n".join(p.text for p in d.paragraphs)
            check("the control characters were stripped, not left in the real output",
                  "\x02" not in text and "\x03" not in text and "\x04" not in text, repr(text))
            check("the surrounding real text survived intact", "Klipcorp (Pty) Ltd" in text, text)
        except Exception as e:
            check("make_outer() does not crash on control characters in company fields", False,
                  f"{type(e).__name__}: {e}")


def test_real_text_with_no_control_characters_is_unchanged():
    print("_safe_text(): ordinary real text with no control characters is returned byte-identical")
    real = "Routine ad-hoc maintenance of R396 Section 1 (Gqeberha)"
    check("no-op on clean text", mec._safe_text(real) == real, mec._safe_text(real))


def main():
    test_control_character_in_description_does_not_crash_the_outer_cover()
    test_control_character_in_delivery_address_does_not_crash_an_inner_cover()
    test_control_character_in_company_fields_does_not_crash()
    test_real_text_with_no_control_characters_is_unchanged()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
