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

Two further per-tender readings (Sarel, 2026-10-16, audit questions 3 and 11 -
evidence in docs/specs/Tender-Evaluation-Engine-Audit.md, "Round 2"):

  - EXPERIENCE EVIDENCE (extract_experience_evidence): "experience evidence is
    specific to each tender... what counts as evidence they normally specify
    in the functional requirements". Real tenders disagree on every axis:
    SANRAL B6 wants 3 projects / 10 years / CIDB Annex 1 or reference letter;
    Gauteng DRT wants completion certificates since 2000 ("practical
    completion certificate will not be accepted") in one schedule and
    reference letters WITH aligned appointment letters in the other; Transnet
    wants 5 traceable award letters/POs WITH completion proof in 10 years;
    DPWI wants 3 contactable references, 3 of them in the last 5 years;
    uMlalazi wants appointment letters and completion certificates in the
    last 6 years. So the tender's own rule is read from its text; nothing
    here falls back to SANRAL's rule - that fallback is applied (and
    labelled as an assumption) by the caller only when nothing was found.
  - LOCALITY (extract_locality / match_locality): "office location sometimes
    counts for scoring". Rows like "Within Eastern Cape 4" (DPWI), "office is
    located within the boundaries of the Cape Winelands District Municipal
    Area 5" (Cape Winelands), "Within the boundaries of Dawid Kruper 20.00",
    and a mandatory "must have a local office in the Dawid Kruiper Municipal
    Jurisdiction" are read and matched against the company's structured
    office locations (province / district / local municipality).
"""
import difflib
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


def _specific_goals(text, profile, pref_system, locality=None):
    """Real specific-goal tables are heterogeneous - one live DPWI tender mixes
    black ownership, black women, youth, disability AND locality rows in one
    20-point table. So this names every basis it finds, and only returns a
    number where the profile genuinely answers it: a full SANRAL-style B-BBEE
    level table, or (as a floor, not a total) a '100% black ownership' row
    when the profile records 100% black ownership, plus a locality row one of
    the company's recorded offices actually satisfies."""
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

    loc_rows = [r for r in (locality or {}).get("rows", []) if r.get("kind") == "specific_goals"]
    bases = []
    if BBBEE_ROW_RE.search(text):
        bases.append("bbbee_status")
    if loc_rows or LOCALITY_RE.search(text):
        bases.append("locality")
    owners = [name for name, rx in OWNERSHIP_TERMS if rx.search(text)]
    if owners:
        bases.append("ownership")

    if not bases:
        return {"basis": "unrecognised", "bases": [], "points_estimate": None,
                "reason": "A specific-goals section exists but its criteria could not be identified from the text."}

    loc_match = None
    if loc_rows:
        # Match only rows of the applicable preference system when it's known.
        rows = [r for r in loc_rows if not r.get("system") or pref_system not in ("80/20", "90/10")
                or r["system"] == pref_system] or loc_rows
        loc_match = match_locality({"rows": rows}, profile.get("offices") or [])

    parts = []
    if "bbbee_status" in bases:
        parts.append("B-BBEE status level (points per level not stated in a readable table)")
    if "ownership" in bases:
        parts.append(f"ownership ({', '.join(owners)})")
    if "locality" in bases:
        if loc_match:
            areas = ", ".join(dict.fromkeys(f"{r['area']} {r['points']:g}" for r in loc_rows))
            parts.append(f"locality ({areas}) - {loc_match['reason']}")
        else:
            parts.append("locality (rows not readable from the text - check by hand)")
    reason = "Specific goals based on " + "; ".join(parts) + "."

    floors, floor_parts = 0.0, []
    m = BLACK_100_ROW_RE.search(text)
    bo = profile.get("black_ownership_pct")
    if m and isinstance(bo, (int, float)) and bo >= 100:
        floors += float(m.group(1))
        floor_parts.append("100% black ownership row")
    if loc_match and loc_match["status"] == "matched":
        floors += loc_match["points"]
        floor_parts.append("locality row")
    estimate = None
    if floor_parts:
        estimate = f"at least {floors:g} ({' + '.join(floor_parts)} only)"
        reason += " Rows not answered by the company record (women/youth/disability ownership etc.) are not estimated."
    else:
        reason += " Not estimated - the company record does not answer these rows."
    return {"basis": bases[0] if len(bases) == 1 else "mixed", "bases": bases,
            "points_estimate": estimate, "reason": reason, "locality_match": loc_match}


# ---------------------------------------------------------------------------
# Experience evidence: what THIS tender accepts as proof of company experience
# ---------------------------------------------------------------------------

WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}
_NUM = r"(?:\d{1,2}|" + "|".join(WORD_NUMBERS) + r")"
# "3 (three)", "three (3)", "Five (5)", "3", "three", "FIVE (05)"
_COUNT = rf"(?P<n1>{_NUM})(?:\s*\(\s*(?P<n2>{_NUM}|0\d)\s*\))?"


def _num(s):
    if s is None:
        return None
    s = s.strip().lower()
    if s.isdigit():
        return int(s)
    return WORD_NUMBERS.get(s)


# Anchors: phrases that only occur where a tender states what proves experience.
EVIDENCE_ANCHOR_RE = re.compile(
    r"reference\s+letters?|letters?\s+of\s+reference|contactable\s+references?|written\s+(?:contactable\s+)?references"
    r"|traceable\s+(?:references?|proof|completion)|completion\s+(?:certificates?|letters?)|certificates?\s+of\s+completion"
    r"|PSP\s+Performance\s+Report|past\s+performance\s+reports?|proof\s+of\s+previous|previously\s+completed\s+similar"
    r"|completed\s+similar\s+projects",
    re.IGNORECASE)
EVIDENCE_TYPES = [
    # (code, pattern) - codes line up with experience_items.document_type
    # (migration 0012) where one exists; award_letter covers appointment
    # letters and purchase orders, which tenders list together.
    ("performance_report", re.compile(r"PSP\s+Performance\s+Report|Annex(?:ure)?\s+1|performance\s+reports?", re.IGNORECASE)),
    ("reference_letter", re.compile(r"reference\s+letters?|letters?\s+of\s+reference|(?:written|contactable|traceable)\s+references?|signed\s+references?", re.IGNORECASE)),
    ("completion_certificate", re.compile(r"completion\s+(?:certificates?|letters?)|certificates?\s+of\s+completion", re.IGNORECASE)),
    ("award_letter", re.compile(r"letters?\s+of\s+(?:award|appointment)|(?:award|appointment)\s+letters?|purchase\s+orders?", re.IGNORECASE)),
    ("affidavit", re.compile(r"sworn\s+affidavit|\baffidavit\b", re.IGNORECASE)),
]
EVIDENCE_ORDER = [c for c, _ in EVIDENCE_TYPES]
PAIRED_PROOF_RE = re.compile(
    r"without\s+proof\s+of\s+(?:completion|appointment)|with\s+an\s+aligned\s+appointment|aligned\s+appointment\s+letter"
    r"|appointment\s+letters?\s+and\s+completion|(?:award|appointment)\s+letters?[^.]{0,40}with\s+completion"
    r"|reference\s+letters?\s+AND\s+appointment",
    re.IGNORECASE)
PRACTICAL_COMPLETION_EXCLUDED_RE = re.compile(r"practical\s+completion\s+certificates?\s+will\s+not\s+be\s+accepted", re.IGNORECASE)
WINDOW_RE = re.compile(
    rf"(?:last|past)\s+{_COUNT}\s+years|not\s+older\s+than\s+{_COUNT.replace('n1', 'm1').replace('n2', 'm2')}\b[^.]{{0,60}}?\byears",
    re.IGNORECASE)
# pdftotext -layout interleaves table columns: Transnet's "within the last ten
# Four (4) traceable proof of (10) years" - the bracketed digit still belongs
# to "last ten".
WINDOW_INTERLEAVED_RE = re.compile(rf"(?:last|past)\s+(?P<w>{_NUM})\b[^.]{{0,80}}?\(\s*(?P<d>\d{{1,2}})\s*\)\s*years", re.IGNORECASE)
SINCE_YEAR_RE = re.compile(r"(?:since|issued\s+since)\s+(?:the\s+year\s+)?((?:19|20)\d\d)(?!\d)|completed\s+in\s+\w+\s+((?:19|20)\d\d)\s+onwards", re.IGNORECASE)
COUNT_BEFORE_NOUN_RE = re.compile(
    rf"(?<![-\d])(?:minimum\s+of\s+|any\s+|at\s+least\s+|submit\s+)?{_COUNT}\s*(?:\+\s*)?(?:or\s+more\s+)?(?:\(?\s*[a-z]+\s*\)?\s+)?"
    r"(?:written\s+|traceable\s+|signed\s+|contactable\s+|positive\s+|completed\s+|similar\s+|successfully\s+)*"
    r"(?:references?|reference\s+letters?|projects?|completion\s+certificates?|purchase\s+orders?)"
    r"|(?P<w1>three|four|five|two)\s+of\s+which",
    re.IGNORECASE)
# Scored-per-project ladders: "1 Completed project 10 ... 5 Completed projects 50".
LADDER_RE = re.compile(rf"^\s*{_COUNT}\s+completed\s+projects?\s+(\d{{1,3}})\s*$", re.IGNORECASE | re.MULTILINE)
POINTS_WORDS_RE = re.compile(r"\d+\s*points|points\s*=|=\s*\d+|\bscore\s+\d+|max(?:imum)?\s+\d+\s+points", re.IGNORECASE)
CONSEQUENCE_DISQUALIFY_RE = re.compile(r"non-?\s*responsive|disqualif", re.IGNORECASE)
CONSEQUENCE_ZERO_RE = re.compile(r"zero\s*\(0\)\s*points|\b0\s*\(zero\)\s*points|receiving\s+zero|awarded\s+zero|score\s+of\s+zero", re.IGNORECASE)
# Scope is display-only (shown next to the rule so a human can judge "similar").
SCOPE_RES = [
    re.compile(r"company\s+experience\s+in\s+(?:the\s+)?([^(.:;]{3,80}?)(?=\s*\(|[.:;]|\s+bidders?\b)", re.IGNORECASE),
    re.compile(r"previous\s+work\s+(?:done|experience)\s+in\s+(?:the\s+)?([^.,;(]{3,60}?)(?=\s+within|\s+in\s+the\s+last|[.,;(])", re.IGNORECASE),
    re.compile(r"experience\s+in\s+(general\s+building\s+projects|[a-z][^.,;(•]{3,50}?\s+projects)", re.IGNORECASE),
    re.compile(r"(similar\s+(?:scope|nature|projects|services)(?:\s+e\.?g\.?[^.]{0,90})?)", re.IGNORECASE),
]
KEY_PERSONNEL_RE = re.compile(r"key\s+personnel|forms?\s+B1\b|\bCVs?\b|curriculum\s+vitae|\(C\.V\)", re.IGNORECASE)


def _flat(s):
    return re.sub(r"\s+", " ", s).strip()


def _evidence_windows(text, gap=1200):
    """Groups anchor hits that sit close together (measured in flattened
    characters - -layout output is mostly padding) into one window of text:
    one stated requirement usually mentions 'reference letter' several times.
    Returns (anchor offset within the window, window text)."""
    hits = [m.start() for m in EVIDENCE_ANCHOR_RE.finditer(text)]
    groups = []
    for h in hits:
        if groups and len(_flat(text[groups[-1][1]:h])) < gap:
            groups[-1][1] = h
        else:
            groups.append([h, h])
    out = []
    for a, b in groups:
        start = max(0, a - 900)
        nl = text.find("\n", start, a)
        start = nl + 1 if nl >= 0 else start
        end = min(len(text), b + 1100)
        out.append((a - start, text[start:end]))
    return out


def _parse_evidence_window(anchor_off, window):
    flat = _flat(window)
    # Key-personnel forms ("Forms B1 ... contactable references", "C.V with
    # traceable reference") are about a PERSON's CV, not company experience
    # evidence - judged on the text right around the anchor.
    near = _flat(window[max(0, anchor_off - 450):anchor_off + 150])
    if KEY_PERSONNEL_RE.search(near) and not re.search(r"company\s+experience|completed\s+(?:similar\s+)?projects|past\s+performance", near, re.IGNORECASE):
        return None
    if not re.search(r"experience|previous|past\s+performance|completed|references", flat, re.IGNORECASE):
        return None

    accepted = [code for code, rx in EVIDENCE_TYPES if rx.search(flat)]
    if not [a for a in accepted if a != "affidavit"]:
        return None

    counts = []
    for m in COUNT_BEFORE_NOUN_RE.finditer(flat):
        if m.group("n1") and m.group("n2") and _num(m.group("n1")) != _num(m.group("n2")):
            continue  # "30 (4) Project value" - a points cell next to a list number, not a count
        n = (_num(m.group("n2")) or _num(m.group("n1"))) if m.group("n1") else _num(m.group("w1"))
        if n and 1 <= n <= 20:
            counts.append(n)
    ladder = [(_num(m.group("n2")) or _num(m.group("n1"))) for m in LADDER_RE.finditer(window)]
    ladder = [n for n in ladder if n]
    points_scored = bool(ladder) or bool(POINTS_WORDS_RE.search(flat))
    # A points table that lists 3+ different project counts (1..5, "four or
    # more" / "three" / "two") is a ladder even when its layout isn't the
    # "N Completed projects P" one: full points at the highest count.
    if not ladder and points_scored and len(set(counts)) >= 3:
        ladder = counts

    window_years = None
    m = WINDOW_RE.search(flat)
    if m:
        window_years = (_num(m.group("n2")) or _num(m.group("n1"))) if m.group("n1") else (_num(m.group("m2")) or _num(m.group("m1")))
    else:
        m = WINDOW_INTERLEAVED_RE.search(flat)
        if m and _num(m.group("w")) == int(m.group("d")):
            window_years = int(m.group("d"))
    since_year = None
    m = SINCE_YEAR_RE.search(flat)
    if m:
        since_year = int(m.group(1) or m.group(2))

    scope = None
    for rx in SCOPE_RES:
        m = rx.search(flat)
        if m:
            scope = _flat(m.group(1)).strip(" ,")[:90]
            break

    if points_scored:
        consequence = "points"
    elif CONSEQUENCE_DISQUALIFY_RE.search(flat):
        consequence = "disqualify"
    elif CONSEQUENCE_ZERO_RE.search(flat):
        consequence = "zero_points"
    else:
        consequence = None

    projects_required = max(ladder) if ladder else (counts[0] if counts else None)
    # Quote: the sentence that best states the rule, verbatim (whitespace collapsed).
    sentences = re.split(r"(?<=[.!?])\s+|\s(?=\d\.\d{1,2}\s+[A-Z])", flat)

    def has_win(x):
        return WINDOW_RE.search(x) or WINDOW_INTERLEAVED_RE.search(x)

    ranked = ([x for x in sentences if EVIDENCE_ANCHOR_RE.search(x) and has_win(x)]
              + [x for x in sentences if EVIDENCE_ANCHOR_RE.search(x) and COUNT_BEFORE_NOUN_RE.search(x)]
              + [x for x in sentences if has_win(x)]
              + [x for x in sentences if EVIDENCE_ANCHOR_RE.search(x)])
    quote = ranked[0] if ranked else flat[:300]
    if len(quote) > 260:
        # Long run-on "sentences" come from table layouts: start the quote
        # near the anchor instead of at the top of the table.
        m = EVIDENCE_ANCHOR_RE.search(quote) or COUNT_BEFORE_NOUN_RE.search(quote)
        if m and m.start() > 120:
            cut = quote.rfind(" ", 0, m.start() - 100)
            quote = "..." + quote[cut + 1 if cut >= 0 else m.start() - 100:]
    return {
        "projects_required": projects_required,
        "scored_per_project": bool(ladder),
        "window_years": window_years,
        "since_year": since_year,
        "accepted_evidence": accepted,
        "requires_appointment_and_completion": bool(PAIRED_PROOF_RE.search(flat)),
        "practical_completion_excluded": bool(PRACTICAL_COMPLETION_EXCLUDED_RE.search(flat)),
        "scope": scope,
        "consequence": consequence,
        "disqualification_mentioned": bool(CONSEQUENCE_DISQUALIFY_RE.search(flat)),
        "quote": quote[:400],
    }


def extract_experience_evidence(text):
    """Returns {"source": "tender_document"|"not_found", "rules": [...], "reason"}.
    One tender can state several rules (Gauteng DRT: one per schedule) - each
    is kept. Restatements of the same rule (SANRAL repeats B6 in the scoring
    explanation and on the form; Transnet in the narrative and the scoring
    table) are merged: same project count and window, overlapping evidence."""
    rules = []
    for off, window in _evidence_windows(text or ""):
        r = _parse_evidence_window(off, window)
        if not r:
            continue
        if not (r["projects_required"] or r["window_years"] or r["since_year"] or r["consequence"]):
            continue
        dup = None
        for e in rules:
            same_n = e["projects_required"] == r["projects_required"] or not r["projects_required"] or not e["projects_required"]
            same_w = (e["window_years"] == r["window_years"] or not r["window_years"] or not e["window_years"]) and \
                     (e["since_year"] == r["since_year"] or not r["since_year"] or not e["since_year"])
            overlap = set(e["accepted_evidence"]) & set(r["accepted_evidence"]) - {"affidavit"}
            if same_n and same_w and overlap and e["requires_appointment_and_completion"] == r["requires_appointment_and_completion"]:
                dup = e
                break
        if dup:
            # Keep the most specific reading of each field.
            for k in ("projects_required", "window_years", "since_year", "scope", "consequence"):
                dup[k] = dup[k] or r[k]
            dup["accepted_evidence"] = sorted(set(dup["accepted_evidence"]) | set(r["accepted_evidence"]),
                                              key=EVIDENCE_ORDER.index)
            dup["practical_completion_excluded"] |= r["practical_completion_excluded"]
            dup["disqualification_mentioned"] |= r["disqualification_mentioned"]
            continue
        rules.append(r)
    if not rules:
        return {"source": "not_found", "rules": [],
                "reason": "The available text doesn't state what proves company experience for this tender."}
    return {"source": "tender_document", "rules": rules,
            "reason": f"{len(rules)} experience-evidence requirement(s) read from the tender's own text."}


EVIDENCE_LABEL = {
    "performance_report": "CIDB performance reports", "reference_letter": "reference letters",
    "completion_certificate": "completion certificates", "award_letter": "award/appointment letters or POs",
    "affidavit": "an affidavit (fallback)",
}


def describe_evidence_rule(r):
    parts = []
    if r["projects_required"]:
        if r["scored_per_project"]:
            parts.append(f"scored per project, full points at {r['projects_required']}")
        else:
            parts.append(f"{r['projects_required']} project(s)")
    if r["window_years"]:
        parts.append(f"in the last {r['window_years']} years")
    if r["since_year"]:
        parts.append(f"since {r['since_year']}")
    ev = [EVIDENCE_LABEL.get(e, e) for e in r["accepted_evidence"]]
    if ev:
        parts.append("proof: " + " / ".join(ev))
    if r["requires_appointment_and_completion"]:
        parts.append("appointment AND completion proof per project")
    if r["practical_completion_excluded"]:
        parts.append("practical completion certificates not accepted")
    if r["consequence"] == "points":
        parts.append("scored for points")
    elif r["consequence"] == "disqualify":
        parts.append("non-responsive without it")
    elif r["consequence"] == "zero_points":
        parts.append("0 points without it")
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Locality: where the company's offices are vs where the tender prefers
# ---------------------------------------------------------------------------

PROVINCES = ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga",
             "Northern Cape", "North West", "Western Cape"]
PROVINCE_ALIASES = {"kzn": "KwaZulu-Natal", "kwazulu natal": "KwaZulu-Natal", "kwa zulu natal": "KwaZulu-Natal",
                    "northwest": "North West"}
LOCALITY_CONTEXT_RE = re.compile(
    r"\blocality\b|within\s+the\s+boundaries|located\s+within|enterprise\s+located|operating\s+within|local\s+office|area\s+of\s+supplier",
    re.IGNORECASE)
LOCALITY_AREA_RE = re.compile(
    r"(?<![Oo]ut)(?i:within|located\s+in|operating\s+within)\s+(?i:the\s+)?(?i:boundaries\s+of\s+(?:the\s+)?|jurisdiction\s+of\s+(?:the\s+)?)?"
    r"(?P<area>(?:[A-Z]|[a-z](?=[A-Z]))[A-Za-z'\-]+(?:\s+(?:[A-Z][A-Za-z'\-]+|of))*)")
AREA_STOP_RE = re.compile(r"\s+(?:Municipal|Municipality|Province|Area|Jurisdiction|Local|Within|Outside|Points?|Good|Very|Satisfactory|Poor|Excellent)\b.*$")
AREA_KEEP_RE = re.compile(r"^(.*?\b(?:District|Metropolitan|Metro))\b.*$")
AREA_REJECT_RE = re.compile(r"south\s+africa|abroad|republic|\bRSA\b|^(?:a|an|this|that|which|its|their|terms|respect|period|time|accordance)$", re.IGNORECASE)
MANDATORY_LOCAL_OFFICE_RE = re.compile(
    r"must\s+have\s+a\s+local\s+office\s+in\s+(?:the\s+)?(?P<area>[A-Z][A-Za-z'\- ]+?)(?:\s+Municipal\s+Jurisdiction|\s+area|[.,])",
    re.IGNORECASE)
TRAILING_POINTS_RE = re.compile(r"\s(\d{1,2}(?:[.,]\d{1,2})?)\s*\|?\s*$")
FUNC_POINTS_RE = re.compile(r"\(?\s*Points?\s*=\s*(\d{1,2})\s*\)?", re.IGNORECASE)


def _norm_area(s):
    s = re.sub(r"\b(the|boundaries|of|municipal|municipality|area|jurisdiction|local|district|metropolitan|metro|province)\b",
               " ", (s or "").lower())
    return re.sub(r"[^a-z]", "", s)


def _province_of(name):
    key = re.sub(r"[^a-z ]", " ", (name or "").lower()).strip()
    key = re.sub(r"\s+", " ", key)
    if key in PROVINCE_ALIASES:
        return PROVINCE_ALIASES[key]
    for p in PROVINCES:
        if key == p.lower().replace("-", " "):
            return p
    return None


def _dominant_province(text):
    counts = {p: len(re.findall(re.escape(p).replace(r"\-", "[- ]?"), text, re.IGNORECASE)) for p in PROVINCES}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else None


def _clean_area(raw):
    a = AREA_STOP_RE.sub("", raw.strip())
    m = AREA_KEEP_RE.match(a)
    if m:
        a = m.group(1)
    return a.strip(" -'")


def _row_points(lines, j):
    """(points, kind). Functionality tables say '(Points = 10)' next to the
    row (uMlalazi); specific-goal tables put the number at the end of the
    row's line or a neighbouring line (DPWI, Cape Winelands, Dawid Kruiper)."""
    for k in (j + 1, j, j - 1):
        if 0 <= k < len(lines):
            m = FUNC_POINTS_RE.search(lines[k])
            if m:
                return float(m.group(1)), "functionality"
    for k in (j, j - 1, j + 1):
        if 0 <= k < len(lines):
            if k != j and LOCALITY_AREA_RE.search(lines[k]):
                continue
            if re.search(r"\d{1,2}/\d{1,2}\s*$", lines[k]):
                continue
            m = TRAILING_POINTS_RE.search(lines[k])
            if m:
                v = float(m.group(1).replace(",", "."))
                if 0 < v <= 20:
                    return v, "specific_goals"
    return None, None


def _row_system(lines, j):
    for k in range(j, max(-1, j - 9), -1):
        seg = lines[k]
        if "90/10" in seg or "90|10" in seg:
            return "90/10"
        if "80/20" in seg or "80|20" in seg:
            return "80/20"
    return None


def extract_locality(text):
    """Returns {"rows": [{area, level, province, points, system, kind, quote}],
    "mandatory_local_office": {...}|None, "inferred_province": ...}.
    level: province | district | municipality. kind: specific_goals (preference
    points) | functionality (a quality criterion, uMlalazi)."""
    text = text or ""
    lines = text.split("\n")
    rows, seen = [], set()
    dominant = _dominant_province(text)
    scanned = set()
    for i, line in enumerate(lines):
        if not LOCALITY_CONTEXT_RE.search(line):
            continue
        for j in range(max(0, i - 2), min(len(lines), i + 14)):
            if j in scanned:
                continue
            scanned.add(j)
            seg = lines[j]
            m = LOCALITY_AREA_RE.search(seg)
            if not m or re.search(r"\boutside\b", seg, re.IGNORECASE):
                continue
            joined = _flat(seg[m.start():] + " " + (lines[j + 1].strip() if j + 1 < len(lines) else ""))
            m2 = LOCALITY_AREA_RE.search(joined)
            area = _clean_area(m2.group("area") if m2 else m.group("area"))
            if not area or AREA_REJECT_RE.search(area):
                continue
            pts, kind = _row_points(lines, j)
            if pts is None:
                continue
            prov = _province_of(area)
            if prov:
                level = "province"
            elif re.fullmatch(r"(?:the\s+)?province", area, re.IGNORECASE):
                level, prov = "province", dominant
                area = dominant or "the buyer's province"
            elif re.fullmatch(r"(?:the\s+)?district(?:\s+municipality)?", area, re.IGNORECASE):
                level, area = "district", "the buyer's district (not named in this row)"
            elif re.search(r"district|metro", area, re.IGNORECASE):
                level = "district"
            else:
                level = "municipality"
            system = _row_system(lines, j)
            key = (_norm_area(area), system, kind)
            if key in seen or (system is None and any(k[0] == key[0] and k[2] == kind for k in seen)):
                continue
            seen.add(key)
            rows.append({"area": area, "level": level, "province": prov, "points": pts, "system": system,
                         "kind": kind, "quote": _flat(seg)[:200]})
    # An unnamed "within District Municipality" row (uMlalazi's first table)
    # takes the district another row of the same document names, if exactly one.
    named = {r["area"] for r in rows if r["level"] == "district" and not r["area"].startswith("the buyer")}
    for r in rows:
        if r["area"].startswith("the buyer's district") and len(named) == 1:
            r["area"] = next(iter(named))
            r["area_inferred"] = True
    mand = None
    flat = _flat(text)
    m = MANDATORY_LOCAL_OFFICE_RE.search(flat)
    if m:
        ctx = flat[m.start():m.start() + 500]
        mand = {"area": m.group("area").strip(), "disqualifies": bool(CONSEQUENCE_DISQUALIFY_RE.search(ctx)),
                "quote": ctx[:300]}
    return {"rows": rows, "mandatory_local_office": mand, "inferred_province": dominant}


def _area_matches(area, office):
    a = _norm_area(area)
    if not a:
        return False
    for f in ("district_municipality", "local_municipality", "town"):
        v = _norm_area(office.get(f))
        if v and (a == v or difflib.SequenceMatcher(None, a, v).ratio() >= 0.85 or (len(v) >= 6 and (v in a or a in v))):
            return True
    return False


def match_locality(loc, offices):
    """Best locality row any company office satisfies. offices: list of
    {province, district_municipality, local_municipality, town, derived?}.
    Returns {"status": "matched"|"no_match"|"unknown", "points", "row", "office", "reason"}."""
    rows = loc.get("rows") or []
    if not offices:
        return {"status": "unknown", "points": None, "row": None, "office": None,
                "reason": "No office locations on file - locality points can't be checked."}
    best = None
    for row in rows:
        for o in offices:
            ok = (row["level"] == "province" and row.get("province") and o.get("province") == row["province"]) \
                 or (row["level"] != "province" and _area_matches(row["area"], o))
            if ok and (best is None or row["points"] > best[0]["points"]):
                best = (row, o)
    if best:
        row, o = best
        where = o.get("local_municipality") or o.get("district_municipality") or o.get("town") or o.get("province")
        derived = " (office derived from the registered address, not a confirmed office record)" if o.get("derived") else ""
        return {"status": "matched", "points": row["points"], "row": row, "office": o,
                "reason": f"office in {where}{derived} matches '{row['area']}' - {row['points']:g} point(s)"
                          + (f" under {row['system']}" if row.get("system") else "") + "."}
    places = ", ".join(sorted({o.get("province") or "?" for o in offices}))
    derived = " (derived from the registered address)" if any(o.get("derived") for o in offices) else ""
    return {"status": "no_match", "points": 0, "row": None, "office": None,
            "reason": f"no office in the preferred area(s) - offices on file: {places}{derived}."}


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
    profile: assess_tender.load_company_profile() dict (+ black_ownership_pct,
    offices if present).
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
            "experience_evidence": {"source": "not_found", "rules": [], "reason": "No document text to read."},
            "locality": {"rows": [], "mandatory_local_office": None, "match": None},
            "price": price,
            "summary": ["No readable tender document - scoring rules unknown until the full RFP is read."],
        }

    pref = _preference_system(text)
    locality = extract_locality(text)
    goals = _specific_goals(text, profile, pref["system"], locality)
    func = _functionality(text)
    evidence = extract_experience_evidence(text)
    offices = profile.get("offices") or []
    loc_all_match = match_locality(locality, offices) if locality["rows"] else None
    mand = locality.get("mandatory_local_office")
    if mand:
        mand_ok = match_locality({"rows": [{"area": mand["area"], "level": "municipality", "province": None,
                                            "points": 0.0, "system": None}]}, offices)
        mand["company_has_office_there"] = None if mand_ok["status"] == "unknown" else mand_ok["status"] == "matched"

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
    lm = goals.get("locality_match")
    if lm:
        sg_rows = [r for r in locality["rows"] if r.get("kind") == "specific_goals"]
        summary.append("Locality points (" + ", ".join(dict.fromkeys(f"{r['area']} {r['points']:g}" for r in sg_rows))
                       + f"): {lm['reason']}")
    func_loc = [r for r in locality["rows"] if r.get("kind") == "functionality"]
    if func_loc:
        fm = match_locality({"rows": func_loc}, offices)
        summary.append("Locality is also a functionality criterion ("
                       + ", ".join(f"{r['area']} {r['points']:g}" for r in func_loc) + f"): {fm['reason']}")
    if mand:
        has = mand.get("company_has_office_there")
        summary.append(f"Requires a local office in {mand['area']}"
                       + (" - non-responsive without one" if mand["disqualifies"] else "")
                       + ("; you have one on file." if has else "; none on file there." if has is False
                          else "; no office locations on file to check."))
    if evidence["rules"]:
        r0 = evidence["rules"][0]
        more = f" (+{len(evidence['rules']) - 1} more rule(s) in this document)" if len(evidence["rules"]) > 1 else ""
        summary.append(f"Experience proof this tender asks for: {describe_evidence_rule(r0)}{more}.")
    else:
        summary.append("Experience proof not stated in the available text - check the full RFP.")
    if cidb_required and not profile.get("has_cidb_grading"):
        summary.append(f"Requires CIDB {cidb_required} - none on file, likely non-responsive.")
    summary.append("Price points not estimable before closing.")
    if depth == "advert_or_partial":
        summary.append("Read from an advert/partial document only - full RFP may differ.")

    estimable = "partial" if (goals["points_estimate"] or func.get("threshold") or
                              pref["system"] in ("80/20", "90/10") or evidence["rules"]) else "none"
    return {
        "estimable": estimable,
        "preference_system": pref,
        "specific_goals": goals,
        "functionality": func,
        "experience_evidence": evidence,
        "locality": {"rows": locality["rows"], "mandatory_local_office": mand,
                     "inferred_province": locality.get("inferred_province"), "match": loc_all_match},
        "price": price,
        "summary": summary,
    }
