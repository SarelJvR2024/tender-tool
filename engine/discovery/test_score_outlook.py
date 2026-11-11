"""
Focused tests for score_outlook.py's match_locality()/_area_matches() - no
dedicated test file existed for this module before this (only exercised
indirectly, as a dependency, by test_discovery_fanout.py/
test_discovery_downgrades.py/test_digest_live.py).

Finding (2026-10-21, docs/specs/QA-Edge-Case-Findings.md): _area_matches()'s
substring-match leg compared bare, space-stripped letters (_norm_area()
throws away every space), so a company office in one real South African
municipality could "match" a tender's locality requirement for a totally
different, unrelated municipality purely because one name's letters happen
to run inside the other's - e.g. "Nala" (a Free State local municipality)
sits inside "Kannaland" (Western Cape) as a bare 4-letter run. Reproduced
live through the real match_locality(): an office whose ONLY location is
Kannaland was reported "matched... office in Kannaland matches 'Nala'" and
awarded real locality preference points for an area it has nothing to do
with. Fixed by keeping word boundaries for the substring check
(_norm_area_words()) so the match must be a whole word/phrase, not an
arbitrary run of letters - verified against the rule's own legitimate case
("City of Tshwane" vs "Tshwane") and a sweep of ~140 real municipality
names for any other such coincidental collision.

Run: python3 engine/discovery/test_score_outlook.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import score_outlook as so  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def office(**kw):
    base = {"province": None, "district_municipality": None, "local_municipality": None, "town": None}
    base.update(kw)
    return base


def loc(area, points=5, level="local", system=None):
    return {"rows": [{"level": level, "area": area, "points": points, "system": system}]}


def test_unrelated_municipalities_do_not_falsely_match():
    print("a company office in Kannaland (Western Cape) vs a tender locality row for Nala (Free State)")
    result = so.match_locality(loc("Nala"), [office(province="Western Cape", local_municipality="Kannaland")])
    check("no false match - these are unrelated, real, different municipalities",
          result["status"] == "no_match", result)


def test_legitimate_city_of_prefix_still_matches():
    print("the rule's own intended case: 'City of Tshwane' (tender text) vs office local_municipality 'Tshwane'")
    result = so.match_locality(loc("City of Tshwane", points=10), [office(province="Gauteng", local_municipality="Tshwane")])
    check("still matches - 'City of' is legitimate administrative wording, not a coincidental run of letters",
          result["status"] == "matched" and result["points"] == 10, result)


def test_exact_name_match_still_works():
    print("an exact area/office name match (no substring reasoning needed at all)")
    result = so.match_locality(loc("Polokwane", points=8), [office(province="Limpopo", local_municipality="Polokwane")])
    check("exact match still works", result["status"] == "matched" and result["points"] == 8, result)


def test_renamed_municipality_still_matches():
    print("Mpofana (current name) vs Mooi Mpofana (its own former name, same real place) - a legitimate near-miss")
    result = so.match_locality(loc("Mpofana"), [office(province="KwaZulu-Natal", local_municipality="Mooi Mpofana")])
    check("a municipality's former/current name pair still matches (same real place, not coincidental)",
          result["status"] == "matched", result)


def test_no_sweep_collisions_among_real_municipality_names():
    print("sweep of ~140 real SA municipality/district names for any other coincidental substring collision")
    import itertools
    names = [
        "Nkomazi", "Nkangala", "Mbombela", "Bushbuckridge", "Thaba Chweu", "Emalahleni", "Steve Tshwete",
        "Govan Mbeki", "Msukaligwa", "Lekwa", "Dipaleseng", "Victor Khanye",
        "Mogale City", "Mogalakwena", "Polokwane", "Lepelle-Nkumpi", "Molemole", "Thulamela",
        "Makhado", "Musina", "Collins Chabane", "Ba-Phalaborwa", "Greater Giyani", "Greater Letaba",
        "Greater Tzaneen", "Fetakgomo Tubatse", "Ephraim Mogale", "Elias Motsoaledi",
        "Ditsobotla", "Matlosana", "Ngaka Modiri Molema", "Ramotshere Moiloa",
        "Mamusa", "Naledi", "Greater Taung", "Kagisano-Molopo", "Tswaing", "Ratlou",
        "Madibeng", "Moses Kotane", "Rustenburg", "Kgetlengrivier", "Moretele",
        "Emfuleni", "Midvaal", "Lesedi", "Merafong City", "Westonaria", "Randfontein",
        "Newcastle", "Nquthu", "Msinga", "Umvoti", "eDumbe", "uPhongolo", "Abaqulusi",
        "Nongoma", "Ulundi", "Big Five Hlabisa", "Mtubatuba", "uMhlathuze", "uMlalazi",
        "Mthonjaneni", "Nkandla", "Ndwedwe", "Maphumulo", "KwaDukuza", "Mandeni",
        "Hibiscus Coast", "Ezingoleni", "Vulamehlo", "Umdoni", "Umzumbe", "uMuziwabantu",
        "Ingwe", "Kwa Sani", "Greater Kokstad", "Ubuhlebezwe",
        "Emnambithi/Ladysmith", "Indaka", "Umtshezi", "Okhahlamba", "Imbabazane",
        "Endumeni", "Richmond", "uMngeni", "Mkhambathini", "Umshwathi", "Umsunduzi",
        "City of Johannesburg", "City of Tshwane", "City of Ekurhuleni", "City of Cape Town",
        "Mangaung", "Buffalo City", "Nelson Mandela Bay",
        "Fezile Dabi", "Metsimaholo", "Mafube", "Moqhaka", "Ngwathe",
        "Setsoto", "Dihlabeng", "Nketoana", "Maluti-a-Phofung", "Phumelela", "Mantsopa",
        "Mohokare", "Letsemeng", "Kopanong", "Masilonyana", "Tokologo",
        "Tswelopele", "Matjhabeng", "Nala",
        "Overstrand", "Cape Agulhas", "Swellendam", "Theewaterskloof", "Langeberg",
        "Breede Valley", "Witzenberg", "Drakenstein", "Stellenbosch", "Saldanha Bay",
        "Bergrivier", "Cederberg", "Matzikama", "Swartland", "Oudtshoorn", "Mossel Bay",
        "George", "Bitou", "Kannaland", "Hessequa", "Beaufort West", "Laingsburg", "Prince Albert",
    ]
    # Mpofana/Mooi Mpofana (same real place, former/current name) is the one
    # known, legitimate near-miss - excluded from "unexpected" below.
    expected = {frozenset(("Mpofana", "Mooi Mpofana"))}
    hits = [(a, b) for a, b in itertools.combinations(names, 2)
            if frozenset((a, b)) not in expected and so._area_matches(a, {"local_municipality": b})]
    check(f"no unexpected collisions among {len(names)} distinct real municipality names",
          hits == [], hits)


OVERBERG_TEXT = """
LOCALITY / PREFERENCE POINTS

Within the boundaries of Overberg District Municipality 6
Within the boundaries of the Western Cape Province 4

Proof of locality will be verified from the CIPC/CIPRO company registration
documents - Address of registered office.
"""

CAPE_WINELANDS_TEXT = """
LOCALITY PREFERENCE POINTS

An enterprise whose head office or primary place of business or regional
or satellite office is located within the boundaries of the Cape Winelands
District Municipal Area 5
Within the boundaries of the Western Cape Province 5

Proof: a municipal account not older than 90 days, a lease agreement, or a
bank letter confirming the business address.
"""

# uMlalazi LM (docs/specs/Tender-Evaluation-Engine-Audit.md "Round 2" (c)):
# a real, live-fetched tender that states a locality rule TWICE for the same
# area under two genuinely different mechanics - a specific-goals preference
# table (4/2/1) AND a separate functionality scorecard criterion (10/5/2),
# verbatim per that doc's own table.
UMLALAZI_TEXT = """
SPECIFIC GOALS

Enterprise Located within uMlalazi Municipality 4
Enterprise Located within District Municipality 2
Enterprise Located within the Province 1

FUNCTIONALITY CRITERIA

Bidder operating within uMlalazi Municipality (Points = 10)
"""


def test_extract_locality_flags_registered_office_only_language():
    print("Overberg DM's own real wording (docs/specs/Tender-Evaluation-Engine-Audit.md, 'Round 2': "
          "'verified from the CIPC/CIPRO ... Address of registered office') - 'registered office only'")
    loc = so.extract_locality(OVERBERG_TEXT)
    check("both rows extracted", len(loc["rows"]) == 2, loc["rows"])
    check("both rows flagged requires_registered_office",
          all(r["requires_registered_office"] for r in loc["rows"]), loc["rows"])


def test_extract_locality_does_not_flag_any_office_language():
    print("Cape Winelands DM's own real wording ('...head office or primary place of business or regional "
          "or satellite office...') - deliberately 'any office', never registered-office-only")
    loc = so.extract_locality(CAPE_WINELANDS_TEXT)
    check("both rows extracted", len(loc["rows"]) == 2, loc["rows"])
    check("neither row flagged requires_registered_office",
          not any(r["requires_registered_office"] for r in loc["rows"]), loc["rows"])


def test_registered_office_only_row_rejects_a_non_registered_office():
    print("Finding (standing review, 2026-11-10): a row flagged requires_registered_office used to match ANY "
          "office_kind at all - office_kind/proof_type exist on company_offices (migration 0015's own header: "
          "'the kind of office ... matters ... Overberg only accepts the CIPC registered office') but neither "
          "match_locality() nor _area_matches() ever read office_kind. Reproduced live: a mere 'branch' office in "
          "the exact right district used to be reported 'matched' and awarded the real points for Overberg's own "
          "registered-office-only rule.")
    loc = so.extract_locality(OVERBERG_TEXT)
    branch = {"province": "Western Cape", "district_municipality": "Overberg District",
              "local_municipality": None, "town": None, "office_kind": "branch"}
    result = so.match_locality(loc, [branch])
    check("a branch office (not the registered one) no longer satisfies a registered-office-only row",
          result["status"] == "no_match", result)


def test_registered_office_only_row_still_matches_the_real_registered_office():
    print("the fix's own other half: the company's real registered_office in the right district still matches")
    loc = so.extract_locality(OVERBERG_TEXT)
    registered = {"province": "Western Cape", "district_municipality": "Overberg District",
                  "local_municipality": None, "town": None, "office_kind": "registered_office"}
    result = so.match_locality(loc, [registered])
    check("the real registered office still matches and still scores the full points",
          result["status"] == "matched" and result["points"] == 6, result)


def test_any_office_row_is_unaffected_by_the_fix():
    print("control: a row with no registered-office-only language (Cape Winelands' own 'any office' rule) "
          "still matches a plain branch office, exactly as before")
    loc = so.extract_locality(CAPE_WINELANDS_TEXT)
    branch = {"province": "Western Cape", "district_municipality": "Cape Winelands District",
              "local_municipality": None, "town": None, "office_kind": "branch"}
    result = so.match_locality(loc, [branch])
    check("a branch office still satisfies a rule that genuinely accepts any office kind",
          result["status"] == "matched" and result["points"] == 5, result)


def test_extract_locality_keeps_both_kinds_as_separate_rows_for_the_same_area():
    print("uMlalazi LM: a specific-goals row and a functionality row for the SAME area are both extracted, not deduped")
    loc = so.extract_locality(UMLALAZI_TEXT)
    umlalazi_rows = [r for r in loc["rows"] if r["area"] == "uMlalazi"]
    kinds = sorted(r["kind"] for r in umlalazi_rows)
    check("both the specific_goals (4) and functionality (10) rows for 'uMlalazi' are present",
          kinds == ["functionality", "specific_goals"], loc["rows"])


def test_estimate_score_outlook_locality_match_does_not_leak_the_functionality_criterions_points():
    print("Finding 343, 2026-11-10: estimate_score_outlook()'s own `locality.match` - exactly what "
          "app/lib/scoreOutlookChips.ts reads for the Discovery page's 'Locality: matched (Xpt)' chip, right "
          "next to the 'Specific goals' chip - used to pick the single highest-scoring locality row ANY "
          "office satisfies with NO regard for `kind` at all (match_locality() was fed `locality` - every "
          "row, both kinds - unfiltered). uMlalazi LM states a locality rule twice for the SAME area: a "
          "4-point specific-goals preference row and a SEPARATE 10-point functionality-scorecard criterion "
          "- two different evaluation axes with no points in common. A company with an office there used to "
          "be told 'Locality: matched (10pt)' (the functionality criterion's points, picked purely because "
          "10 > 4) when the real specific-goals locality points are 4.")
    office = {"province": "KwaZulu-Natal", "district_municipality": None,
              "local_municipality": "uMlalazi", "town": None}
    result = so.estimate_score_outlook(UMLALAZI_TEXT, "full", {"offices": [office]}, None)
    m = result["locality"]["match"]
    check("locality.match reports the specific_goals points (4), never the functionality criterion's own 10",
          m is not None and m["status"] == "matched" and m["points"] == 4.0 and m["row"]["kind"] == "specific_goals", m)


def test_estimate_score_outlook_locality_match_is_still_none_with_no_offices():
    print("control: no offices on file still reports 'unknown' through the fixed call site, same as before")
    result = so.estimate_score_outlook(UMLALAZI_TEXT, "full", {"offices": []}, None)
    check("no offices -> unknown, not a crash or a false match",
          result["locality"]["match"]["status"] == "unknown", result["locality"]["match"])


def test_experience_evidence_merge_keeps_scored_per_project_from_either_restatement():
    print("extract_experience_evidence(): the SAME rule restated twice (SANRAL/Transnet's own documented "
          "shape, this function's own docstring) - first as a plain 'at least 3 projects' statement with "
          "no ladder, later (beyond the merge gap) as a real 1/2/3 -> points scoring table for the same "
          "project count and evidence type. The two restatements must merge into one rule (same count, "
          "same evidence, same 'requires_appointment_and_completion') - and that merged rule must not "
          "silently lose the fact that the SECOND restatement showed it's scored per project, the same "
          "way practical_completion_excluded/disqualification_mentioned are already OR'd across a merge.")
    text = (
        "3.2 Experience: Tenderers must have completed at least 3 (three) similar projects of similar "
        "scope in the last 10 (ten) years. Submit reference letters as proof.\n"
        + ("Padding line filler text to separate the two windows beyond the 1200-character merge gap. " * 40)
        + "\nScoring table for company experience (reference letters):\n"
        "1 Completed project 10\n"
        "2 Completed projects 20\n"
        "3 Completed projects 30\n"
    )
    result = so.extract_experience_evidence(text)
    check("the two restatements merged into exactly one rule, not two", len(result["rules"]) == 1, result["rules"])
    r = result["rules"][0]
    check("the merged rule's projects_required is still 3", r["projects_required"] == 3, r)
    check("the merged rule's scored_per_project is True - the ladder restatement must not be lost",
          r["scored_per_project"] is True, r)


def main():
    test_unrelated_municipalities_do_not_falsely_match()
    test_legitimate_city_of_prefix_still_matches()
    test_exact_name_match_still_works()
    test_renamed_municipality_still_matches()
    test_no_sweep_collisions_among_real_municipality_names()
    test_extract_locality_flags_registered_office_only_language()
    test_extract_locality_does_not_flag_any_office_language()
    test_registered_office_only_row_rejects_a_non_registered_office()
    test_registered_office_only_row_still_matches_the_real_registered_office()
    test_any_office_row_is_unaffected_by_the_fix()
    test_extract_locality_keeps_both_kinds_as_separate_rows_for_the_same_area()
    test_estimate_score_outlook_locality_match_does_not_leak_the_functionality_criterions_points()
    test_estimate_score_outlook_locality_match_is_still_none_with_no_offices()
    test_experience_evidence_merge_keeps_scored_per_project_from_either_restatement()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
