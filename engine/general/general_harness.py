"""
Regression harness for the general (non-SANRAL) engine - the general-engine
half of System-Status known gap #2 ("admin_harness.py only exercises the
SANRAL path"). Parallel to engine/admin_harness.py on purpose (that file is
SANRAL-specific and being extended by the SANRAL agents), same idea:

  For every real tender in templates/general_samples/ (public eTenders
  documents from 9 buyers: SBD .docx bundles, SBD .docx single forms, a legacy
  .doc, flat-PDF SBD editions, a municipal single-PDF MBD bundle, an ESKOM zip
  with no standard forms) x every test company in config/test_companies/:
    1. extract the requirement manifest (requirements.py) and check it
       against the EXPECTED facts below - each one read by hand from the real
       document and recorded in docs/specs/General-Tender-Preparation-Findings.md;
    2. build the full pack (build_general_pack.py) with a fixed synthetic
       answer set and read it back (pdf_merge.verify_pack);
    3. compare the shape of the result - which provenance field keys landed
       in which status, which sections went into the pack, which were left
       out - with the stored baseline, and FLAG any change (a buyer edition
       the matcher no longer recognises, or a code change that silently
       changed what gets filled). The first clean run becomes the baseline.

Usage:
    python3 engine/general/general_harness.py [--reset] [--no-pack] [--only SAMPLE] [--store DIR]
Exit code 1 if any expectation fails, a pack fails its read-back, or a
baseline changed.
"""
import argparse
import glob
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import requirements as req  # noqa: E402
import build_general_pack as bgp  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SAMPLES = os.path.join(REPO, "templates", "general_samples")
TEST_COMPANIES = os.path.join(REPO, "config", "test_companies")
DEFAULT_STORE = os.path.join(REPO, "state", "general_harness_baselines")

# What each real document set must yield. Read by hand from the documents
# (findings doc, round 3) - not copied from a previous run of this code.
EXPECTED = {
    "dsti_rfq15": {"suite": "SBD", "auto": ["1", "4", "6.1"], "by_hand_fill": [], "returnables": ["csd_report", "tax_compliance", "bbbee_proof"]},
    "treasury_rt83": {"suite": "SBD", "auto": ["1", "4", "6.1"], "by_hand_fill": [], "returnables": []},
    "raf_pr10118921": {"suite": "SBD", "auto": ["4", "6.1"], "by_hand_fill": [], "returnables": []},  # SBD 4 is a legacy .doc
    "mthashana_tvet": {"suite": "SBD", "auto": ["1", "4", "6.1", "8", "9"], "by_hand_fill": [], "returnables": ["csd_report", "tax_compliance", "bbbee_proof"]},
    "tourism_nb143": {"suite": "SBD", "auto": ["4"], "by_hand_fill": [], "returnables": []},
    "ssa_change_mgmt": {"suite": "SBD", "auto": ["1", "4", "6.1"], "by_hand_fill": [], "returnables": ["financial_statements"]},
    # Flat PDFs: MBD/SBD 1, 4 and 9 are typed onto the printed page ("overlay",
    # fill_flat_pdf.py); 6.1 / 8 stay by hand. typed_keys = fields that must
    # come back "confirmed" from the typed PDF for every test company (they
    # only need the company name / registration numbers every fixture has).
    "salb_15-10-2026": {"suite": "SBD", "auto": [], "overlay": ["1", "4", "9"], "by_hand_fill": ["8"], "returnables": ["tax_compliance"],
                        "typed_keys": ["sbd1.name_of_bidder", "sbd1.street_address", "sbd9.name_of_bidder"]},
    "dawid_kruiper_tn051": {"suite": "MBD", "auto": [], "overlay": ["1", "4", "9"], "by_hand_fill": ["6.1", "8"],
                            "returnables": ["psira", "municipal_account"],
                            "roles": ["services.security_officer"], "mandatory_local_office": True,
                            "typed_keys": ["sbd1.name_of_bidder", "sbd1.street_address", "sbd4.company_registration_number",
                                           "sbd4.name_of_bidder_footer", "sbd9.name_of_bidder"]},
    "overberg_q12": {"suite": "MBD", "auto": [], "overlay": ["1", "4", "9"], "by_hand_fill": ["6.1"], "returnables": ["municipal_account"],
                     "buyer_forms_overlay": ["compulsory_enterprise_questionnaire", "form_of_offer"],
                     "typed_keys": ["sbd1.name_of_bidder", "sbd4.registered_name", "ceq.name_of_enterprise", "ceq.company_registration_number",
                                    "form_of_offer.tenderer"]},
    "ecdpwi_scmu5_0007": {"suite": "SBD", "auto": [], "overlay": ["1", "4"], "by_hand_fill": ["6.1"], "returnables": [],
                          "buyer_forms_overlay": ["compulsory_enterprise_questionnaire", "form_of_offer"],
                          "typed_keys": ["sbd1.name_of_bidder", "ceq.name_of_enterprise", "ceq.company_registration_number",
                                         "form_of_offer.tenderer"]},
    "eskom_e3689": {"suite": None, "auto": [], "by_hand_fill": [], "returnables": [], "buyer_forms_any": ["nec3_contract", "form_of_offer"]},
}

ANSWERS = {
    "total_bid_price": "R 1 000 000.00", "sbd1.accredited_representative": "no", "sbd4.employed_by_state": "no",
    "sbd4.relationship_with_employee": "no", "sbd4.interest_in_related_enterprise": "no", "sbd6_1.points_claimed": "B-BBEE level table",
    "sbd8.restricted_supplier": "no", "sbd8.tender_defaulter": "no", "sbd8.convicted": "no", "sbd8.contract_terminated": "no",
}


def check_expected(name, m):
    exp = EXPECTED.get(name)
    if not exp:
        return [f"no EXPECTED entry for sample '{name}' - add one before trusting it"]
    problems = []
    if m["form_suite"] != exp["suite"]:
        problems.append(f"suite {m['form_suite']} != {exp['suite']}")
    auto = sorted((f["code"] for f in m["forms"] if f["status"] == "auto"), key=float)
    if auto != exp["auto"]:
        problems.append(f"auto-filled forms {auto} != {exp['auto']}")
    overlay = sorted((f["code"] for f in m["forms"] if f["status"] == "overlay"), key=float)
    if overlay != exp.get("overlay", []):
        problems.append(f"typed-onto-PDF forms {overlay} != {exp.get('overlay', [])}")
    typed_buyer = {b["key"] for b in m["buyer_forms"] if b.get("overlay")}
    for k in exp.get("buyer_forms_overlay", []):
        if k not in typed_buyer:
            problems.append(f"buyer form '{k}' should be typed onto its PDF")
    hand = {f["code"] for f in m["forms"] if f["status"] == "by_hand"}
    for c in exp["by_hand_fill"]:
        if c not in hand:
            problems.append(f"form {c} should be by hand")
    keys = {r["key"] for r in m["returnables"]}
    for k in exp["returnables"]:
        if k not in keys:
            problems.append(f"returnable '{k}' not found")
    for role in exp.get("roles", []):
        if role not in {r["role_code"] for r in m["roles"]}:
            problems.append(f"role '{role}' not found")
    if exp.get("mandatory_local_office") and not m["locality"]["mandatory_local_office"]:
        problems.append("mandatory local office not found")
    if exp.get("buyer_forms_any") and not ({b["key"] for b in m["buyer_forms"]} & set(exp["buyer_forms_any"])):
        problems.append(f"none of the buyer forms {exp['buyer_forms_any']} found")
    return problems


def company_from_profile(profile):
    c = dict(profile["company"])
    person = profile["key_people"][0]
    return c, {"name": person["name"], "capacity": person.get("signatory_capacity")}


def signature(manifest, pack):
    sig = {
        "forms": {f["code"]: f["status"] for f in manifest["forms"]},
        "returnables": sorted(r["key"] for r in manifest["returnables"]),
        "roles": sorted(r["role_code"] for r in manifest["roles"]),
        "questions": [q["key"] for q in manifest["questions"]],
        "buyer_forms": sorted(b["key"] for b in manifest["buyer_forms"]),
    }
    if pack:
        prov = pack["provenance"]
        sig["provenance"] = {s: sorted({e["field_key"] for e in prov if e["status"] == s})
                             for s in ("confirmed", "assumed_default", "missing")}
        sig["sections"] = [(s["envelope"], s["title"]) for s in pack["manifest"]["sections"]]
        sig["omitted"] = sorted(o["title"] for o in pack["manifest"]["omitted"])
    return sig


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default=DEFAULT_STORE)
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--no-pack", action="store_true", help="manifest checks only (fast)")
    ap.add_argument("--only", action="append", help="sample dir name; repeatable")
    args = ap.parse_args(argv)
    if args.reset and os.path.exists(args.store):
        shutil.rmtree(args.store)
    os.makedirs(args.store, exist_ok=True)

    samples = sorted(d for d in os.listdir(SAMPLES) if os.path.isdir(os.path.join(SAMPLES, d)))
    if args.only:
        samples = [s for s in samples if s in args.only]
    profiles = sorted(glob.glob(os.path.join(TEST_COMPANIES, "*.json")))
    work_root = tempfile.mkdtemp(prefix="tt_general_harness_")
    failed, flagged, clean = [], [], []

    for sample in samples:
        sdir = os.path.join(SAMPLES, sample)
        m = req.extract_requirements([sdir], work_dir=os.path.join(work_root, sample, "src"))
        problems = check_expected(sample, m)
        print(f"{sample}: suite={m['form_suite']} forms={[(f['code'], f['status']) for f in m['forms']]} "
              f"returnables={len(m['returnables'])} questions={len(m['questions'])}")
        if problems:
            failed.append(f"{sample}: " + "; ".join(problems))
            print("   EXPECTATION FAILED: " + "; ".join(problems))
        local = bgp.local_docs_for(m, [sdir], os.path.join(work_root, sample, "src2")) if not args.no_pack else {}
        for prof_path in profiles:
            company_name = os.path.basename(prof_path)[:-5]
            run_key = f"{company_name}__{sample}"
            pack = None
            if not args.no_pack:
                profile = json.load(open(prof_path))
                company, signatory = company_from_profile(profile)
                work = os.path.join(work_root, run_key)
                try:
                    pack = bgp.build_general_pack(
                        manifest=m, local_docs=local, company=company, signatory=signatory, answers=dict(ANSWERS),
                        tender={"contract_no": sample, "buyer": "harness", "description": sample, "closing_date": "2026-11-06"},
                        files={}, work_dir=work, out_pdf=os.path.join(work, "pack.pdf"))
                except Exception as e:
                    failed.append(f"{run_key}: pack build crashed: {type(e).__name__}: {e}")
                    print(f"   {company_name}: CRASH {e}")
                    continue
                if pack["manifest"]["verify_problems"]:
                    failed.append(f"{run_key}: read-back: {pack['manifest']['verify_problems']}")
                # every typed field was already read back from its own spot on
                # the PDF by fill_flat_pdf.verify_placements before it counted
                confirmed = {e["field_key"] for e in pack["provenance"] if e["status"] in ("confirmed", "assumed_default")}
                lost = [k for k in EXPECTED.get(sample, {}).get("typed_keys", []) if k not in confirmed]
                if lost:
                    failed.append(f"{run_key}: not typed onto the PDF: {lost}")
            sig = signature(m, pack)
            base_path = os.path.join(args.store, run_key + (".manifest" if args.no_pack else "") + ".json")
            if not os.path.exists(base_path):
                json.dump(sig, open(base_path, "w"), indent=1)
                status = "baseline stored"
                clean.append(run_key)
            else:
                old = json.load(open(base_path))
                diffs = [k for k in sig if json.loads(json.dumps(sig[k])) != old.get(k)]
                if diffs:
                    flagged.append(f"{run_key}: changed {diffs}")
                    status = f"FLAGGED - changed: {diffs}"
                else:
                    clean.append(run_key)
                    status = "matches baseline"
            extra = ""
            if pack:
                pm = pack["manifest"]
                extra = f" {pm['page_count']}p, prov {pm['provenance_summary']}, omitted {len(pm['omitted'])}"
            print(f"   {company_name}: {status}{extra}")

    shutil.rmtree(work_root, ignore_errors=True)
    print(f"\n{len(clean)} clean, {len(flagged)} flagged, {len(failed)} failed")
    for x in flagged + failed:
        print("  - " + x)
    return 1 if (flagged or failed) else 0


if __name__ == "__main__":
    sys.exit(main())
