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
    python3 engine/intake/classify_tender.py <file-or-dir>... [--title T] [--buyer B] --profile config/x.json
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
    # \.? after the leading letter: the real R.396-010-2025/1F heading (cited
    # above) has no period ("C1.1.1"), but "C.1.1.1"/"A.2" is an equally
    # plausible, entirely normal way to write the same form code, and the
    # no-period patterns below silently failed to recognise it at all - QA
    # audit 2026-10-20 ("enterprise readiness" pass), confirmed directly:
    # a real .docx headed "C.1.1.1 FORM OF OFFER" produced zero trace
    # anywhere (no note, not in sanral_files), not even the corrupt-file
    # note this same loop already gives an unreadable document.
    ("c111_form_of_offer", re.compile(r"C\.?\s*1\.1\.1\s+FORM\s+OF\s+OFFER", re.IGNORECASE)),
    ("c123_contract_data", re.compile(r"C\.?\s*1\.2\.3\s+CONTRACT\s+DATA", re.IGNORECASE)),
    ("a_forms", re.compile(r"Part\s+T2\s*:\s*Returnable\s+Schedules|FORM\s+A\.?2\s*:\s*CERTIFICATE\s+OF\s+AUTHORITY", re.IGNORECASE)),
]
SANRAL_DOC_LABEL = {
    "technical_xlsm": "Technical Submission workbook (.xlsm)",
    "financial_xlsm": "Financial Submission workbook (.xlsm)",
    "c111_form_of_offer": "C.1.1.1 Form of Offer (.docx)",
    "c123_contract_data": "C.1.2.3 Contract Data (.docx)",
    "a_forms": "A-Forms / returnable schedules (.docx)",
}


def _docx_head(path, paragraphs=5000):
    # Not really "the head" any more in the small-N sense the old default (60)
    # implied - QA pass, 2026-10-27: a real SANRAL A-Forms.docx
    # (templates/forms/R.352-020-2025.1F/A_Forms.docx) carries a long front
    # section (notes, a returnables table of contents) before its own "Part
    # T2: Returnable Schedules" heading, which didn't appear until paragraph
    # 521 of 2104 - well past the old 60-paragraph cap, so this real,
    # genuinely-uploaded A-Forms document was silently classified as "not
    # found", and the SANRAL pack would have reported it missing even though
    # it was there. Every other real sample form in templates/forms/ matches
    # well inside the first 100 paragraphs, so 5000 is a generous safety
    # margin against this happening again on a differently-paginated form,
    # not a number tuned to one file; it's still a cap (not the whole
    # document unconditionally) so a pathological/corrupted .docx can't make
    # this read unboundedly large.
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
    R.396-010-2025/1F). {"value": "NRA 2026/0071", "ambiguous": bool}, or
    None if none was found. `value` is in the seed's own format
    ("NRA 2026/0071") - the envelope covers and authority letter refuse to
    invent it.

    `ambiguous` is True when more than one DISTINCT NRA number was found
    across the documents read - an addendum correcting a typo'd reference is
    a real, common shape, mentioned once, while the original (wrong) number
    is often repeated many times over on Book 1's own running page
    footer/header. The most-repeated value stays the default (unchanged
    behaviour for the normal single-reference case), but repetition count is
    not a reliability signal - a stale number printed on every page can
    outvote a single correcting mention - so this surfaces the conflict
    instead of silently trusting whichever counted highest, same "silent
    wrong data is the main risk" discipline as find_closing_time()/
    find_delivery_address() above. QA pass, 2026-10-24."""
    counts = {}
    for m in NRA_RE.finditer(all_text or ""):
        v = re.sub(r"\s+", "", m.group(1))
        counts[v] = counts.get(v, 0) + 1
    if not counts:
        return None
    return {"value": "NRA " + max(counts, key=counts.get), "ambiguous": len(counts) > 1}


# The tender's own delivery address and closing time, as its Tender Notice
# prints them (R.396 Book 1 T-6: "The closing time and date for receipt of
# tenders is 12:00 on 22 October 2026 / Tenders must be placed inside the
# tender box at: / The Reception Area / 20 Shoreward Drive / Bay West /
# Gqeberha / 6025"). Form-Field-Audit 2026-10-18: the envelope covers used
# a fixed SANRAL head-office address and the SETUP-sheet closing date was
# given a fixed 12:00.
DELIVERY_RE = re.compile(
    r"(?:tender\s+box\s+(?:at|situated\s+at|located\s+at)|(?:delivered|deposited|submitted)\s+(?:to|at)\s+the\s+following\s+address)\s*:?[ \t]*\n",
    re.IGNORECASE)
CLOSING_TIME_RE = re.compile(
    r"closing\s+(?:time\s+and\s+date|date\s+and\s+time|time)\s+(?:for\s+(?:the\s+)?receipt\s+of\s+tenders\s+)?is\s+"
    r"(?:at\s+)?([01]?\d|2[0-3])[:h.]([0-5]\d)",
    re.IGNORECASE)


def _address_lines_after(all_text, end):
    lines = []
    for raw in all_text[end:].split("\n")[:14]:
        line = re.sub(r"\s+", " ", raw).strip()
        if not line:
            if lines:
                break
            continue
        if (re.fullmatch(r"[A-Z]{1,2}-\d+", line) or line.endswith(".") or len(line) > 70
                or line.startswith(("•", "-", "*")) or re.search(r"\b(?:tender|must|shall)\b", line, re.IGNORECASE)):
            break
        lines.append(line)
        if re.fullmatch(r"\d{4}", line) or len(lines) >= 7:
            break
    return lines


def find_delivery_address(all_text):
    """{"lines": [...], "quote": "...", "ambiguous": bool} - the address
    lines under the Tender Notice's own "tender box at:" heading, or None if
    none was found. Stops at a blank-run end, a page footer (e.g. "T-6") or
    a sentence; never more than 7 lines.

    `ambiguous` is True when more than one DIFFERENT address was found across
    the documents read - a real, common shape: an addendum moving the
    delivery venue, on top of Book 1's own original notice. The value
    returned is still the FIRST address found (unchanged default, same as
    before this fix), because collect_documents() feeds documents in
    alphabetical filename order, not chronological/addendum order - there is
    no reliable "the later one in the text is the correcting one" signal to
    act on here, confirmed directly: swapping which of two conflicting
    addresses appears first in `all_text` changes which one this function
    returns, purely because of where each happened to sort by filename. Since
    guessing isn't safe either way, this surfaces the conflict instead of
    silently trusting an arbitrary pick - the same "silent wrong data is the
    main risk" discipline this module already applies to a duplicate
    workbook candidate (classify_documents()'s own AMBIGUOUS note). QA pass,
    2026-10-23."""
    first = None
    quotes = set()
    for m in DELIVERY_RE.finditer(all_text or ""):
        lines = _address_lines_after(all_text, m.end())
        if not lines:
            continue
        quotes.add(" / ".join(lines))
        if first is None:
            first = lines
    if first is None:
        return None
    return {"lines": first, "quote": " / ".join(first), "ambiguous": len(quotes) > 1}


def find_closing_time(all_text):
    """{"value": "HH:MM", "ambiguous": bool}, or None - from the Tender
    Notice's own "closing time ... is 12:00" sentence.

    `ambiguous` is True when more than one DIFFERENT closing time was found
    across the documents read - an addendum extending the deadline is common
    and real (almost every SANRAL tender gets at least one), and - same
    reasoning as find_delivery_address() above - the order documents appear
    in `all_text` is filename-alphabetical, not chronological, so a plain
    first-match search has no real basis for picking the extended time over
    the original one, or vice versa. `value` stays the FIRST match found
    (unchanged default); the caller is told to check rather than trust it
    silently when there's more than one. QA pass, 2026-10-23."""
    times = [f"{int(h):02d}:{m}" for h, m in CLOSING_TIME_RE.findall(all_text or "")]
    if not times:
        return None
    return {"value": times[0], "ambiguous": len(set(times)) > 1}


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
            except Exception as e:
                notes.append(f"{d['name']}: could not be opened as a Word document ({e}) - "
                              "re-download it and add it again.")
                continue
            for doc_type, pat in SANRAL_DOCX:
                if pat.search(head):
                    candidates.setdefault(doc_type, []).append((d["name"], local, None))
                    break

    sanral_hint = bool(SANRAL_HINT_RE.search(buyer or "")) or bool(SANRAL_HINT_RE.search(all_text[:200000] or ""))
    tech = candidates.get("technical_xlsm") or []
    families = sorted({c[2] for c in tech})
    files, registered, winners = {}, [], {}
    for doc_type, cands in candidates.items():
        # More than one document matched the same doc_type: prefer the most
        # recently modified file as a best-effort signal (a draft kept
        # alongside the final copy is usually the older file on disk), but
        # this is still a guess, not a confirmed choice - QA audit
        # 2026-10-20 found the previous tie-break (first in doc_entries,
        # which collect_documents() feeds in alphabetical filename order)
        # picked "Old_Draft_Form_Offer.docx" over "Zfinal_Form_Offer.docx"
        # purely because "O" < "Z", with no regard for which was actually
        # right. Still only a note, never a block - one ambiguous document
        # must not stop the whole intake - but the wording below says
        # plainly that this was picked arbitrarily and must be checked by a
        # person, not "remove the others if wrong" (easy to skim past).
        if len(cands) > 1:
            try:
                cands = sorted(cands, key=lambda c: os.path.getmtime(c[1]), reverse=True)
            except OSError:
                pass  # mtime unavailable - keep collect_documents()'s own order
        files[doc_type] = cands[0][1]
        winners[doc_type] = cands[0]  # the SAME file files[doc_type]/registered name below - tech[0] (pre-tie-break
                                      # order) must never be used for reporting once there's more than one candidate.
        registered.append({"doc_type": doc_type, "label": SANRAL_DOC_LABEL[doc_type], "document": cands[0][0]})
        if len(cands) > 1:
            notes.append(f"AMBIGUOUS - more than one {SANRAL_DOC_LABEL[doc_type]} was uploaded "
                         f"({', '.join(c[0] for c in cands)}). {cands[0][0]} was picked (most recently modified, "
                         "if that could be determined - otherwise arbitrarily), but this was NOT confirmed as the "
                         "correct one. A person must check which file is right and remove the others before relying "
                         "on this tender's SANRAL pack.")

    if tech:
        # winners["technical_xlsm"] (the SAME tie-broken pick files["technical_xlsm"] and the
        # AMBIGUOUS note above use), never tech[0] - tech is candidates["technical_xlsm"] in its
        # ORIGINAL, pre-tie-break (collect_documents()'s alphabetical) order. Using tech[0] here
        # named the wrong file as "routed to the SANRAL flow" whenever two Technical Submission
        # workbooks were uploaded and the most-recently-modified one didn't also sort first
        # alphabetically - directly contradicting this very function's own AMBIGUOUS note naming
        # the OTHER file as the one actually picked. QA pass, 2026-10-26.
        winner = winners["technical_xlsm"]
        family = winner[2]
        if len(families) > 1:
            notes.append(f"Workbooks of two SANRAL families were uploaded ({', '.join(families)}) - used {family} from {winner[0]}.")
        route = "sanral"
        signal = (f"{winner[0]} is a SANRAL '{family}' Technical Submission workbook (engine/fingerprint.py "
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


def assess_fit_from_text(title, description, all_text, profile, documents=None):
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
    if depth == "no_extractable_text" and documents:
        # extract_signals()'s "likely a scanned image" is a guess made with no
        # visibility into WHY nothing was extracted - requirements.py's own
        # per-document reason is already specific (confirmed: a real .docx
        # tender renamed to .pdf comes back from requirements.py as "not a
        # readable PDF - corrupt, truncated or not really a PDF", but this
        # function used to show "likely a scanned image" anyway, in the same
        # result, right next to the correct reason). Use the real reason(s)
        # when they say something other than "scanned image" themselves.
        specific = sorted({d["unreadable"] for d in documents
                            if d.get("unreadable") and "scanned image" not in d["unreadable"]})
        if specific:
            confidence = ("No text could be extracted from the attached document(s): "
                          + "; ".join(specific) + " - none of these signals could be checked at all.")
    verdict, reasons = assess_tender.assess_fit(categories, signals, depth, profile)
    if categories != assess_tender.categorize(title, description):
        reasons.append("Discipline read from the opening pages of the tender documents (the title alone didn't say).")
    if not profile.get("disciplines") and not any("no disciplines on file yet" in r for r in reasons):
        # assess_fit() itself now carries this same actionable wording at the
        # root (moved there 2026-10-23, Sarel's own live feedback - it used
        # to say only "has no disciplines recorded yet", true everywhere but
        # unhelpful everywhere that wasn't this call site), so the usual case
        # needs nothing here. This still covers the case assess_fit() itself
        # doesn't: a DIFFERENT reason fired first (e.g. "uncategorized"), but
        # the company's own disciplines are also empty - worth telling the
        # user that too, since it's still true and still actionable.
        reasons.append("Your company has no disciplines on file yet (they come from your Experience Library tags), "
                       "so fit can't be judged - needs a human look.")
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
    ap.add_argument("--profile", required=True, help="the company profile JSON to assess fit for (no default company)")
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
    out["fit"] = assess_fit_from_text(args.title, args.title, m.get("_all_text") or "", profile, documents=m["documents"])
    out["readable_documents"] = sum(1 for d in m["documents"] if d["chars"] > 0 and not d["unreadable"])
    out["gaps"] = m["gaps"]
    print(json.dumps(out, indent=2, default=str))
    if m.get("_work_dir"):
        shutil.rmtree(m["_work_dir"], ignore_errors=True)


if __name__ == "__main__":
    main()
