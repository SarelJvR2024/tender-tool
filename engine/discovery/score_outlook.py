"""
Score outlook for a discovered tender: "how would this company SCORE on this
tender's own evaluation", as distinct from assess_tender.assess_fit()'s "is
this tender the kind of work we do" (suitability). See
docs/specs/Tender-Evaluation-Engine-Audit.md for the evidence behind every rule
here - in short, from real tender documents already in this repo:

  - PRICE (80 or 90 of 100 preference points) is scored against the LOWEST
    ACCEPTABLE price among all bidders: Ps = 80(1-(Pt-Pm)/Pm). It cannot be
    estimated before the tender closes, and this module never tries.
  - 80/20 vs 90/10 is decided by the tender's Rand value. The OCDS feed's
    tender.value.amount was 0 on all 100 releases checked (2026-10-16), so it
    only comes from the document text - and the standard SBD 6.1 template
    prints BOTH options for the buyer to strike one out (QCTO's copy left all
    three in), so finding both is reported as ambiguous, not resolved.
  - SPECIFIC GOALS (the 20 or 10 points) are buyer-defined under PPR 2022:
    SANRAL uses a B-BBEE-level table, SALB women-ownership, Dawid Kruiper
    locality, National Treasury HDI equity ownership. Only the B-BBEE-level
    basis can be computed from the company profile; the others are named,
    not guessed.
  - FUNCTIONALITY (a pre-qualifying quality score with a minimum threshold,
    e.g. SANRAL's 70 of 100) is buyer-specific and largely judged by an
    evaluation committee. Its presence and threshold are reported; a generic
    points estimate is not made. SANRAL's consultant methodology is the one
    exception that is published in enough detail to compute key-person points
    from CV data - that estimate lives in the Tender Workspace
    (app/lib/sanralScoring.ts), where the actual assigned people are known.

Everything returned carries a plain-language reason. No number is returned
that the underlying text/profile does not actually support.
"""
import re

PREF_EXPLICIT_RE = re.compile(
    r"applicable\s+preference\s+point\s+system\s+for\s+this\s+(?:tender|bid)\s+is\s+the\s+(80/20|90/10)",
    re.IGNORECASE)
PREF_THEREFORE_RE = re.compile(r"therefore\s+the\s+(80/20|90/10)\s+system\s+shall\s+be\s+applicable",
                               re.IGNORECASE)
PREF_EITHER_RE = re.compile(r"either\s+the\s+(?:90/10\s+or\s+80/20|80/20\s+or\s+90/10)\s+preference\s+point\s+system\s+will",
                            re.IGNORECASE)
PREF_ANY_RE = re.compile(r"\b(80/20|90/10)\b")

# The bare word is not enough: every PPR2022 SBD 6.1 carries a definitions
# clause ("'functionality' means the measurement according to predetermined
# norms...") whether or not the tender scores functionality - Treasury's own
# SBD 6.1 false-positived on exactly that. Require an evaluation word nearby.
FUNCTIONALITY_RE = re.compile(
    r"functionality[^.\n]{0,80}?(?:evaluat|criteri|points|threshold|score)"
    r"|(?:evaluat|criteri|points|threshold|score)[^.\n]{0,80}?functionality",
    re.IGNORECASE)
THRESHOLD_RE = re.compile(
    r"minimum\s+(?:overall\s+)?(?:threshold|score|qualifying\s+score)[^.]{0,80}?\b(\d{2})\s*(?:points|%|out\s+of\s+100)",
    re.IGNORECASE | re.DOTALL)
THRESHOLD_ALT_RE = re.compile(
    r"(?:not\s+less\s+than|at\s+least|minimum\s+of)\s+(\d{2})\s*(?:points|%)[^.]{0,60}?(?:functionality|quality)",
    re.IGNORECASE | re.DOTALL)
SANRAL_METHOD_RE = re.compile(r"explanation\s+of\s+consultant\s+tender\s+evaluation", re.IGNORECASE)

SPECIFIC_GOALS_SECTION_RE = re.compile(r"specific\s+goals?", re.IGNORECASE)
BBBEE_TABLE_RE = re.compile(r"B-?BBEE\s+(?:Status\s+)?Level", re.IGNORECASE)
LOCALITY_RE = re.compile(r"\blocality\b|within\s+the\s+(?:boundaries|jurisdiction)", re.IGNORECASE)
OWNERSHIP_TERMS = [
    ("women", re.compile(r"\bwomen\b", re.IGNORECASE)),
    ("youth", re.compile(r"\byouth\b", re.IGNORECASE)),
    ("persons with disability", re.compile(r"disabilit", re.IGNORECASE)),
    ("historically disadvantaged individuals", re.compile(r"historically\s+disadvantaged|\bHDIs?\b")),
    ("black ownership", re.compile(r"black\s+(?:people|owned|ownership)", re.IGNORECASE)),
]
NUM_RE = re.compile(r"\d{1,2}(?:\.\d{1,2})?")


# Two other real phrasings, both from live 2026-10-16 releases: DPWI's
# "Maximum points on Price - 80 points" (SCMU5-26/27-0007SB) and Transnet's
# "Price and Specific Goals [Weighted score 80/20 points]".
PREF_MAX_PRICE_RE = re.compile(r"maximum\s+points\s+(?:on|for)\s+price\s*[-:]?\s*(80|90)\s*points", re.IGNORECASE)
PREF_WEIGHTED_RE = re.compile(r"weighted\s+score\s+(80/20|90/10)", re.IGNORECASE)


def _preference_system(text):
    explicit = {m.group(1) for m in PREF_EXPLICIT_RE.finditer(text)}
    explicit |= {m.group(1) for m in PREF_THEREFORE_RE.finditer(text)}
    explicit |= {m.group(1) for m in PREF_WEIGHTED_RE.finditer(text)}
    explicit |= {f"{m.group(1)}/{100 - int(m.group(1))}" for m in PREF_MAX_PRICE_RE.finditer(text)}
    either = bool(PREF_EITHER_RE.search(text))
    if len(explicit) == 1:
        # A single explicit statement wins over the SBD 6.1 template's own
        # "c) Either the 90/10 or 80/20..." option line, which buyers often
        # leave in without striking it out (Dawid Kruiper, DPWI samples).
        system = explicit.pop()
        return {"system": system,
                "reason": f"The tender document states the {system} preference point system applies."}
    if explicit or either:
        return {"system": "ambiguous",
                "reason": ("The document lists more than one preference point system (the standard SBD 6.1 "
                           "prints every option for the buyer to strike out, and some buyers decide by the "
                           "lowest acceptable price) - check which one applies.")}
    if PREF_ANY_RE.search(text):
        return {"system": "ambiguous",
                "reason": "80/20 and/or 90/10 are mentioned, but no sentence states which applies to this tender."}
    return {"system": "not_found",
            "reason": "No preference point system stated in the available text."}


def _bbbee_points_by_level(text):
    """Parses a SANRAL-style 'B-BBEE Level | 10-point | 20-point' table.
    Returns {level: (pts_10_system, pts_20_system)} or {} if not parseable.
    Real-sample quirk handled: SANRAL's Level 6 row also carries the two
    'Maximum points' cells (3.00 10.00 6.00 20.00), so a 4-number row takes
    the 1st and 3rd values. Only accepted when Level 1 reads exactly 10/20 -
    otherwise the 'Level N' lines matched were something else (e.g. a B-BBEE
    proof-of-status paragraph), and no number is returned."""
    table = {}
    for level in range(1, 9):
        m = re.search(rf"Level\s*{level}\b([^\n]*)", text)
        if not m:
            continue
        nums = [float(n) for n in NUM_RE.findall(m.group(1))]
        if len(nums) >= 4:
            table[level] = (nums[0], nums[2])
        elif len(nums) >= 2:
            table[level] = (nums[0], nums[1])
    if table.get(1) != (10.0, 20.0):
        return {}
    return table


BLACK_100_ROW_RE = re.compile(r"100\s*%\s*black\s+ownership\s+(\d{1,2}(?:\.\d+)?)\b", re.IGNORECASE)
BBBEE_ROW_RE = re.compile(r"B-?BBEE\s+status\s+level\s+of\s+contributor\s+\d", re.IGNORECASE)


def _specific_goals(text, profile, pref_system):
    """Real specific-goal tables are heterogeneous - one live DPWI tender mixes
    black ownership, black women, youth, disability AND locality rows in one
    20-point table. So this names every basis it finds, and only returns a
    number where the profile genuinely answers it: a full SANRAL-style B-BBEE
    level table, or (as a floor, not a total) a '100% black ownership' row
    when the profile records 100% black ownership."""
    if not SPECIFIC_GOALS_SECTION_RE.search(text):
        return {"basis": "not_found", "bases": [], "points_estimate": None,
                "reason": "No specific-goals section found in the available text."}

    level = profile.get("bee_level")
    table = _bbbee_points_by_level(text)
    if table and level in table:
        p10, p20 = table[level]
        if pref_system == "90/10":
            est = f"{p10:g} of 10"
        elif pref_system == "80/20":
            est = f"{p20:g} of 20"
        else:
            est = f"{p10:g} of 10 (90/10) or {p20:g} of 20 (80/20)"
        return {"basis": "bbbee_level", "bases": ["bbbee_level"], "points_estimate": est,
                "reason": (f"Specific goals are scored on B-BBEE level; level {level} on file. Only counts if "
                           "the proof this buyer asks for is valid at closing (some ask for a verification "
                           "certificate - a QSE sworn affidavit may need checking).")}

    bases = []
    if BBBEE_ROW_RE.search(text):
        bases.append("bbbee_status")
    if LOCALITY_RE.search(text):
        bases.append("locality")
    owners = [name for name, rx in OWNERSHIP_TERMS if rx.search(text)]
    if owners:
        bases.append("ownership")

    if not bases:
        return {"basis": "unrecognised", "bases": [], "points_estimate": None,
                "reason": "A specific-goals section exists but its criteria could not be identified from the text."}

    parts = []
    if "bbbee_status" in bases:
        parts.append("B-BBEE status level (points per level not stated in a readable table)")
    if "ownership" in bases:
        parts.append(f"ownership ({', '.join(owners)})")
    if "locality" in bases:
        parts.append("locality (office in the buyer's area - not recorded in the profile)")
    reason = "Specific goals based on " + "; ".join(parts) + "."

    estimate = None
    m = BLACK_100_ROW_RE.search(text)
    bo = profile.get("black_ownership_pct")
    if m and isinstance(bo, (int, float)) and bo >= 100:
        estimate = f"at least {float(m.group(1)):g} (100% black ownership row only)"
        reason += (" The '100% black ownership' row is claimable from the profile; women/youth/disability "
                   "ownership and locality are not on file, so the rest is not estimated.")
    else:
        reason += " Not estimated - the profile does not record enough to answer these rows."
    return {"basis": bases[0] if len(bases) == 1 else "mixed", "bases": bases,
            "points_estimate": estimate, "reason": reason}


FUNCTIONALITY_NA_RE = re.compile(r"functionality\s*\n?\s*N/?A\b", re.IGNORECASE)


def _functionality(text):
    if FUNCTIONALITY_NA_RE.search(text) and not THRESHOLD_RE.search(text):
        return {"present": False, "threshold": None,
                "reason": "The document marks functionality scoring as not applicable - price and specific goals only."}
    if not FUNCTIONALITY_RE.search(text):
        return {"present": None, "threshold": None,
                "reason": "No functionality/quality evaluation mentioned in the available text."}
    m = THRESHOLD_RE.search(text) or THRESHOLD_ALT_RE.search(text)
    threshold = int(m.group(1)) if m else None
    sanral = bool(SANRAL_METHOD_RE.search(text))
    if sanral:
        reason = ("Uses SANRAL's published consultant scoring (technical 30, management 15, quality "
                  "system 10, past performance 15, workplan 30). Key-person points can be estimated in the "
                  "Tender Workspace once people are assigned; workplan points depend on other bidders' hours.")
    else:
        reason = ("Functionality is evaluated by the buyer's committee against its own criteria table - "
                  "not estimated here.")
    if threshold:
        reason = f"Minimum functionality score {threshold} to proceed to price. " + reason
    return {"present": True, "threshold": threshold, "sanral_methodology": sanral, "reason": reason}


def estimate_score_outlook(text, depth, profile, cidb_required=None):
    """text: the deepest extracted document text for the tender ('' if none).
    depth: assess_tender.document_depth() value (or 'metadata_only'/'not_fetched').
    profile: assess_tender.load_company_profile() dict (+ black_ownership_pct if present).
    Returns a dict that is JSON-safe and carries a short `summary` list the
    Discovery page renders as-is."""
    price = {"points_estimate": None,
             "reason": ("Price points (80 or 90) are scored against the lowest acceptable price among all "
                        "bidders - unknowable before closing.")}
    if depth in ("metadata_only", "not_fetched", "no_extractable_text") or not (text or "").strip():
        return {
            "estimable": "none",
            "preference_system": {"system": "not_found", "reason": "No document text to read."},
            "specific_goals": {"basis": "not_found", "bases": [], "points_estimate": None,
                               "reason": "No document text to read."},
            "functionality": {"present": None, "threshold": None, "reason": "No document text to read."},
            "price": price,
            "summary": ["No readable tender document - scoring rules unknown until the full RFP is read."],
        }

    pref = _preference_system(text)
    goals = _specific_goals(text, profile, pref["system"])
    func = _functionality(text)

    summary = []
    if func.get("present"):
        summary.append(f"Functionality scored first" +
                       (f" - minimum {func['threshold']} to qualify for price." if func.get("threshold") else "."))
    if func.get("present") is False:
        summary.append("No functionality stage - price and specific goals only.")
    if func.get("sanral_methodology"):
        summary.append("SANRAL consultant scoring - open the Tender Workspace for a key-person estimate.")
    if pref["system"] in ("80/20", "90/10"):
        summary.append(f"{pref['system']} preference points.")
    if goals["points_estimate"]:
        summary.append(f"Specific goals: {goals['points_estimate']} from what's on file.")
    elif goals.get("bases"):
        summary.append(f"Specific goals based on {', '.join(b.replace('_', ' ') for b in goals['bases'])} "
                       "- not estimated, check by hand.")
    if cidb_required and not profile.get("has_cidb_grading"):
        summary.append(f"Requires CIDB {cidb_required} - none on file, likely non-responsive.")
    summary.append("Price points not estimable before closing.")
    if depth == "advert_or_partial":
        summary.append("Read from an advert/partial document only - full RFP may differ.")

    estimable = "partial" if (goals["points_estimate"] or func.get("threshold") or
                              pref["system"] in ("80/20", "90/10")) else "none"
    return {
        "estimable": estimable,
        "preference_system": pref,
        "specific_goals": goals,
        "functionality": func,
        "price": price,
        "summary": summary,
    }
