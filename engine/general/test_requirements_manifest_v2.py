"""
Manifest v2 (2026-10-29, Sarel's own brief): mandatory_gates, extracted_roles,
pricing_schedule - all new, additive extraction, deliberately generic (no
tender-specific term hardcoded anywhere in requirements.py's own new code -
see that file's header comment on why: the brief's named benchmark PDF does
not exist anywhere in this environment, so nothing could be verified against
it). These tests use realistic but GENERIC South African tender phrasing,
not the missing document's own specific facts.

Run: python3 engine/general/test_requirements_manifest_v2.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import requirements as req  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------------------
# mandatory_gates
# ---------------------------------------------------------------------------

ISO_GATE_TEXT = """
Bidders must hold a valid ISO/IEC 27001:2013 certification covering their
information security management system. Failure to submit a valid ISO/IEC
27001 certificate will result in disqualification. A bidder with an expired
certificate may remedy this within 5 business days of notification.
"""

CREDENTIAL_GATE_TEXT = """
The lead resource for this engagement must hold a current SACPCMP
registration at practitioner level or above. Bids that do not provide proof
of SACPCMP registration for the nominated lead resource will be deemed
non-responsive and will not be considered further.
"""

JV_TEXT = "Bidders submitting as a joint venture must submit a signed joint venture agreement with this bid."


def test_iso_gate_extracted_generically():
    gates = req.extract_mandatory_gates(ISO_GATE_TEXT, [])
    iso = [g for g in gates if g["type"] == "iso_certification"]
    check("a real ISO/IEC standard mentioned with mandatory wording is extracted as a gate", len(iso) == 1, iso)
    if iso:
        check("the gate's label is the real standard number, not a guess", "27001" in iso[0]["label"])
        check("disqualification language nearby marks it fatal", iso[0]["fatal"] is True)
        check("a real cure-window phrase nearby is read as cure_days, not invented", iso[0]["cure_days"] == 5)


def test_generic_named_credential_gate_not_hardcoded_to_any_one_body():
    gates = req.extract_mandatory_gates(CREDENTIAL_GATE_TEXT, [])
    cred = [g for g in gates if g["type"] == "mandatory_credential"]
    check("a real professional-body registration named near disqualification wording is extracted", len(cred) >= 1, cred)
    if cred:
        check("the extracted label is the real credential text seen in the document", any("SACPCMP" in g["label"] for g in cred))


def test_no_gate_language_means_no_gates():
    check("ordinary scope text with no mandatory/ISO/disqualification language yields zero gates",
          req.extract_mandatory_gates("This contract covers routine office cleaning services at three sites.", []) == [])


def test_jv_gate_surfaces_the_same_returnable_fact_not_a_second_read():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "bundle.txt")
        with open(path, "w") as f:
            f.write(JV_TEXT)
        manifest = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"))
    jv_returnable = next((r for r in manifest["returnables"] if r["key"] == "jv_agreement"), None)
    jv_gate = next((g for g in manifest["mandatory_gates"] if g["type"] == "jv_agreement"), None)
    check("the JV returnable was detected", jv_returnable is not None)
    check("the same JV fact also appears as a mandatory gate", jv_gate is not None)
    if jv_returnable and jv_gate:
        check("the gate's label is exactly the returnable's own label - never a second, independent description",
              jv_gate["label"] == jv_returnable["label"])


# ---------------------------------------------------------------------------
# extracted_roles (additive - never replaces the 17 coded roles)
# ---------------------------------------------------------------------------

KEY_RESOURCE_TEXT = """
SECTION 6: KEY RESOURCE SCHEDULE

Data Engineer
Minimum 8 years of relevant experience. AWS Certified Solutions Architect
preferred. Submit CV on Annexure B.

Change Management Specialist
Minimum 6 years of relevant experience.

This is a line with 10 years mentioned but no role title above it at all.
"""


def test_dynamic_role_extracted_with_years_and_cover_page():
    docs = [{"name": "bundle.txt", "text": KEY_RESOURCE_TEXT}]
    roles = req.extract_dynamic_roles(docs)
    titles = {r["title"] for r in roles}
    check("a role title not among the 17 hardcoded construction codes is still extracted", "Data Engineer" in titles, titles)
    data_eng = next((r for r in roles if r["title"] == "Data Engineer"), None)
    if data_eng:
        check("its real minimum-years figure is read, not guessed", data_eng["min_years"] == 8)
        check("a real cert mentioned nearby is captured", any("AWS" in c for c in data_eng["qualifications_and_certs"]), data_eng["qualifications_and_certs"])
        check("the real cover-page annexure named nearby is captured", data_eng["cover_page"] == "Annexure B")
    change_mgmt = next((r for r in roles if r["title"] == "Change Management Specialist"), None)
    check("a second, differently-worded role title in the same schedule is also extracted", change_mgmt is not None)


def test_no_key_resource_section_means_no_dynamic_roles():
    docs = [{"name": "bundle.txt", "text": "Data Engineer with 8 years experience is mentioned in passing, with no key resource schedule heading anywhere."}]
    check("a role-shaped phrase with NO key-resource/Section 6/Annexure B heading nearby is not extracted (too weak a signal alone)",
          req.extract_dynamic_roles(docs) == [])


def test_existing_17_coded_roles_are_untouched_by_the_new_extractor():
    docs = [{"name": "bundle.txt", "text": "The contracts manager must have 10 years of site experience."}]
    coded = req.find_roles(docs)
    check("find_roles() (the existing 17-code extractor) still works exactly as before", any(r["role_code"] == "contractor.contract_manager" for r in coded), coded)


# ---------------------------------------------------------------------------
# pricing_schedule
# ---------------------------------------------------------------------------

DELIVERABLES_TEXT = """
SCHEDULE OF DELIVERABLES

1. Inception Report
2. Current State Assessment
3. Strategy Document
4. Implementation Framework

The contract price is payable per deliverable above. 15% VAT is applicable
to all amounts quoted.
"""


def test_fixed_deliverables_extracted_with_vat():
    sched = req.extract_pricing_schedule(DELIVERABLES_TEXT)
    check("a real numbered deliverable schedule is found", sched is not None)
    if sched:
        check("type is fixed_deliverables when real numbered items were found", sched["type"] == "fixed_deliverables")
        check("all 4 real numbered items are extracted, in order", [d["item"] for d in sched["deliverables"]] == [1, 2, 3, 4], sched["deliverables"])
        check("the real stated VAT percentage is read, not assumed to be the SA standard 15% by default", sched["vat_percentage"] == 15.0)


def test_lump_sum_without_a_deliverables_list_reuses_the_existing_classifier():
    sched = req.extract_pricing_schedule("This is a lump sum contract. No schedule of deliverables is attached.")
    check("a lump-sum mention with no numbered schedule still classifies via the existing extract_pricing_model()", sched is not None and sched["type"] == "lump_sum")
    if sched:
        check("no deliverables are invented when none were found", sched["deliverables"] == [])


def test_no_pricing_signal_at_all_returns_none_not_a_guess():
    check("plain scope text with no pricing-model or deliverables language returns None, never a fabricated default",
          req.extract_pricing_schedule("This contract covers routine office cleaning services.") is None)


def main():
    test_iso_gate_extracted_generically()
    test_generic_named_credential_gate_not_hardcoded_to_any_one_body()
    test_no_gate_language_means_no_gates()
    test_jv_gate_surfaces_the_same_returnable_fact_not_a_second_read()
    test_dynamic_role_extracted_with_years_and_cover_page()
    test_no_key_resource_section_means_no_dynamic_roles()
    test_existing_17_coded_roles_are_untouched_by_the_new_extractor()
    test_fixed_deliverables_extracted_with_vat()
    test_lump_sum_without_a_deliverables_list_reuses_the_existing_classifier()
    test_no_pricing_signal_at_all_returns_none_not_a_guess()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
