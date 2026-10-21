"""
Compiles a SUBMISSION PLAN for one tender: an ordered, human-readable list of
concrete action items - what's already ready, what needs a document, what
needs a person's input, what has to be done by hand - built from
requirements.extract_requirements()'s manifest plus what's already on the
company's own record.

Sarel's own framing (2026-10-21): "an assessment engine which assesses each
tender, each page, each field and compiles a plan of how to prepare a
submission." This module is that compiler's first version - it does NOT
build the final pack (build_general_pack.py already does that); it answers
the question that comes BEFORE that: "if we pursued this tender today, what
would we actually have to go and do?"

Deliberately reuses, not re-derives:
  - requirements.py's manifest (forms, buyer_forms, returnables, roles,
    questions, cidb, briefing, gaps) - the one source of truth for WHAT a
    tender asks for.
  - build_general_pack.py's own VAULT_FILE_FOR mapping (which company column
    holds which returnable's document) - so "is this already on file" never
    drifts from what the real pack build checks when it actually runs.

What this deliberately does NOT do (yet - see docs/specs/System-Status.md for
the open questions this raises for Sarel):
  - Write anything to Supabase, or know about tender_tasks / tender_answers -
    it is a pure function of (manifest, company dict, tender dict), the same
    "no database access here" discipline requirements.py itself follows.
  - Know whether a role has already been assigned to a real person, or
    whether a past answer already exists for a question - those live in
    tender_answers / tender_roles and this module has no access to them; a
    role/question is always "needs your input" here, never "ready".
  - Know a document's actual expiry status beyond what's already on the
    company dict (pdf_merge.expiry_warning handles that once a real pack is
    being built, against a real stored document).

Usage (dry run, prints the plan):
    python3 engine/general/submission_plan.py <file-or-dir> [<file-or-dir> ...]
        [--company company.json] [--tender tender.json] [--json out.json]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import requirements as req  # noqa: E402
from build_general_pack import VAULT_FILE_FOR  # noqa: E402

PLAN_VERSION = 1

# Status a step can carry. Ordered worst-to-best for sorting the plan (a
# blocked/by-hand item needs attention before a ready one is worth looking at).
STATUS_ORDER = ["blocked", "needs_document", "needs_input", "by_hand", "review", "ready"]
STATUS_LABEL = {
    "blocked": "Blocked - the engine couldn't determine this",
    "needs_document": "Needs a document",
    "needs_input": "Needs your input",
    "by_hand": "Complete by hand",
    "review": "Typed for you - check before signing",
    "ready": "Ready",
}


def _returnable_step(r, company):
    key = r["key"]
    if key == "cidb":
        grading = (company or {}).get("cidb_grading")
        have = bool(grading)
        detail = (f"Company CIDB grading on file: {grading}." if have else
                   "No CIDB grading recorded on the company profile - confirm the company actually holds "
                   "whatever grading this tender names, and record it.")
        return {"status": "ready" if have else "needs_document", "detail": detail}
    vault_col = VAULT_FILE_FOR.get(key)
    have = bool(vault_col and (company or {}).get(vault_col))
    if have:
        detail = f"Already on file ({vault_col})."
        return {"status": "ready", "detail": detail}
    if vault_col:
        detail = f"Not on file ({vault_col} is empty on the company profile) - upload a current copy."
    else:
        detail = "Tender Tool doesn't keep a standing copy of this - it has to be supplied for this tender specifically."
    return {"status": "needs_document", "detail": detail}


def _form_step(f):
    if f["status"] == "auto":
        return {"status": "ready", "detail": f["reason"]}
    if f["status"] == "overlay":
        return {"status": "review", "detail": f["reason"]}
    return {"status": "by_hand", "detail": f["reason"]}


def compile_plan(manifest, company=None, tender=None):
    """manifest: requirements.extract_requirements() output (stripped or not).
    company: a companies-row-shaped dict (0001 + 0014 + 0018 columns), or None
    if nothing is known about the company yet - every document-backed step
    then reads as "needs_document", which is the honest answer in that case.
    tender: {contract_no, buyer, description, closing_date} or None.
    Returns a JSON-safe dict: {plan_version, tender, summary, steps, gaps}."""
    company = company or {}
    steps = []

    prefix = (manifest.get("form_suite") or "SBD")
    for f in manifest["forms"]:
        out = _form_step(f)
        steps.append({
            "category": "form", "id": f"form:{f['code']}", "title": f"{prefix} {f['code']} - {f['label']}",
            "status": out["status"], "detail": out["detail"], "document": f.get("document"),
        })

    for b in manifest.get("buyer_forms", []):
        out = ({"status": "review", "detail": b["reason"]} if b.get("overlay") else
               {"status": "by_hand", "detail": b["reason"]})
        steps.append({
            "category": "buyer_form", "id": "buyer_form:" + b["key"], "title": b["label"],
            "status": out["status"], "detail": out["detail"], "document": b.get("document"),
            "quote": b.get("quote"),
        })

    for r in manifest["returnables"]:
        out = _returnable_step(r, company)
        title = r["label"] + (" (only if bidding as a JV/consortium)" if r.get("conditional") == "jv" else "")
        steps.append({
            "category": "returnable", "id": "returnable:" + r["key"], "title": title,
            "status": out["status"], "detail": out["detail"], "document": r.get("document"),
            "quote": r.get("quote"), "strength": r.get("strength"),
        })

    for role in manifest["roles"]:
        steps.append({
            "category": "role", "id": "role:" + role["role_code"], "title": f"Key personnel: {role['role_code']}",
            "status": "needs_input",
            "detail": "No person is tagged for this role yet on this tender - assign someone and attach their CV.",
            "document": role.get("document"), "quote": role.get("quote"),
        })

    for q in manifest["questions"]:
        steps.append({
            "category": "question", "id": "question:" + q["key"], "title": q.get("label") or q["key"],
            "status": "needs_input", "detail": "Only a person can answer this for this specific tender.",
        })

    if manifest.get("cidb"):
        grading = manifest["cidb"]["grading"]
        have = (company or {}).get("cidb_grading")
        ok = bool(have) and have.upper().replace(" ", "") >= grading.upper().replace(" ", "")
        # "Confirm" rather than a hard pass/fail: CIDB grading comparison
        # (numeral + class letter, e.g. "6CE" vs "4CE") isn't a simple string
        # compare and this module doesn't own that logic - requirements.py's
        # own CIDB_RE just reads the number named in the text, nothing more.
        steps.append({
            "category": "cidb_grading", "id": "cidb_grading", "title": f"CIDB grading {grading} required",
            "status": "needs_input" if not have else "review",
            "detail": (f"Company has no CIDB grading on file - confirm it meets {grading} before bidding."
                       if not have else
                       f"Company's own grading on file is {have} - confirm this actually meets or exceeds {grading} "
                       "(Tender Tool doesn't compare grading levels for you)."),
            "quote": manifest["cidb"].get("quote"),
        })

    if (manifest.get("briefing") or {}).get("compulsory"):
        steps.append({
            "category": "briefing", "id": "briefing", "title": "Attend the compulsory briefing session",
            "status": "needs_input",
            "detail": "A compulsory briefing is required - find its actual date in the tender documents "
                      "(requirements.py only detects that one is mentioned, not its date) and attend it; "
                      "a bid is normally disqualified without proof of attendance.",
            "quote": manifest["briefing"].get("quote"),
        })

    # requirements.py's own gaps list restates "X must be completed by hand"/
    # "X is a flat PDF" for every by_hand/overlay form - already represented
    # above as that form's own step (same reason text, same source). Only the
    # gaps that AREN'T a per-form restatement carry new information here.
    _form_gap_prefixes = tuple(
        f"{f['label']} must be completed by hand:" if f["status"] == "by_hand" else f"{f['label']} is a flat PDF:"
        for f in manifest["forms"] if f["status"] in ("by_hand", "overlay"))
    for i, gap in enumerate(manifest.get("gaps") or []):
        if gap.startswith(_form_gap_prefixes):
            continue
        steps.append({"category": "gap", "id": f"gap:{i}", "title": "Known limitation", "status": "blocked",
                      "detail": gap})

    steps.sort(key=lambda s: STATUS_ORDER.index(s["status"]))
    summary = {status: sum(1 for s in steps if s["status"] == status) for status in STATUS_ORDER}
    summary["total"] = len(steps)

    return {
        "plan_version": PLAN_VERSION,
        "tender": tender or {},
        "form_suite": manifest.get("form_suite"),
        "summary": summary,
        "steps": steps,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--company", default=None, help="a company.json (companies-row-shaped dict, or {\"company\": {...}})")
    ap.add_argument("--tender", default=None, help="a tender.json ({contract_no, buyer, description, closing_date})")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()
    manifest = req.extract_requirements(args.paths)
    company = None
    if args.company:
        raw = json.load(open(args.company))
        company = raw.get("company", raw)
    tender = json.load(open(args.tender)) if args.tender else None
    plan = compile_plan(manifest, company, tender)
    print(f"{plan['summary']['total']} steps - " +
          ", ".join(f"{STATUS_LABEL[s]}: {plan['summary'][s]}" for s in STATUS_ORDER if plan["summary"][s]))
    for s in plan["steps"]:
        print(f"  [{s['status']:<14}] {s['category']:<12} {s['title'][:80]}")
        print(f"      {s['detail'][:160]}")
    if args.json:
        with open(args.json, "w") as f:
            json.dump(plan, f, indent=2)
        print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
