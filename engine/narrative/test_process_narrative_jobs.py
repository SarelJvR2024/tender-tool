import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import process_narrative_jobs as pnj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class StubSupabase:
    """Stands in for pnj.supabase_request - returns canned rows keyed by the
    path's resource name (the bit before '?'), so each adapter function can
    be tested without a real Supabase connection."""
    def __init__(self, tables):
        self.tables = tables
        self.calls = []

    def __call__(self, url, key, method, path, body=None):
        self.calls.append((method, path, body))
        resource = path.split("?", 1)[0]
        return self.tables.get(resource, [])


def _patch(monkeypatch_tables):
    stub = StubSupabase(monkeypatch_tables)
    original = pnj.supabase_request
    pnj.supabase_request = stub
    return stub, original


def test_load_key_people_computes_years_experience_from_graduation_date():
    today = datetime.date.today()
    graduated = today.replace(year=today.year - 10)
    stub, original = _patch({
        "people": [{"name": "Thabo Mahlangu", "role": "Site Agent", "ecsa_level": "Pr Eng",
                    "highest_description": "BEng Civil", "highest_graduated": graduated.isoformat()}],
    })
    try:
        people = pnj.load_key_people("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("one person returned", len(people) == 1)
    check("years_experience computed from the graduation date", people[0]["years_experience"] == 10,
          people[0]["years_experience"])
    check("name/role passed through", people[0]["name"] == "Thabo Mahlangu" and people[0]["role"] == "Site Agent")


def test_load_key_people_handles_missing_graduation_date():
    stub, original = _patch({
        "people": [{"name": "Jane Doe", "role": "QA Manager", "ecsa_level": None,
                    "highest_description": None, "highest_graduated": None}],
    })
    try:
        people = pnj.load_key_people("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("years_experience is None rather than raising when no graduation date is on file",
          people[0]["years_experience"] is None)


def test_load_key_people_handles_unparseable_graduation_date():
    stub, original = _patch({
        "people": [{"name": "Jane Doe", "role": "QA Manager", "ecsa_level": None,
                    "highest_description": None, "highest_graduated": "not-a-date"}],
    })
    try:
        people = pnj.load_key_people("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("an unparseable graduation date does not raise - years_experience stays None",
          people[0]["years_experience"] is None)


def test_load_experience_maps_columns_through():
    stub, original = _patch({
        "experience_items": [{"project_name": "N4 Upgrade", "client_name": "SANRAL",
                              "scope_summary": "Road rehabilitation", "value_rm": 45.2,
                              "completion_date": "2024-03-01", "performance_rating": "Excellent"}],
    })
    try:
        experience = pnj.load_experience("url", "key", "company-1")
    finally:
        pnj.supabase_request = original
    check("one experience item returned", len(experience) == 1)
    check("project_name passed through", experience[0]["project_name"] == "N4 Upgrade")
    check("value_rm passed through", experience[0]["value_rm"] == 45.2)


def test_load_other_companies_text_excludes_empty_generated_text():
    stub, original = _patch({
        "narrative_documents": [{"generated_text": "Some text"}, {"generated_text": None}, {"generated_text": ""}],
    })
    try:
        texts = pnj.load_other_companies_text("url", "key", "tender-1", "methodology", "company-1")
    finally:
        pnj.supabase_request = original
    check("only the non-empty generated_text is returned", texts == ["Some text"], texts)


def test_build_context_raises_generation_failed_when_company_row_is_missing():
    stub, original = _patch({"companies": [], "tenders": [{"contract_no": "X"}]})
    try:
        pnj.build_context("url", "key", {"company_id": "missing", "tender_id": "t1", "kind": "methodology",
                                          "user_guidance": "", "style_length": "standard",
                                          "style_detail": "detailed", "style_visual": "structured"})
        check("a missing company row should have raised GenerationFailed", False)
    except pnj.GenerationFailed:
        check("a missing company row raises GenerationFailed", True)
    finally:
        pnj.supabase_request = original


def test_build_context_assembles_the_shape_generate_narrative_expects():
    stub, original = _patch({
        "companies": [{"legal_name": "Mahlangu Civils", "how_we_work": "We run a single accountable site agent."}],
        "tenders": [{"contract_no": "N.004-010-2026/1F", "title": "N4 Rehabilitation", "buyer": "SANRAL",
                     "closing_date": "2026-11-15", "description": "Rehabilitate 40km of the N4."}],
        "people": [],
        "experience_items": [],
    })
    job = {"company_id": "c1", "tender_id": "t1", "kind": "methodology", "user_guidance": "Keep it concise.",
           "style_length": "concise", "style_detail": "high_level", "style_visual": "plain"}
    try:
        context = pnj.build_context("url", "key", job)
    finally:
        pnj.supabase_request = original
    check("kind passed through", context["kind"] == "methodology")
    check("tender context assembled", context["tender"]["buyer"] == "SANRAL")
    check("company context assembled", context["company"]["legal_name"] == "Mahlangu Civils")
    check("style assembled from the job's own style_* columns",
          context["style"] == {"length": "concise", "detail": "high_level", "visual": "plain"})
    check("user_guidance passed through", context["user_guidance"] == "Keep it concise.")


def main():
    test_load_key_people_computes_years_experience_from_graduation_date()
    test_load_key_people_handles_missing_graduation_date()
    test_load_key_people_handles_unparseable_graduation_date()
    test_load_experience_maps_columns_through()
    test_load_other_companies_text_excludes_empty_generated_text()
    test_build_context_raises_generation_failed_when_company_row_is_missing()
    test_build_context_assembles_the_shape_generate_narrative_expects()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
