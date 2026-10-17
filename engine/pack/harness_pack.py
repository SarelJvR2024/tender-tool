"""
Submission-pack regression check for engine/admin_harness.py --pack.

Runs every test company (config/test_companies/*.json) through the WHOLE
SANRAL chain a real pack-generation job runs - suggest_pack.py ->
confirm_pack.py -> fill_conventional.py/fill_tender.py -> print_reports.py ->
fill_financial.py -> run_forms_pipeline.py -> authority letter + covers ->
generate_cv.py (tender-customised CV per position) -> pdf_merge.py - against
the committed real SANRAL templates (templates/samples/, templates/forms/),
then reads the merged PDF back (pdf_merge.verify_pack) and compares the
pack's shape with a stored baseline, the same first-seen/flag-on-change rule
admin_harness.py uses for the form-fill check.

Harness-only shortcut, stated plainly: a test company's positions are
auto-confirmed to suggest_pack.py's top candidate, with confirmed_by naming
this harness. Real packs never do this - confirm_pack.py's human gate is
fed from tender_pack_assignments.confirmed_person_id (process_pack_jobs.py).

Vault documents for the test companies are synthetic one-page files made
here at run time (one PNG, to exercise the image path, the rest PDF), so the
vault-inclusion and expiry-warning paths are covered too. new_co gets none,
which exercises the "Not included" path.
"""
import os
import re
import sys
import json
import shutil
import datetime

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(ENGINE_DIR, ".."))
for p in (ENGINE_DIR, os.path.join(ENGINE_DIR, "pack_generator"), os.path.join(ENGINE_DIR, "cv"), HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import suggest_pack  # noqa: E402
import confirm_pack  # noqa: E402
import generate_cv  # noqa: E402
from assemble_pack import build_submission_pack, VAULT_ORDER, ISO_KEY  # noqa: E402
from pdf_merge import verify_pack  # noqa: E402

SAMPLES = os.path.join(ROOT, "templates", "samples")
FORMS = os.path.join(ROOT, "templates", "forms")
SEED_TENDERS = os.path.join(ROOT, "app", "supabase", "seed_tenders.sql")

# Which vault document each test company "has uploaded", and the expiry the
# company record would carry. expired_certs_co mirrors its own profile's story.
SYNTHETIC_VAULT = {
    "complete_co": {k: "2027-12-31" for k, _, _ in VAULT_ORDER + [ISO_KEY]},
    "expired_certs_co": {"sars_tcs_pin": "2026-01-31", "bee_proof": "2026-03-31",
                         "coid_letter": "2025-04-30", "bank_letter": "2026-02-01"},
    "new_co": {},
}


def tender_facts(slug):
    """The same public facts a real `tenders` row carries, read from the
    committed seed (app/supabase/seed_tenders.sql) - never typed in here."""
    sql = open(SEED_TENDERS).read()
    contract = slug.replace(".1F", "/1F")
    m = re.search(r"\('[^']+', '" + re.escape(contract) + r"', '([^']+)',\s*'[^']*',\s*'([^']+)',\s*'[^']*', "
                  r"'(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})", sql)
    if not m:
        return {"contract_no": contract}
    return {"contract_no": contract, "nra_reference": m.group(1), "description": m.group(2),
            "closing_date": m.group(3), "closing_time": m.group(4)}


def auto_confirm(template, profile_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    suggest_pack.suggest(template, profile_path, out_dir)
    suggestions = json.load(open(f"{out_dir}/pack_suggestions.json"))
    selections = {
        "contract_no": suggestions["contract_no"],
        "confirmed_by": "engine/admin_harness.py --pack (synthetic test company, auto-confirmed)",
        "confirmed_date": datetime.date.today().isoformat(),
        "selections": {code: {"suggested_person": d["candidates"][0]["person_id"] if d["candidates"] else None,
                              "confirmed_person": d["candidates"][0]["person_id"] if d["candidates"] else None}
                       for code, d in suggestions["positions"].items()},
    }
    sel_path = f"{out_dir}/pack_selections.yaml"
    yaml.safe_dump(selections, open(sel_path, "w"), sort_keys=False)
    pack_path = f"{out_dir}/pack.yaml"
    confirm_pack.confirm(f"{out_dir}/pack_suggestions.json", sel_path, profile_path, pack_path)
    return pack_path, suggestions


def _synthetic_doc(path, text):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (1240, 1754), "white")  # A4 at 150 dpi
    draw = ImageDraw.Draw(img)
    for i, line in enumerate(["SYNTHETIC TEST DOCUMENT - NOT A REAL CERTIFICATE", text]):
        draw.text((120, 200 + 60 * i), line, fill="black")
    if path.endswith(".png"):
        img.save(path)
    else:
        img.save(path, "PDF", resolution=150)
    return path


def run_pack_one(profile_path, slug, out_dir):
    """Returns {"outcome": "built"|"refused", ...}. A ValueError from the real
    gates (confirm_pack.py, fingerprint, fillers) is a recorded *refusal* - a
    stable expected outcome for e.g. a company with no qualifying data - and
    becomes part of the baseline; anything else propagates as a run failure."""
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir)
    name = os.path.basename(profile_path).replace(".json", "")
    template = os.path.join(SAMPLES, f"{slug}_ran.xlsm")
    financial = os.path.join(SAMPLES, "financial", f"{slug}_Financial_Submission_ran.xlsm")
    profile = json.load(open(profile_path))
    try:
        pack_path, suggestions = auto_confirm(template, profile_path, os.path.join(out_dir, "data_pack"))
    except ValueError as e:
        return {"outcome": "refused", "stage": "confirm_pack", "reason": str(e)}

    vault_dir = os.path.join(out_dir, "vault")
    os.makedirs(vault_dir)
    vault = {}
    for i, (key, expiry) in enumerate(sorted(SYNTHETIC_VAULT.get(name, {}).items())):
        ext = ".png" if i == 0 else ".pdf"
        vault[key] = {"path": _synthetic_doc(os.path.join(vault_dir, key + ext), f"{name}: {key}"),
                      "expiry": expiry}

    # One tender-customised CV per confirmed position, through generate_cv.py's
    # own CLI entry point (same function `python3 generate_cv.py ... --tender` runs).
    pack = yaml.safe_load(open(pack_path))
    cvs = {}
    for kp in pack["key_persons"]:
        idx = int(kp["person"].split("_")[1])
        try:
            _, pdf, _ = generate_cv.generate(profile_path, idx, os.path.join(out_dir, "cvs", kp["position"]),
                                             "sanral_keyperson", "summary",
                                             os.path.join(out_dir, "data_pack", "pack_suggestions.json"),
                                             kp["position"])
            cvs[kp["position"]] = {"path": pdf, "person": pack["people"][kp["person"]]["name"],
                                   "source": "generated, tender-specific"} if pdf else \
                {"reason": "generate_cv.py produced no PDF"}
        except ValueError as e:
            cvs[kp["position"]] = {"reason": f"generate_cv.py refused: {e}"}

    try:
        pdf, manifest = build_submission_pack(
            profile=profile, pack_yaml=pack_path, technical_tpl=template,
            forms_dir=os.path.join(FORMS, slug), tender=tender_facts(slug),
            work_dir=os.path.join(out_dir, "pack"),
            financial_tpl=financial if os.path.exists(financial) else None,
            vault_docs=vault, cv_docs=cvs)
    except ValueError as e:
        return {"outcome": "refused", "stage": "build_submission_pack", "reason": str(e)}

    problems = verify_pack(pdf, manifest)
    problems += [f"Envelope 2 PDF: {p}" for p in verify_pack(manifest["outputs"]["financial_pdf"],
                                                              manifest["financial"])]
    return {"outcome": "built", "pdf": pdf, "manifest": manifest, "problems": problems}


def signature(result):
    """What the baseline compares: the ordered section list with page counts,
    what was omitted, total pages. Not dates, not paths."""
    if result["outcome"] != "built":
        return {"outcome": result["outcome"], "stage": result["stage"], "reason": result["reason"]}
    m = result["manifest"]
    f = m["financial"]
    return {
        "outcome": "built",
        "family": m["family"],
        "page_count": m["page_count"],
        "sections": [f"{s['envelope']} | {s['title']} | {s['end_page'] - s['start_page'] + 1}p"
                     for s in m["sections"]],
        "omitted": sorted(f"{o['envelope']} | {o['title']}" for o in m["omitted"]),
        # Expired vault copies moved from m["warnings"] to their checklist
        # row (2026-10-17) - counted together so the stored baselines hold.
        "warning_count": len(m["warnings"]) + sum(1 for c in m.get("checklist", [])
                                                  if c["status"] == "included_warning"),
        "financial": {
            "page_count": f["page_count"],
            "sections": [f"{s['envelope']} | {s['title']} | {s['end_page'] - s['start_page'] + 1}p"
                         for s in f["sections"]],
            "omitted": sorted(f"{o['envelope']} | {o['title']}" for o in f["omitted"]),
        },
    }
