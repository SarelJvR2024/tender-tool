"""
A tender's own C3.1.11(d) key-person minimums (key_person_minimums.py,
audit Q5 "rest of Q5: build it").

Part 1 (always): the two real SANRAL tables on file, as `pdftotext -layout`
excerpts in fixtures/c3111/ (verbatim, C3.1.11 heading to C3.1.12):
R.396-010-2025/1F Book 2/3 and N.011-010-2027-1F Books 2 & 3. Every row the
compliance check uses is asserted cell by cell against the documents, and
the differences between the two tenders - the reason this exists - come out:
Contract Engineer Pr Eng only (N.011) vs Pr Eng or Pr Tech Eng (R.396); RE
10-15 vs 5 years; ARE "Candidate Technician to Pr Eng", 5 years vs
"Registered Candidate", 2 years; a Quantity Surveyor row with SACQSP only in
N.011.

Part 2 (always): text without such a table - a Book 1, a general RFQ, a
mention of "C3.1.11" with no table - gives not_found (the caller then uses
R.396's table, labelled "Assumed rule").

Part 3 (when on disk): the full R.396 Book 2/3 PDF (templates/incoming,
gitignored) gives the same rows as its excerpt.

    python3 engine/discovery/test_key_person_minimums.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import key_person_minimums as kpm  # noqa: E402

FIX = os.path.join(HERE, "fixtures", "c3111")
R396_PDF = os.path.join(HERE, "..", "..", "templates", "incoming", "R.396-010-2025.1F", "R.396-010-2025-1F Tender Consultant",
                        "1.0_Tender Content", "R.396-010-2025.1F -Conventional Consulting Engineers - Book 2  3  - Aug 2025.pdf")
FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def rows_of(path):
    res = kpm.extract_key_person_minimums(open(path, encoding="utf-8").read())
    return res, {(r["position_code"] or r["specialist"]): r for r in res["rows"]}


def expect(rows, key, registration, years_text, years_min=None, years_under=None, qual=None, other=None, bodies=None, name=""):
    r = rows.get(key)
    if r is None:
        check(False, f"{name}: row {key} found")
        return
    ok = (r["registration"] == registration and r["years_text"] == years_text and r["years_min"] == years_min
          and r["years_under"] == years_under and (qual is None or r["qualification"] == qual)
          and (other is None or (r["other"] or "").startswith(other)) and (bodies is None or r["bodies"] == bodies))
    check(ok, f"{name} {key}: {r['position']!r} = {r['qualification']!r} / {r['years_text']!r} / {r['other']!r} -> {r['registration']}")


def part1():
    print("Part 1 - the two real SANRAL C3.1.11 tables")
    res, r396 = rows_of(os.path.join(FIX, "R.396-010-2025-1F_book2-3_C3.1.11.txt"))
    check(res["source"] == "tender_document" and len(res["rows"]) == 17 and not res["unparsed"],
          f"R.396: 17 rows, nothing unparsed ({len(res['rows'])}, {res['unparsed']})")
    n = "R.396"
    expect(r396, "PL", "pr_eng_or_tech", "10", 10, qual="Pr Eng or Pr Tech Eng", bodies=["ECSA"], name=n)
    expect(r396, "APL", "pr_eng_or_tech", "<10", None, 10, other="In permanent employment of the tendering entity or Targeted Enterprise", name=n)
    expect(r396, "DS", "pr_eng_or_tech", "10", 10, name=n)
    expect(r396, "ADS", "pr_eng_or_tech", "<10", None, 10, qual="Pr Eng or Pr Tech Eng", name=n)
    expect(r396, "surveyor", "sagc", "5", 5, qual="Registered Professional Surveyors, Technologist Surveyors, Technician Surveyors",
           other="Member of SAGC", bodies=["SAGC"], name=n)
    expect(r396, "engineering_geologist", "pr_sci_nat", "5", 5, qual="Pr Sci.Nat", other="SAIEG", bodies=["SACNASP", "SAIEG"], name=n)
    expect(r396, "environmental_practitioner", "refer", None, qual="Refer to sub-service procurement document", name=n)
    expect(r396, "ohs_specialist", "sacpcmp", "As required by SACPCMP", name=n)
    expect(r396, "road_safety_audit_team_leader", "pr_eng_or_tech", "10", 10,
           other="Road safety course (5 CPD) Minimum 2 (two) audits within 3 (three) years", name=n)
    expect(r396, "CE", "pr_eng_or_tech", "10", 10, qual="Pr Eng or Pr Tech Eng", name=n)
    expect(r396, "ACE", "pr_eng_or_tech", "<10", None, 10, name=n)
    expect(r396, "RE", "pr_eng_or_tech", "5", 5, qual="Pr Eng or Pr Tech Eng", name=n)
    expect(r396, "ARE", "candidate", "2", 2, qual="Registered Candidate (Engineer, Technologist or Technician)", name=n)
    expect(r396, "programmer", "qualification", "5-10", 5, qual="Bachelor’s degree in construction management, Civil Engineering, or a related field.",
           other="Proven on-site experience in construction planning and scheduling. Expertise in construction scheduling software", name=n)
    senior = next(r for r in res["rows"] if r["position"] == "Senior Materials Technician")
    check([(a["qualification"], a["years_text"]) for a in senior["alternatives"]] ==
          [("None specified", "20"), ("National Diploma in civil engineering", "10"), ("Pr Techni Eng", "5")],
          f"R.396 Senior Materials Technician: three alternatives none/20, ND/10, Pr Techni Eng/5 ({senior['alternatives']})")
    mat = next(r for r in res["rows"] if r["position"] == "Materials Technician")
    check([a["years_text"] for a in mat["alternatives"]] == ["10", "5", "2"], "R.396 Materials Technician: 10 / 5 / 2")
    check("quantity_surveyor" not in r396, "R.396 has no Quantity Surveyor row")

    res, n011 = rows_of(os.path.join(FIX, "N.011-010-2027-1F_books2-3_C3.1.11.txt"))
    check(res["source"] == "tender_document" and len(res["rows"]) == 18 and not res["unparsed"],
          f"N.011: 18 rows, nothing unparsed ({len(res['rows'])}, {res['unparsed']})")
    n = "N.011"
    expect(n011, "PL", "pr_eng_or_tech", "10", 10, other="In the permanent employment of the tendering entity", name=n)
    check(n011["PL"]["other"] == "In the permanent employment of the tendering entity",
          "N.011 PL: 'of the tendering entity' only - not R.396's 'or Targeted Enterprise' (APL's cell kept separate)")
    expect(n011, "APL", "pr_eng_or_tech", "<10", None, 10, other="In permanent employment of the tendering entity or Targeted Enterprise", name=n)
    expect(n011, "quantity_surveyor", "sacqsp", "5", 5,
           qual="Registered Professional Quantity Surveyors, Technologist Quantity Surveyors, Technician Quantity Surveyors",
           other="SACQSP", bodies=["SACQSP"], name=n)
    expect(n011, "surveyor", "sagc", "5", 5, qual="Registered Professional Surveyors, Technologist Surveyors, Technician Surveyors", name=n)
    expect(n011, "CE", "pr_eng", "10", 10, qual="Pr Eng", name=n)
    expect(n011, "RE", "pr_eng_or_tech", "10-15", 10, qual="Pr Eng or Pr Tech Eng", name=n)
    expect(n011, "ARE", "candidate", "5", 5, qual="Candidate Technician to Pr Eng", name=n)
    expect(n011, "ohs_specialist", "sacpcmp", "As required by SACPCMP", name=n)
    expect(n011, "trainee_technician", "candidate", "0", 0, qual="Candidate Technician", name=n)
    # what differs between the two tenders - the reason the tender's own table is read
    check(r396["CE"]["registration"] != n011["CE"]["registration"], "CE: R.396 Pr Eng or Pr Tech Eng vs N.011 Pr Eng only")
    check(r396["RE"]["years_min"] == 5 and n011["RE"]["years_min"] == 10, "RE: 5 years (R.396) vs 10-15 (N.011)")
    check(r396["ARE"]["years_min"] == 2 and n011["ARE"]["years_min"] == 5, "ARE: 2 years (R.396) vs 5 (N.011)")


def part2():
    print("Part 2 - no table -> not_found (the compliance check then labels R.396's table an assumption)")
    cases = {
        "a Book 1 cross-reference only": "measured from the base qualification as defined in clause C3.1.11(d); or\nthe proof of registration",
        "a general RFQ": "REQUEST FOR QUOTATION\nThe service provider must have 5 years experience. Minimum requirements: CSD registration.",
        "the heading with no table": "C3.1.11 Personnel Requirements\n\nd) Minimum requirements\n\nRefer to the Employer.\n\nC3.1.12 Meetings",
        "empty": "",
    }
    for name, text in cases.items():
        res = kpm.extract_key_person_minimums(text)
        check(res["source"] == "not_found" and not res["rows"], f"{name}: not_found ({res['reason']})")


def part3():
    if not os.path.exists(R396_PDF):
        print("Part 3 - skipped (R.396 Book 2/3 PDF not on this machine; templates/incoming is gitignored)")
        return
    print("Part 3 - the full R.396 Book 2/3 PDF")
    txt = subprocess.run(["pdftotext", "-layout", R396_PDF, "-"], capture_output=True, text=True).stdout
    full = kpm.extract_key_person_minimums(txt)
    exc, _ = rows_of(os.path.join(FIX, "R.396-010-2025-1F_book2-3_C3.1.11.txt"))
    check(full["rows"] == exc["rows"], f"whole document ({len(txt)} chars) reads the same {len(full['rows'])} rows as the excerpt")


if __name__ == "__main__":
    part1()
    part2()
    part3()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
