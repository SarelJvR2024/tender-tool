"""
Regression test for process_pack_jobs.adapt_company() - the Supabase row ->
profile-dict adapter fill_a_forms.py/fill_docx_forms.py read. No dedicated
test existed anywhere in the repo before this pass (confirmed by grep).

Covers the professional_indemnity_insurance sub-dict specifically: each of
its 4 source columns (pi_insurance_insurer/_policy_number/_cover_zar/_expiry)
is independently nullable (migration 0014, no check constraint tying them
together), so a real company can have the cover amount and policy number on
file with the insurer name or expiry date still blank. Finding, 2026-10-25:
adapt_company() already gave period_from its own "not on file" placeholder
for this exact reason but left insurer/period_to as a bare None, which
fill_a_forms.py's A17 section then prints the literal word "None" into a
field_provenance entry marked log.confirmed() - the same "prints the word
None" bug class as Finding 49, just in a new field.

Run: python3 engine/pack/test_adapt_company.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import process_pack_jobs as ppj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


BASE_ROW = {
    "legal_name": "Test Co (Pty) Ltd",
    "pi_insurance_cover_zar": 5000000,
    "pi_insurance_policy_number": "POL123456",
}

# --- cover + policy number on file, insurer AND expiry still blank --------

pi_partial = ppj.adapt_company(dict(BASE_ROW, pi_insurance_insurer=None, pi_insurance_expiry=None))[
    "professional_indemnity_insurance"]
check("a blank insurer reads as an honest placeholder, not None",
      isinstance(pi_partial["insurer"], str) and pi_partial["insurer"] != "None", pi_partial["insurer"])
check("a blank expiry reads as an honest placeholder, not None",
      isinstance(pi_partial["period_to"], str) and pi_partial["period_to"] != "None", pi_partial["period_to"])

rendered = (f"R{pi_partial['limit_of_indemnity_zar']:,} (policy {pi_partial['policy_number']}, "
            f"{pi_partial['insurer']}, valid {pi_partial['period_from']} to {pi_partial['period_to']})")
check("the real fill_a_forms.py A17 f-string never contains the literal word None",
      "None" not in rendered, rendered)

# --- fully populated: unaffected -------------------------------------------

pi_full = ppj.adapt_company(dict(BASE_ROW, pi_insurance_insurer="Santam", pi_insurance_expiry="2027-06-30"))[
    "professional_indemnity_insurance"]
check("a fully populated policy keeps the real insurer name, not a placeholder",
      pi_full["insurer"] == "Santam", pi_full)
check("a fully populated policy keeps the real expiry date, not a placeholder",
      pi_full["period_to"] == "2027-06-30", pi_full)

# --- no cover/policy number at all: pi stays None, not a half-built dict --

comp_none = ppj.adapt_company(dict(BASE_ROW, pi_insurance_cover_zar=None, pi_insurance_policy_number=None,
                                   pi_insurance_insurer=None, pi_insurance_expiry=None))
check("no cover amount or policy number on file at all -> pi is None, not fabricated",
      comp_none["professional_indemnity_insurance"] is None)

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
