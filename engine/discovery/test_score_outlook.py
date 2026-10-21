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


def main():
    test_unrelated_municipalities_do_not_falsely_match()
    test_legitimate_city_of_prefix_still_matches()
    test_exact_name_match_still_works()
    test_renamed_municipality_still_matches()
    test_no_sweep_collisions_among_real_municipality_names()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
