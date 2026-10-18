"""
engine/discovery/tender_enrichment.py - industry/discipline tag classifier
(tested across several UNRELATED industries, not just roads/civil, per
Sarel's instruction that the feature must work for ANY industry) and the
scope/pricing/BOQ/value-band extraction, including its null-when-unknown
behaviour (System-Status.md "we stop, we never guess" principle).

No network, no database - pure functions only (see module docstring: enrich()
takes plain text in, returns a plain dict out).

    python3 engine/discovery/test_tender_enrichment.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ["TT_TAXONOMY_SOURCE"] = "seed"
import taxonomy  # noqa: E402
import tender_enrichment as te  # noqa: E402

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("FAIL:", msg)


# ---------------------------------------------------------------------------
# Cross-industry classifier examples - construction/civil is deliberately
# only ONE of several, so this can't quietly be Klipcorp/roads-biased.
# ---------------------------------------------------------------------------

def test_cross_industry_tags():
    tax = taxonomy.active()

    # 1. Security services (not engineering/construction at all)
    ind, disc = te.classify_tags(
        "Appointment of a service provider for guarding and access control services",
        "The Department requires 24-hour armed guarding, access control and patrol services at "
        "its regional offices for a period of 36 months.",
        taxonomy=tax,
    )
    check("security_facilities" in ind, f"security tender should tag industry security_facilities, got {ind}")
    check(len(disc) >= 1, f"security tender should match a specific discipline, got {disc}")

    # 2. IT / software (not engineering/construction at all)
    ind, disc = te.classify_tags(
        "Request for proposal: supply, implementation and support of an ERP system",
        "The municipality requires a cloud-hosted ERP system including financial system, "
        "database and ongoing system support and maintenance.",
        taxonomy=tax,
    )
    check("it_telecoms" in ind, f"IT tender should tag industry it_telecoms, got {ind}")
    check("software_systems" in disc or "it_support_managed_services" in disc,
          f"IT tender should match a software/support discipline, got {disc}")

    # 3. Environmental (not engineering/construction at all)
    ind, disc = te.classify_tags(
        "Appointment of a specialist to conduct an environmental impact assessment",
        "An EIA and basic assessment, including a wetland and biodiversity specialist study, "
        "is required for the proposed development, together with a water use licence application.",
        taxonomy=tax,
    )
    check(len(disc) >= 1 and "environmental_assessment" in disc,
          f"environmental tender should match environmental_assessment, got {disc}")
    check("professional_services" in ind, f"environmental tender should tag industry professional_services, got {ind}")

    # 4. Professional services / consulting (not engineering/construction)
    ind, disc = te.classify_tags(
        "Appointment of a consultant to conduct a feasibility study",
        "A transaction advisory and feasibility study, including a business case and due "
        "diligence, is required to support a public private partnership.",
        taxonomy=tax,
    )
    check("professional_services" in ind, f"consulting tender should tag industry professional_services, got {ind}")
    check("feasibility_research_advisory" in disc, f"consulting tender should match feasibility study, got {disc}")

    # 5. Construction/civil - included, but only as ONE of five, not the template
    ind, disc = te.classify_tags(
        "Construction of a new access road and stormwater drainage",
        "The works comprise construction of an access road, kerbing, paving and stormwater "
        "drainage infrastructure.",
        taxonomy=tax,
    )
    check("roads_civil" in ind, f"road tender should tag industry roads_civil, got {ind}")

    # Tags are always a subset of the real taxonomy slugs, never a fabricated label
    for slugs in (ind, disc):
        for s in slugs:
            check(s in tax.by_slug, f"tag {s!r} is not a real discipline_categories slug")

    # Every matched discipline also carries its own group as an industry tag
    ind, disc = te.classify_tags("Supply and installation of CCTV cameras",
                                  "Supply, delivery and installation of a CCTV surveillance system "
                                  "including monitoring and access control.", taxonomy=tax)
    for d in disc:
        check(tax.parent_of(d) in ind, f"discipline {d} matched but its group {tax.parent_of(d)} missing from industry_tags {ind}")


def test_gibberish_text_tags_empty_not_wrong():
    ind, disc = te.classify_tags("asdkjhasd", "qweoiuqwe zxcvzxcv", taxonomy=taxonomy.active())
    check(ind == [] and disc == [], f"nonsense text should match nothing, got {ind}, {disc}")


# ---------------------------------------------------------------------------
# Pricing model
# ---------------------------------------------------------------------------

def test_pricing_model():
    check(te.extract_pricing_model("Pricing shall be on a lump sum basis.") == "lump_sum", "lump sum not detected")
    check(te.extract_pricing_model("Tenderers must price the attached Bill of Quantities.") == "boq_based",
          "BOQ not detected")
    check(te.extract_pricing_model("Payment is on a schedule of rates basis.") == "schedule_of_rates",
          "schedule of rates not detected")
    check(te.extract_pricing_model("This is a cost-reimbursable contract.") == "cost_reimbursable",
          "cost reimbursable not detected")
    check(te.extract_pricing_model("Supply of stationery to head office.") is None,
          "pricing model should be None when nothing is stated")


# ---------------------------------------------------------------------------
# BOQ presence-only detection
# ---------------------------------------------------------------------------

def test_boq_reference_never_fabricates_items():
    r = te.detect_boq_reference("Tenderers must complete the attached Bill of Quantities.")
    check(r["referenced"] is True, "BOQ mention should be detected")
    check(r["items"] == [], "BOQ items must always be empty - no line-item parser exists")
    r2 = te.detect_boq_reference("Supply of office furniture.")
    check(r2["referenced"] is False, "no BOQ mention should not be flagged as referenced")
    r3 = te.detect_boq_reference("General maintenance services.", documents=[{"title": "Bill_of_Quantities.xlsx"}])
    check(r3["referenced"] is True, "a BOQ-named document should be detected even with no text mention")


# ---------------------------------------------------------------------------
# Value band - the null-when-unknown behaviour is the important case
# ---------------------------------------------------------------------------

def test_value_band_null_when_unknown():
    band, basis, amount, note = te.estimate_value_band("Supply and delivery of office furniture to three branches.")
    check(band is None, f"no stated value should leave the band null, got {band}")
    check(basis == "unknown", f"basis should be 'unknown' when nothing is stated, got {basis}")
    check(amount is None, "raw amount should be null when nothing is stated")
    check(note, "an honest note should explain why the band is unknown")


def test_value_band_stated_amount_is_banded_correctly():
    cases = [
        ("The estimated contract value is R3 500 000.", "R0-5m"),
        ("Contract value: R15 million.", "R5-20m"),
        ("The engineer's estimate is R35,000,000.", "R20-50m"),
        ("Estimated project value of R120 million over the contract period.", "R50m+"),
        # Comma as the DECIMAL separator, space as thousands - a real, common
        # SA format (award_outcomes.py's own docstring: "R551 189,00" is
        # R551,189.00). QA-Edge-Case-Findings.md, 2026-10-18: this used to
        # come back as R150,000,000 (every comma stripped like a thousands
        # separator) - a 100x-too-high band, R50m+ instead of R0-5m.
        ("The estimated contract value is R1 500 000,00 including VAT.", "R0-5m"),
    ]
    for text, expected in cases:
        band, basis, amount, note = te.estimate_value_band(text)
        check(band == expected, f"{text!r} -> expected {expected}, got {band}")
        check(basis == "stated_in_text", f"{text!r} should have basis stated_in_text, got {basis}")
        check(amount is not None, f"{text!r} should have a parsed raw amount")


def test_value_band_ignores_unanchored_rand_amounts():
    """A stray Rand figure with no value/budget anchor (a document fee, a
    deposit) must NOT be read as the project value - this is the case most
    likely to produce a wrong, silently-trusted number."""
    band, basis, _, _ = te.estimate_value_band("Tender documents are obtainable on payment of a non-refundable "
                                                "deposit of R250.00 per set.")
    check(band is None, f"an unanchored document-fee amount must not be banded as a project value, got {band}")
    check(basis == "unknown", "basis should stay unknown for an unanchored amount")


# ---------------------------------------------------------------------------
# Scope summary
# ---------------------------------------------------------------------------

def test_scope_summary_from_description_is_labelled_not_a_summary():
    summary, source = te.extract_scope_summary("Road maintenance", "Routine maintenance of gravel roads in Ward 4.")
    check(summary == "Routine maintenance of gravel roads in Ward 4.", "scope summary should be the description text")
    check(source == "description_text", "scope_source should say this is raw description text, not a real summary")


def test_scope_summary_prefers_document_scope_heading_when_available():
    doc_text = "TENDER DATA\n\nSCOPE OF WORK\nThe works comprise rehabilitation of 12km of gravel road "\
               "including drainage structures and signage.\n\nRETURNABLE SCHEDULE\n..."
    summary, source = te.extract_scope_summary("Road works", "short advert text", document_text=doc_text)
    check("rehabilitation of 12km" in summary, f"should use the document's own SCOPE OF WORK text, got {summary!r}")
    check(source == "document_scope_snippet", "scope_source should say it came from the document, not the advert")


def test_scope_summary_none_when_nothing_available():
    summary, source = te.extract_scope_summary(None, None)
    check(summary is None and source is None, "no title/description/document should leave scope honestly null")


# ---------------------------------------------------------------------------
# enrich() end to end
# ---------------------------------------------------------------------------

def test_enrich_end_to_end_shape():
    result = te.enrich(
        "Appointment of a service provider for cleaning and security services",
        "Guarding, access control and cleaning services at municipal buildings for 24 months. "
        "The estimated contract value is R8 000 000, paid on a schedule of rates basis.",
        taxonomy=taxonomy.active(),
    )
    check("security_facilities" in result["industry_tags"], f"missing industry tag: {result}")
    check(result["pricing_model"] == "schedule_of_rates", f"pricing model wrong: {result['pricing_model']}")
    check(result["value_band"] == "R5-20m", f"value band wrong: {result['value_band']}")
    check(result["value_band_basis"] == "stated_in_text", "basis should be stated_in_text")
    check(result["confidence"] == "heuristic", "confidence should be heuristic with no document text supplied")
    check(result["boq_summary"]["items"] == [], "boq items should always be empty")


def main():
    test_cross_industry_tags()
    test_gibberish_text_tags_empty_not_wrong()
    test_pricing_model()
    test_boq_reference_never_fabricates_items()
    test_value_band_null_when_unknown()
    test_value_band_stated_amount_is_banded_correctly()
    test_value_band_ignores_unanchored_rand_amounts()
    test_scope_summary_from_description_is_labelled_not_a_summary()
    test_scope_summary_prefers_document_scope_heading_when_available()
    test_scope_summary_none_when_nothing_available()
    test_enrich_end_to_end_shape()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
