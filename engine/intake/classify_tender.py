"""
Intake: the first thing that happens to a tender's own documents, however the
tender entered the system (a Discovery "Prepare this tender", or a manual load
from /tenders/new - migration 0024). Run by the extract_requirements job in
engine/general/process_general_jobs.py, after engine/general/requirements.py
has read the documents.

It answers three questions, each with an existing engine - nothing here is a
new detection or scoring method:

1. Route: SANRAL pack flow or general (non-SANRAL) flow?
   The signal is the one the SANRAL engines already trust:
   engine/fingerprint.py detect_family() on a workbook's sheet set ("FORM C2.4
   TECH" + "B6 - Scoring - Past Performance" = Conventional, "FORM C2.4 TECH
   -TENDER n" = RRM). The SANRAL fillers can only run on that workbook, so a
   tender is routed to the SANRAL flow if and only if a Technical Submission
   workbook of a known family is among its documents. A SANRAL tender
   uploaded WITHOUT its workbook (only Book 1, or only the eTenders notice)
   is routed general, and the intake says why and what to upload - it is
   never silently filled as a non-SANRAL tender without saying so.
   SBD/MBD form detection (requirements.py) is NOT the routing signal: SANRAL
   documents name SBD forms too (C1.1.1 is "Form of Offer (Incorporating
   SBD7)"), so their presence proves nothing about which engine applies.

2. For the SANRAL route: which uploaded files are the blank templates
   process_pack_jobs.py needs (tender_documents.doc_type: technical_xlsm,
   financial_xlsm, c111_form_of_offer, c123_contract_data, a_forms), the
   template's own SETUP facts (contract number C2, closing date C3, required
   positions rows 5-8 via suggest_pack.read_required_positions), and the
   fingerprint check against the stored baseline - reported, never stored
   (a user upload must not become the baseline).

3. Fit for THIS company: assess_tender.py's categorize/document_depth/
   extract_signals/assess_fit and score_outlook.estimate_score_outlook, run on
   the documents' own text - the same functions assess_release() calls on a
   discovered tender's downloaded PDF.

Usage (local check, no Supabase):
    python3 engine/intake/classify_tender.py <file-or-dir>... [--title T] [--buyer B] [--profile config/x.json]
"""
import argparse
import datetime
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
for p in (ENGINE_DIR, os.path.join(ENGINE_DIR, "general"), os.path.join(ENGINE_DIR, "discovery"),
          os.path.join(ENGINE_DIR, "pack_generator")):
    if p not in sys.path:
        sys.path.insert(0, p)

import fingerprint  # noqa: E402
from sanral_fill import Workbook  # noqa: E402
from suggest_pack import read_required_positions, _excel_date  # noqa: E402
import assess_tender  # noqa: E402
from score_outlook import estimate_score_outlook  # noqa: E402

GENERAL_FAMILY = "General (non-SANRAL)"  # app/lib/generalTender.ts GENERAL_FAMILY
SANRAL_FAMILIES = ("Conventional Consultant Tender", "RRM Consultant Tender")

# SANRAL's own name, as printed on its Book 1 / notices. Only a HINT (it makes
# the intake say "upload the workbook"), never the routing signal.
SANRAL_HINT_RE = re.compile(r"south\s+african\s+national\s+roads\s+agency|\bSANRAL\b", re.IGNORECASE)

# Returnable .docx forms in a SANRAL set, by the headings they really carry
# (R.396-010-2025/1F, read 2026-10-17): C.1.1.1 "C1.1.1 FORM OF OFFER
# (Incorporating SBD7)", C.1.2.3 "C1.2.3 CONTRACT DATA: INFORMATION PROVIDED BY
# THE TENDERER", A-Forms "Part T2: Returnable Schedules" + "FORM A2: CERTIFICATE
# OF AUTHORITY FOR SIGNATORY".
SANRAL_DOCX = [
    ("c111_form_of_offer", re.compile(r"C\s*1\.1\.1\s+FORM\s+OF\s+OFFER", re.IGNORECASE)),
    ("c123_contract_data", re.compile(r"C\s*1\.2\.3\s+CONTRACT\s+DATA", re.IGNORECASE)),
    ("a_forms", re.compile(r"Part\s+T2\s*:\s*Returnable\s+Schedules|FORM\s+A2\s*:\s*CERTIFICATE\s+OF\s+AUTHORITY", re.IGNORECASE)),
]
SANRAL_DOC_LABEL = {
    "technical_xlsm": "Technical Submission workbook (.xlsm)",
    "financial_xlsm": "Financial Submission workbook (.xlsm)",
    "c111_form_of_offer": "C.1.1.1 Form of Offer (.docx)",
    "c123_contract_data": "C.1.2.3 Contract Data (.docx)",
    "a_forms": "A-Forms / returnable schedules (.docx)",
}


def _docx_head(path, paragraphs=60):
    import docx
    d = docx.Document(path)
    return "\n".join(p.text for p in d.paragraphs[:paragraphs])


def classify_workbook(path):
    """{'kind': 'technical'|'financial'|'other'|'unreadable', 'family', 'sheets', 'error'}"""
    try:
        wb = Workbook(path)
        sheets = fingerprint.sheet_order(wb)
    except Exception as e:  # not a zip / not a workbook / damaged
        return {"kind": "unreadable", "family": None, "sheets": [], "error": f"could not open as a workbook: {e}"[:200]}
    family = fingerprint.detect_family(sheets)
    if family != "UNKNOWN":
        return {"kind": "technical", "family": family, "sheets": sheets, "error": None}
    if "FORM C2.4 FIN" in sheets:
        return {"kind": "financial", "family": None, "sheets": sheets, "error": None}
    return {"kind": "other", "family": None, "sheets": sheets, "error": None}


def read_setup(technical_path):
    """The template's own SETUP sheet: contract number, closing date, positions."""
    wb = Workbook(technical_path)
    contract_no = wb.cached("SETUP", "C2")
    raw_closing = wb.cached("SETUP", "C3")
    closing = None
    try:
        closing = _excel_date(raw_closing).isoformat() if raw_closing not in (None, "") else None
    except (TypeError, ValueError):
        closing = None
    primary, alternates = read_required_positions(wb)
    positions = [{"code": p["code"], "description": p["description"],
                  "managerial": str(p.get("managerial") or "").strip().lower() == "man",
                  "managerial_raw": p.get("managerial"),
                  "has_alternate": p["code"] in alternates} for p in primary]
    return {"contract_no": str(contract_no).strip() if contract_no else None, "closing_date": closing, "positions": positions}


NRA_RE = re.compile(r"\bNRA\s*:?\s*(?:No\.?\s*)?(\d{4}\s*/\s*\d{3,5})\b")


def find_nra_reference(all_text):
    """SANRAL's NRA number, as printed on Book 1's cover ("NRA: 2026/0071",
    R.396-010-2025/1F). Returned in the seed's own format ("NRA 2026/0071")
    - the envelope covers and authority letter refuse to invent it."""
    counts = {}
    for m in NRA_RE.finditer(all_text or ""):
        v = re.sub(r"\s+", "", m.group(1))
        counts[v] = counts.get(v, 0) + 1
    if not counts:
        return None
    return "NRA " + max(counts, key=counts.get)


def check_fingerprint(technical_path, family, store=None):
    """Compare against the stored baseline WITHOUT storing anything."""
    store = store or fingerprint.DEFAULT_STORE
    path = os.path.join(store, family.replace(" ", "_") + ".json")
    try:
        current = fingerprint.build_fingerprint(technical_path)
    except Exception as e:
        return {"status": "error", "detail": f"could not fingerprint the workbook: {e}"[:300], "changes": []}
    if not os.path.exists(path):
        return {"status": "no_baseline",
                "detail": f"No stored '{family}' baseline to compare against yet - the pack run will record this "
                          "template as the first one seen; have a person check the filled workbook carefully.",
                "changes": []}
    stored = json.load(open(path))
    changes, warnings = fingerprint.diff(stored, current)
    if changes:
        return {"status": "mismatch",
                "detail": f"This workbook differs from the stored '{family}' template (baseline {stored.get('_source_file')}) - "
                          "the SANRAL pack run will STOP rather than fill a changed template. Someone must check what changed "
                          "and update the baseline (engine/fingerprint.py) before a pack can be generated.",
                "changes": [k for k, _, _ in changes][:12]}
    return {"status": "ok",
            "detail": f"Matches the stored '{family}' template (baseline {stored.get('_source_file')})"
                      + (" - macro-only difference, known to be benign." if warnings else "."),
            "changes": []}


def classify_documents(doc_entries, buyer=None, all_text=""):
    """doc_entries: requirements.py manifest['documents'] (with '_local').
    Returns the intake decision (JSON-safe) plus 'sanral_files' {doc_type: local path}."""
    notes, candidates = [], {}
    workbooks = []
    for d in doc_entries:
        local, fmt = d.get("_local"), (d.get("format") or "").lower()
        if not local or not os.path.exists(local):
            continue
        if fmt in ("xlsm", "xlsx"):
            info = classify_workbook(local)
            workbooks.append({"document": d["name"], **{k: info[k] for k in ("kind", "family", "error")}})
            if info["kind"] == "technical":
                candidates.setdefault("technical_xlsm", []).append((d["name"], local, info["family"]))
            elif info["kind"] == "financial":
                candidates.setdefault("financial_xlsm", []).append((d["name"], local, None))
            elif info["kind"] == "unreadable":
                notes.append(f"{d['name']}: {info['error']}")
        elif fmt == "docx" and not d.get("unreadable"):
            try:
                head = _docx_head(local)
            except Exception:
                continue
            for doc_type, pat in SANRAL_DOCX:
                if pat.search(head):
                    candidates.setdefault(doc_type, []).append((d["name"], local, None))
                    break

    sanral_hint = bool(SANRAL_HINT_RE.search(buyer or "")) or bool(SANRAL_HINT_RE.search(all_text[:200000] or ""))
    tech = candidates.get("technical_xlsm") or []
    families = sorted({c[2] for c in tech})
    files, registered = {}, []
    for doc_type, cands in candidates.items():
        files[doc_type] = cands[0][1]
        registered.append({"doc_type": doc_type, "label": SANRAL_DOC_LABEL[doc_type], "document": cands[0][0]})
        if len(cands) > 1:
            notes.append(f"More than one {SANRAL_DOC_LABEL[doc_type]} was uploaded ({', '.join(c[0] for c in cands)}) - "
                         f"used {cands[0][0]}. Remove the others if that's the wrong one.")

    if tech:
        family = tech[0][2]
        if len(families) > 1:
            notes.append(f"Workbooks of two SANRAL families were uploaded ({', '.join(families)}) - used {family} from {tech[0][0]}.")
        route = "sanral"
        signal = (f"{tech[0][0]} is a SANRAL '{family}' Technical Submission workbook (engine/fingerprint.py "
                  "detect_family on its sheet set) - routed to the SANRAL submission-pack flow.")
        missing = [SANRAL_DOC_LABEL[t] for t in ("c111_form_of_offer", "c123_contract_data", "a_forms") if t not in files]
        if missing:
            notes.append("Not found among the uploaded documents (the SANRAL pack needs them): " + "; ".join(missing)
                         + ". Add them with 'Add documents'.")
        if "financial_xlsm" not in files:
            notes.append("No Financial Submission workbook was uploaded - the pack will be built without the Financial envelope's workbook.")
    else:
        family, route = GENERAL_FAMILY, "general"
        broken = [w for w in workbooks if w["kind"] == "unreadable"]
        if broken:
            signal = (f"{'; '.join(w['document'] for w in broken)} couldn't be opened as a workbook (corrupt, truncated or "
                      "not really an Excel file), so it can't be checked for a SANRAL Technical Submission template - "
                      "re-download it and add it again. Until then this tender is on the general (non-SANRAL) flow.")
        elif sanral_hint:
            signal = ("These look like SANRAL tender documents (SANRAL is named), but no SANRAL Technical Submission "
                      "workbook (.xlsm) was among them - the SANRAL pack can only fill that workbook, so this tender is "
                      "on the general flow for now. Upload the Technical Submission .xlsm (and the C.1.1.1, C.1.2.3 and "
                      "A-Forms .docx) from SANRAL's tender portal to switch it to the SANRAL pack.")
        elif workbooks:
            signal = ("Workbook(s) were uploaded but none is a SANRAL Technical Submission template "
                      f"({'; '.join(w['document'] for w in workbooks)}) - general (non-SANRAL) flow.")
        else:
            signal = "No SANRAL Technical Submission workbook among the documents - general (non-SANRAL) flow."
    return {
        "route": route,
        "family": family,
        "signal": signal,
        "sanral_hint": sanral_hint,
        "workbooks": workbooks,
        "sanral_documents": registered if route == "sanral" else [],
        "notes": notes,
        "sanral_files": files if route == "sanral" else {},
    }


def assess_fit_from_text(title, description, all_text, profile):
    """assess_release()'s own steps, on text already read from the documents."""
    categories = assess_tender.categorize(title, description)
    if all(c.startswith("uncategorized") for c in categories) and all_text:
        # Discovery only has the OCDS title/description; here the tender's own
        # opening pages are available too (real R.396: the typed title
        # "Routine ad-hoc maintenance of R396 Section 1" matched no keyword,
        # its Book 1 cover says "consulting engineering services").
        from_text = assess_tender.categorize(title, f"{description or ''} {all_text[:6000]}")
        if not all(c.startswith("uncategorized") for c in from_text):
            categories = from_text
    depth = assess_tender.document_depth(all_text or "")
    signals, confidence = assess_tender.extract_signals(all_text or "", depth)
    verdict, reasons = assess_tender.assess_fit(categories, signals, depth, profile)
    if categories != assess_tender.categorize(title, description):
        reasons.append("Discipline read from the opening pages of the tender documents (the title alone didn't say).")
    if not profile.get("disciplines"):
        reasons = [r for r in reasons if "doesn't match the company's known disciplines" not in r]
        reasons.append("Your company has no disciplines on file yet (they come from your Experience Library tags), so "
                       "fit can't be judged - needs a human look.")
        if verdict in ("not_a_fit", "strong_fit", "possible"):
            verdict = "needs_review"
    outlook = estimate_score_outlook(all_text or "", depth, profile, signals.get("cidb_grading"))
    return {"categories": categories, "document_depth": depth, "signals": signals, "confidence_note": confidence,
            "verdict": verdict, "reasons": reasons, "score_outlook": outlook}


def discrepancies(user, setup):
    """What the person typed vs. what the template's own SETUP says."""
    out = []
    if setup.get("contract_no") and user.get("contract_no") and \
            re.sub(r"[^A-Z0-9]", "", setup["contract_no"].upper()) != re.sub(r"[^A-Z0-9]", "", user["contract_no"].upper()):
        out.append(f"You entered reference '{user['contract_no']}', but the workbook's SETUP sheet says '{setup['contract_no']}'.")
    if setup.get("closing_date") and user.get("closing_date") and setup["closing_date"] != str(user["closing_date"])[:10]:
        out.append(f"You entered closing date {str(user['closing_date'])[:10]}, but the workbook's SETUP sheet says {setup['closing_date']} "
                   "- check the tender notice and any addenda.")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--title", default="")
    ap.add_argument("--buyer", default="")
    ap.add_argument("--profile", default=None)
    args = ap.parse_args()
    import requirements as req
    import shutil
    m = req.extract_requirements(args.paths, keep_text=True)
    decision = classify_documents(m["documents"], args.buyer, m.get("_all_text") or "")
    out = {k: v for k, v in decision.items() if k != "sanral_files"}
    if decision["route"] == "sanral":
        tech = decision["sanral_files"]["technical_xlsm"]
        out["setup"] = read_setup(tech)
        out["fingerprint"] = check_fingerprint(tech, decision["family"])
    profile = assess_tender.load_company_profile(args.profile)
    out["fit"] = assess_fit_from_text(args.title, args.title, m.get("_all_text") or "", profile)
    out["readable_documents"] = sum(1 for d in m["documents"] if d["chars"] > 0 and not d["unreadable"])
    out["gaps"] = m["gaps"]
    print(json.dumps(out, indent=2, default=str))
    if m.get("_work_dir"):
        shutil.rmtree(m["_work_dir"], ignore_errors=True)


if __name__ == "__main__":
    main()
