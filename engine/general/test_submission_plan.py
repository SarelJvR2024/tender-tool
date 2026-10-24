"""
Regression test for submission_plan.compile_plan() - the first version of
the "assessment engine" Sarel asked for (2026-10-21): "assesses each tender,
each page, each field and compiles a plan of how to prepare a submission".

Covers: status classification for every step category (form/buyer_form/
returnable/role/question/cidb_grading/briefing/gap), that a returnable
already on the company's vault reads "ready" and one that isn't reads
"needs_document", that a company-less plan never claims anything is ready
from company data, that gap de-duplication against form steps actually
works (Finding 40/42's own real documents are reused here, not re-typed -
same discipline as every reader's test this session), and that a plan never
crashes on the documents already known to be edge cases (scanned/unreadable,
a combined bulletin).

Run: python3 engine/general/test_submission_plan.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import requirements as req  # noqa: E402
import submission_plan as sp  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _plan_for(text, company=None):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "bundle.txt")
        with open(path, "w") as f:
            f.write(text)
        manifest = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_plan_test_"))
        return sp.compile_plan(manifest, company)


def _step(plan, step_id):
    return next((s for s in plan["steps"] if s["id"] == step_id), None)


# --- a synthetic SBD bundle exercising every step category -----------------

SBD_BUNDLE = """
SBD 1: INVITATION TO BID
Name of bidder: ________
SBD 4: DECLARATION OF INTEREST
Are you presently in the service of the state?
This tender requires a valid B-BBEE certificate or sworn affidavit - bidders must attach it.
Bidders must submit a copy of the company registration documents (CIPC).
CIDB registration: a CIDB grading of 7GB or higher is required for this contract.
A compulsory briefing session will be held - attendance is compulsory.
The successful bidder's project manager must have 5 years' experience.
"""

COMPANY_WITH_BEE = {"bee_proof_document_path": "s3://vault/bee-cert.pdf", "cidb_grading": "9GB"}
COMPANY_WITHOUT_BEE = {"cidb_grading": "5GB"}

plan_no_company = _plan_for(SBD_BUNDLE, None)
plan_with_bee = _plan_for(SBD_BUNDLE, COMPANY_WITH_BEE)
plan_low_cidb = _plan_for(SBD_BUNDLE, COMPANY_WITHOUT_BEE)

check("a returnable with no company at all reads needs_document, never ready",
      _step(plan_no_company, "returnable:bbbee_proof")["status"] == "needs_document")
check("the same returnable reads ready once the company's own vault path is set",
      _step(plan_with_bee, "returnable:bbbee_proof")["status"] == "ready")
check("a returnable with no vault column at all (CIPC - always supplied per-tender) is always needs_document",
      _step(plan_with_bee, "returnable:cipc_documents")["status"] == "needs_document")
check("a role with no company-side person data is always needs_input, never ready",
      any(s["category"] == "role" and s["status"] == "needs_input" for s in plan_no_company["steps"]))
check("a compulsory briefing is surfaced as its own needs_input step",
      _step(plan_no_company, "briefing") is not None and _step(plan_no_company, "briefing")["status"] == "needs_input")
check("CIDB grading with no company grading on file reads needs_input",
      _step(plan_no_company, "cidb_grading")["status"] == "needs_input")
check("CIDB grading with a company grading on file reads review (compare, don't assume pass)",
      _step(plan_low_cidb, "cidb_grading")["status"] == "review")

# --- ambiguous CIDB grading across documents (Finding, 2026-10-24): an -----
#     addendum correcting the grading requirement must not be silently -----
#     outvoted by the original notice, the exact bug class Finding 61 -------
#     already fixed for SANRAL closing time/delivery address --------------

CIDB_NOTICE = "This tender requires CIDB contractor grading of at least 6CE for interested bidders.\n"
CIDB_ADDENDUM = "ADDENDUM No 1: CIDB grading of at least 8CE is now required for this contract.\n"


def _plan_for_files(texts, company=None):
    with tempfile.TemporaryDirectory() as d:
        paths = []
        for i, text in enumerate(texts):
            path = os.path.join(d, f"doc{i}.txt")
            with open(path, "w") as f:
                f.write(text)
            paths.append(path)
        manifest = req.extract_requirements(paths, work_dir=tempfile.mkdtemp(prefix="tt_plan_test_"))
        return manifest, sp.compile_plan(manifest, company)


_, plan_single_cidb_mention = _plan_for_files([CIDB_NOTICE])
check("a single CIDB grading mention is not flagged ambiguous",
      not _step(plan_single_cidb_mention, "cidb_grading")["detail"].count("More than one different CIDB grading"))

manifest_two_cidb, plan_two_cidb_mentions = _plan_for_files([CIDB_NOTICE, CIDB_ADDENDUM], {"cidb_grading": "9GB"})
check("two different CIDB gradings across documents are detected as ambiguous in the manifest",
      manifest_two_cidb["cidb"]["ambiguous"] is True, manifest_two_cidb["cidb"])
check("the FIRST mention (6CE, the now-superseded original) is still the one shown - unchanged default, "
      "same as before this fix - but the step's own detail says to check for a conflict",
      _step(plan_two_cidb_mentions, "cidb_grading")["title"] == "CIDB grading 6CE required"
      and "More than one different CIDB grading was found" in _step(plan_two_cidb_mentions, "cidb_grading")["detail"],
      _step(plan_two_cidb_mentions, "cidb_grading"))

# --- de-duplication: a gap restating a by-hand/overlay form's own reason is -
#     dropped, since that form already has its own step with the same text --

check("no 'gap' step duplicates text already on a 'form'/'buyer_form' step",
      not any(g["category"] == "gap" and any(
          g["detail"] == f["detail"] for f in plan_no_company["steps"] if f["category"] in ("form", "buyer_form"))
          for g in plan_no_company["steps"]),
      [g["detail"][:60] for g in plan_no_company["steps"] if g["category"] == "gap"])

# --- real documents already in this corpus (Finding 40/42's own fixtures) --

eskom_dir = os.path.join(REPO, "templates", "general_samples", "eskom_e3703cxmwp")
eskom_manifest = req.extract_requirements([eskom_dir])
eskom_plan = sp.compile_plan(eskom_manifest)
check("Finding 40's real ESKOM Form A is a by_hand buyer_form step in the plan, not silently dropped",
      _step(eskom_plan, "buyer_form:eskom_form_a") is not None and
      _step(eskom_plan, "buyer_form:eskom_form_a")["status"] == "by_hand")

bulletin_dir = os.path.join(REPO, "templates", "general_samples", "tshwane_gpm08_bulletin")
bulletin_manifest = req.extract_requirements([bulletin_dir])
bulletin_plan = sp.compile_plan(bulletin_manifest)
check("Finding 42's real combined-bulletin PDF produces exactly one blocked step, nothing else",
      len(bulletin_plan["steps"]) == 1 and bulletin_plan["steps"][0]["status"] == "blocked",
      bulletin_plan["steps"])
check("...and the step says why, not a generic message",
      "multiple tenders" in bulletin_plan["steps"][0]["detail"])

# --- summary counts always add up, every status accounted for -------------

for plan in (plan_no_company, plan_with_bee, eskom_plan, bulletin_plan):
    check(f"summary total ({plan['summary']['total']}) matches len(steps) ({len(plan['steps'])})",
          plan["summary"]["total"] == len(plan["steps"]))
    check("every step's status is a known one",
          all(s["status"] in sp.STATUS_ORDER for s in plan["steps"]))

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
