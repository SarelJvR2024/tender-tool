"""
A tender's OWN key-person minimum requirements - the C3.1.11(d) "Minimum
requirements" table of a SANRAL (CIDB-format) Scope of Services: per position,
the minimum qualification / registration, the minimum relevant experience in
years, and any other requirement.

Why (hardcoded-assumptions audit Q5, Sarel 2026-10-17 "Rest of Q5: build
it"): the compliance check used ONE tender's table - R.396-010-2025/1F Book
2/3 C3.1.11(d) - for every SANRAL tender. C3.1.11 lives in each tender's own
Scope of Services ("The minimum qualifications and requirements ... shall be
as indicated in the table below"), and real tenders do differ. Read on disk,
2026-10-17:

    position              R.396-010-2025/1F           N.011-010-2027-1F
    Contract Engineer     Pr Eng or Pr Tech Eng, 10   Pr Eng (only), 10
    Engineer's Rep (RE)   Pr Eng or Pr Tech Eng, 5    Pr Eng or Pr Tech Eng, 10-15
    Assistant RE          Registered candidate, 2     Candidate Technician to Pr Eng, 5
    Project Leader        ... "In permanent employment of the tendering entity
                          or Targeted Enterprise"     ... "of the tendering entity" (only)
    Quantity Surveyor     (no row)                    SACQSP registered, 5

So the tender's own table is read, exactly as extract_experience_evidence()
reads the tender's own experience-evidence rule (score_outlook.py): nothing
here falls back to R.396's table - the caller (app/lib/tenderCompliance.ts)
does that, labelled "Assumed rule", only when this returns not_found.

Input is `pdftotext -layout` text (what every engine reader produces). The
table is a layout table with multi-line cells; it is read by column position
(the header's "Position" / "Qualification" / "Experience" / "Other" columns,
re-measured after every page break, where the header repeats with a
different indent), and each line's cells are assigned to the position whose
name sits nearest (multi-line cells are vertically centred on their row).
What can't be placed is reported, not guessed: a row comes back with its
verbatim cells, and `unparsed` lists left-over text.

Returns {"source": "tender_document"|"not_found", "clause", "rows": [...],
"unparsed": [...], "reason"}; each row:
    position          the table's own wording ("Assistant Project Leader")
    position_code     PL/APL/DS/ADS/CE/ACE/RE/ARE when it is one of SANRAL's
                      coded key positions, else null (a specialist row)
    specialist        engineering_geologist / surveyor / quantity_surveyor /
                      ohs_specialist / ... for a specialist row, else null
    qualification     the minimum qualification/registration cell, verbatim
                      (footnote markers stripped)
    registration      a code the compliance check can test: pr_eng,
                      pr_eng_or_tech, pr_techni_eng, candidate, pr_sci_nat,
                      sagc, sacqsp, sacpcmp, sacap, sacplan, sacpvp, psira,
                      none, qualification (a degree/diploma, not a
                      registration), refer (sub-service document), or null
    bodies            professional bodies the row names (ECSA, SACNASP, ...)
    years_text        the experience cell verbatim ("10", "<10", "5-10")
    years_min         the minimum as a number (10-15 -> 10; <10 -> null)
    years_under       "<10" -> 10 (an assistant position: under 10 years)
    other             the "Other Requirements" cell, verbatim
    alternatives      when a row offers several qualification/years pairs
                      (Senior Materials Technician: none 20 / ND 10 /
                      Pr Techni Eng 5): [{qualification, registration,
                      years_text, years_min}]
"""
import re

TABLE_ANCHOR_RE = re.compile(r"minimum\s+requirements", re.IGNORECASE)
CLAUSE_RE = re.compile(r"C3\.1\.11\b[^\n]{0,60}personnel|personnel\s+requirements", re.IGNORECASE)
HEADER_POSITION_RE = re.compile(r"^\s*Position\b")
END_RE = re.compile(
    r"^\s*(?:\d{1,2}\s{2,}(?:Registered|Full\s+member|South\s+African|Relevant)|[a-h]\)\s+Personnel\s+Category|"
    r"[e-h]\)\s+\w|C3\.1\.1[2-9]\b|C3\.\d+\.\d+\s+[A-Z])")
# "C3-15" / "T-11" page footers. NOT a lone number: a years cell on its own
# line ("5", "10") looks exactly like one - only a far-right lone number is a
# page number.
PAGE_NO_RE = re.compile(r"^\s*[A-Z]\d{0,2}-\d{1,3}\s*$|^\s{85,}\d{1,3}\s*$")
FOOTNOTE_MARK_RE = re.compile(r"(?<=[A-Za-z.)])\d(?=\s|$|,)")
YEARS_CELL_RE = re.compile(r"^(?:<\s*\d{1,2}|\d{1,2}(?:\s*[-–]\s*\d{1,2})?|\d{1,2}\+?)$")

# SANRAL's coded key positions (the SETUP sheet's codes) by the table's own
# wording. Order matters: assistants before their principal.
POSITION_CODES = [
    ("APL", re.compile(r"^assistant\s+project\s+leader$", re.I)),
    ("PL", re.compile(r"^project\s+leader$", re.I)),
    ("ADS", re.compile(r"^assistant\s+design\s+specialist$", re.I)),
    ("DS", re.compile(r"^design\s+specialist$", re.I)),
    ("ACE", re.compile(r"^assistant\s+contracts?\s+engineer$", re.I)),
    ("CE", re.compile(r"^contracts?\s+engineer$", re.I)),
    ("ARE", re.compile(r"^assistant\s+(?:re|resident\s+engineer|engineer.?s\s+representative)(?:\s*\(are\))?$", re.I)),
    ("RE", re.compile(r"^(?:engineer.?s\s+representative|resident\s+engineer)(?:\s*\(re\))?$", re.I)),
]
SPECIALISTS = [
    ("quantity_surveyor", re.compile(r"quantity\s+surveyor", re.I)),
    ("surveyor", re.compile(r"surveyor", re.I)),
    ("engineering_geologist", re.compile(r"geolog", re.I)),
    ("environmental_practitioner", re.compile(r"environmental", re.I)),
    ("ohs_specialist", re.compile(r"\bOHS\b|health\s+and\s+safety", re.I)),
    ("road_safety_audit_team_leader", re.compile(r"road\s+safety", re.I)),
    ("programmer", re.compile(r"programmer", re.I)),
    ("materials_technician", re.compile(r"materials\s+technician", re.I)),
    ("trainee_technician", re.compile(r"trainee", re.I)),
]

# What a qualification/registration cell asks for, most specific first.
REGISTRATION_RULES = [
    ("refer", re.compile(r"refer\s+to", re.I)),
    ("pr_sci_nat", re.compile(r"pr\.?\s*sci\.?\s*nat|SACNASP|natural\s+scien", re.I)),
    ("sacqsp", re.compile(r"SACQSP|quantity\s+surveyor", re.I)),
    ("sagc", re.compile(r"\bSAGC\b|geomatic|surveyor", re.I)),
    ("sacap", re.compile(r"SACAP|architect", re.I)),
    ("sacplan", re.compile(r"SACPLAN|planner", re.I)),
    ("sacpvp", re.compile(r"SACPVP|valuer", re.I)),
    ("psira", re.compile(r"PSIRA|security\s+officer", re.I)),
    ("sacpcmp", re.compile(r"SACPCMP|construction\s+(?:hse|health)|project\s+and\s+construction\s+management", re.I)),
    ("candidate", re.compile(r"candidate", re.I)),
    ("pr_eng_or_tech", re.compile(r"pr\.?\s*eng\w*\s+or\s+pr\.?\s*tech\.?\s*eng", re.I)),
    ("pr_techni_eng", re.compile(r"pr\.?\s*techni\.?\s*eng", re.I)),
    ("pr_tech_eng", re.compile(r"pr\.?\s*tech\.?\s*eng", re.I)),
    ("pr_eng", re.compile(r"\bpr\.?\s*eng\b|professional\s+engineer\b", re.I)),
    ("none", re.compile(r"none\s+specified", re.I)),
    ("qualification", re.compile(r"degree|diploma|bachelor|national\s+higher|\bB\.?\s?(?:Eng|Sc|Tech)\b|\bN\.?Dip", re.I)),
]
BODY_RES = [
    ("ECSA", re.compile(r"\bECSA\b|pr\.?\s*(?:eng|tech\.?\s*eng|techni\.?\s*eng)\b|candidate\s+(?:engineer|technolog|technician)|"
                        r"registered\s+candidate", re.I)),
    ("SACNASP", re.compile(r"SACNASP|pr\.?\s*sci\.?\s*nat", re.I)),
    ("SAGC", re.compile(r"\bSAGC\b", re.I)),
    ("SACQSP", re.compile(r"SACQSP", re.I)),
    ("SACPCMP", re.compile(r"SACPCMP", re.I)),
    ("SACAP", re.compile(r"SACAP", re.I)),
    ("SACPLAN", re.compile(r"SACPLAN", re.I)),
    ("SACPVP", re.compile(r"SACPVP", re.I)),
    ("PSIRA", re.compile(r"PSIRA", re.I)),
    ("SAIEG", re.compile(r"SAIEG", re.I)),
]


def _clean(s):
    s = FOOTNOTE_MARK_RE.sub("", s or "")
    return re.sub(r"\s+", " ", s).strip()


def registration_code(text):
    t = _clean(text)
    for code, rx in REGISTRATION_RULES:
        if rx.search(t):
            return code
    return None


def _years(text):
    t = _clean(text).replace("–", "-")
    m = re.match(r"^<\s*(\d{1,2})$", t)
    if m:
        return None, int(m.group(1))
    m = re.match(r"^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\+?$", t)
    if m:
        return int(m.group(1)), None
    return None, None


def _header_columns(lines, i):
    """Column start offsets from a header block starting near line i:
    'Position' on one line, 'Qualification' and 'Experience' / 'Other' within
    the next few lines. Returns (cols, last_header_line) or None."""
    block = lines[max(0, i - 3): i + 5]
    pos = qual = exp = other = None
    for ln in block:
        m = re.search(r"\bPosition\b", ln)
        if m and pos is None:
            pos = m.start()
        m = re.search(r"Qualification", ln)
        if m and qual is None:
            qual = m.start()
        m = re.search(r"Experience", ln)
        if m and exp is None:
            exp = m.start()
        m = re.search(r"\bOther\b", ln)
        if m and other is None:
            other = m.start()
    if None in (pos, qual, exp):
        return None
    last = i
    for k in range(i, min(len(lines), i + 5)):
        if re.search(r"\(years\)|Requirements|Experience|Qualification", lines[k]):
            last = k
    return {"pos": pos, "qual": qual, "exp": exp, "other": other}, last


def _split_cells(line, cols):
    """Text runs (separated by 2+ spaces) -> {column: text}. A run belongs to
    the right-most column that starts at or before it (with some slack: the
    qualification header is centred over its column)."""
    cells = {"pos": [], "qual": [], "exp": [], "other": []}
    exp_left = cols["exp"] - 6
    qual_left = min(cols["qual"], cols["pos"] + 18) - 4
    other_left = (cols["other"] - 8) if cols.get("other") is not None else 10 ** 6
    for m in re.finditer(r"\S+(?:\s\S+)*", line):
        x, txt = m.start(), m.group(0)
        if x >= other_left and not YEARS_CELL_RE.match(_clean(txt)):
            cells["other"].append(txt)
        elif x >= exp_left and (YEARS_CELL_RE.match(_clean(txt)) or x < other_left):
            cells["exp"].append(txt)
        elif x >= qual_left:
            cells["qual"].append(txt)
        else:
            cells["pos"].append(txt)
    return {k: " ".join(v) for k, v in cells.items() if v}


def _locate_table(text):
    lines = text.split("\n")
    for i, ln in enumerate(lines):
        if not CLAUSE_RE.search(ln):
            continue
        # the "d) Minimum requirements" sub-clause after the clause heading
        for j in range(i, min(len(lines), i + 120)):
            if TABLE_ANCHOR_RE.search(lines[j]):
                for k in range(j, min(len(lines), j + 25)):
                    if HEADER_POSITION_RE.search(lines[k]) or re.search(r"\bPosition\b", lines[k]):
                        hc = _header_columns(lines, k)
                        if hc:
                            return lines, k, hc
    return lines, None, None


def extract_key_person_minimums(text):
    lines, start, hc = _locate_table(text or "")
    if start is None:
        return {"source": "not_found", "clause": None, "rows": [], "unparsed": [],
                "reason": "No C3.1.11-style minimum-requirements table (Position / Qualification / Experience columns) in the available text."}
    cols, last = hc
    # Collect body lines with cells, re-measuring columns after each repeated
    # header. A blank line is kept (one per run) - it separates rows - but
    # the blanks, page number and repeated header of a page break are not.
    body = []
    k = last + 1
    while k < len(lines):
        ln = lines[k].replace("\f", "")
        if END_RE.search(ln):
            break
        if re.search(r"\bPosition\b", ln):
            nh = _header_columns(lines, k)
            if nh:
                cols, last = nh
                while body and not body[-1]:
                    body.pop()
                k = last + 1
                continue
        if (PAGE_NO_RE.match(ln) and ln.strip()) or re.search(r"^\s*Minimum\s+(?:Relevant|Requirements)\b", ln) \
                or re.search(r"^\s*(?:Minimum|Other)\s*$|^\s*Minimum\s{2,}Other\s*$|^\s*\(years\)\d?\s*$", ln):
            while body and not body[-1]:
                body.pop()
            k += 1
            continue
        if not ln.strip():
            if body and body[-1]:
                body.append({})
            k += 1
            continue
        body.append(_split_cells(ln, cols))
        k += 1
    while body and not body[-1]:
        body.pop()
    if not body:
        return {"source": "not_found", "clause": "C3.1.11(d)", "rows": [], "unparsed": [],
                "reason": "Found the minimum-requirements heading but no table rows under it."}

    # A position cell run into its qualification by a single space
    # ("Trainee Technician Candidate Technician"): split after the known title.
    for c in body:
        p_ = _clean(c.get("pos", ""))
        for t in sorted(KNOWN_TITLES, key=len, reverse=True):
            if p_.lower().startswith(t + " ") and len(p_) > len(t) + 1:
                c["pos"], rest = p_[:len(t)], p_[len(t) + 1:]
                c["qual"] = (rest + " " + c.get("qual", "")).strip()
                break

    # 1. Position names: consecutive position-column fragments, joined while
    #    the joined text is still the start of a known title (or the fragment
    #    can't end a title: "Assistant Contract").
    frags = [(i, c["pos"]) for i, c in enumerate(body) if c.get("pos")]
    bands = []  # [start, end, name]
    for i, t in frags:
        t = _clean(t)
        if bands:
            b = bands[-1]
            joined = f"{b[2]} {t}"
            continuing = (i - b[1] <= 2 and not _is_complete_title(b[2]) and (_is_title_prefix(joined) or _dangling(b[2]))) or \
                         (i - b[1] <= 3 and t.startswith("(") and t.endswith(")"))
            if continuing:
                b[1], b[2] = i, joined
                continue
        bands.append([i, i, t])
    if not bands:
        return {"source": "not_found", "clause": "C3.1.11(d)", "rows": [], "unparsed": [],
                "reason": "Found the table but could not read any position names in it."}

    def nearest_band(i):
        """Band whose name lines are closest to line i (ties: the band above)."""
        best, bd = None, None
        for bi, (s_, e_, _) in enumerate(bands):
            d = 0 if s_ <= i <= e_ else (s_ - i if i < s_ else i - e_)
            if bd is None or d < bd:
                best, bd = bi, d
        return best

    # 2. Years cells -> bands, then each band's ANCHOR line: its one numeric
    #    years line (multi-line cells are centred on it), else the middle of
    #    its name lines (rows with several alternatives, or no years at all).
    rows = [{"qual": [], "exp": [], "other": []} for _ in bands]
    years_band = {}
    for i, c in enumerate(body):
        if c.get("exp"):
            bi = nearest_band(i)
            rows[bi]["exp"].append((i, _clean(c["exp"])))
            if YEARS_CELL_RE.match(_clean(c["exp"])):
                years_band[i] = bi
    anchors = []
    for bi, (s_, e_, _) in enumerate(bands):
        ys = [i for i, b_ in years_band.items() if b_ == bi]
        anchors.append(ys[0] if len(ys) == 1 else (s_ + e_) / 2)

    def nearest_anchor(x, prefer_below=False):
        """Ties: the anchor above (a centred cell runs on below its row's
        middle) - or, for a phrase that starts a new cell, the one below."""
        return min(range(len(bands)), key=lambda bi: (abs(anchors[bi] - x), (anchors[bi] < x) if prefer_below else (anchors[bi] > x)))

    DANGLE = (" a", " as a", " in", " or", " of", " the", " and", ",", "(", " to Pr", " to")

    def groups(col, merge_gap):
        """Cells of one column as groups of lines: contiguous lines, also
        across a one-line gap when merge_gap(prev_text, gap_line, next_text)."""
        out_ = []
        for i, c in enumerate(body):
            t = c.get(col)
            if not t:
                continue
            t = _clean(t)
            if out_ and (i - out_[-1][-1][0] == 1 or
                         (i - out_[-1][-1][0] == 2 and merge_gap(out_[-1][-1][1], body[i - 1], t))):
                out_[-1].append((i, t))
            else:
                out_.append([(i, t)])
        return out_

    def phrases(group, splitter):
        """Split a group into phrases at lines where a new phrase starts."""
        out_ = []
        for i, t in group:
            if out_ and not splitter(out_[-1][-1][1], t):
                out_[-1].append((i, t))
            else:
                out_.append([(i, t)])
        return out_

    def place(group, starts_new):
        """A group spanning one anchor (or none) is one cell - it goes whole
        to its anchor / the nearest one. A group spanning several anchors is
        several cells: split into phrases, a phrase on a line with a years
        cell follows that years cell's band, the rest the nearest anchor."""
        lo, hi = group[0][0], group[-1][0]
        inside = [bi for bi in range(len(bands)) if lo <= anchors[bi] <= hi]
        if len(inside) <= 1:
            bi = inside[0] if inside else nearest_anchor((lo + hi) / 2)
            return [(bi, group)]
        placed = []
        for n, ph in enumerate(phrases(group, starts_new)):
            yb = [years_band[i] for i, _ in ph if i in years_band]
            bi = yb[0] if yb else nearest_anchor((ph[0][0] + ph[-1][0]) / 2, prefer_below=n > 0)
            placed.append((bi, ph))
        return placed

    qual_new = lambda prev, t: t[:1].isupper() and not prev.endswith(DANGLE)  # noqa: E731
    qual_gap = lambda prev, gap, t: bool(gap.get("exp")) or t[:1].islower() or prev.endswith(DANGLE)  # noqa: E731
    for g in groups("qual", qual_gap):
        for bi, ph in place(g, qual_new):
            rows[bi]["qual"].append(((ph[0][0] + ph[-1][0]) / 2, " ".join(t for _, t in ph)))
    other_new = lambda prev, t: t[:1].isupper() and not prev.endswith(DANGLE)  # noqa: E731
    other_gap = lambda prev, gap, t: True  # noqa: E731
    for g in groups("other", other_gap):
        for bi, ph in place(g, other_new):
            rows[bi]["other"].append(" ".join(t for _, t in ph))

    out, unparsed = [], []
    for (s, e, name), r in zip(bands, rows):
        exp_text = " ".join(t for _, t in r["exp"])
        quals = [q for _, q in r["qual"]]
        numeric = [(i, t) for i, t in r["exp"] if YEARS_CELL_RE.match(t)]
        alternatives = []
        if len(numeric) > 1 and len(quals) > 1:
            # one qualification per years value, by line proximity
            for i, t in numeric:
                q = min(r["qual"], key=lambda x: abs(x[0] - i))[1]
                ymin, _ = _years(t)
                alternatives.append({"qualification": q, "registration": registration_code(q), "years_text": t, "years_min": ymin})
        qualification = " / ".join(quals) if alternatives else " ".join(quals)
        other = " ".join(r["other"])
        years_text = numeric[0][1] if len(numeric) == 1 else (" / ".join(t for _, t in numeric) if alternatives else (exp_text or None))
        ymin, yunder = _years(years_text) if len(numeric) == 1 else (None, None)
        if alternatives:
            ymin = min(a["years_min"] for a in alternatives if a["years_min"] is not None) if any(a["years_min"] is not None for a in alternatives) else None
        code = next((c for c, rx in POSITION_CODES if rx.match(name)), None)
        spec = None if code else next((k for k, rx in SPECIALISTS if rx.search(name)), None)
        reg_text = f"{qualification} {other}"
        reg = "alternatives" if alternatives else (registration_code(qualification) if qualification else None)
        # "Registered Professional Surveyors ... | Member of SAGC" - the
        # body is in the other column; the qualification cell alone reads as
        # a generic registration.
        if not alternatives and (spec in ("surveyor", "quantity_surveyor", "engineering_geologist") or reg in (None, "qualification")):
            reg = registration_code(reg_text) or reg
        if not (qualification or years_text or other):
            unparsed.append(name)
            continue
        out.append({
            "position": name,
            "position_code": code,
            "specialist": spec,
            "qualification": qualification or None,
            "registration": reg,
            "bodies": [b for b, rx in BODY_RES if rx.search(reg_text)],
            "years_text": years_text,
            "years_min": ymin,
            "years_under": yunder,
            "other": other or None,
            "alternatives": alternatives,
            "quote": " | ".join(x for x in (name, qualification, years_text, other) if x)[:300],
        })
    if not out:
        return {"source": "not_found", "clause": "C3.1.11(d)", "rows": [], "unparsed": unparsed,
                "reason": "Found the table but no row had a qualification or years cell that could be read."}
    return {"source": "tender_document", "clause": "C3.1.11(d)", "rows": out, "unparsed": unparsed,
            "reason": f"{len(out)} position row(s) read from this tender's own minimum-requirements table."}


KNOWN_TITLES = [
    "project leader", "assistant project leader", "design specialist", "assistant design specialist",
    "surveyor", "quantity surveyor (qs)", "quantity surveyor", "engineering geologist", "environmental practitioner",
    "ohs specialist", "road safety audit team leader", "contract engineer", "contracts engineer",
    "assistant contract engineer", "assistant contracts engineer", "engineer's representative (re)",
    "engineer's representative", "engineer’s representative (re)", "engineer’s representative", "assistant re",
    "programmer", "senior materials technician", "materials technician", "trainee technician",
    "resident engineer", "assistant resident engineer",
]


def _is_complete_title(t):
    return t.lower() in KNOWN_TITLES


def _is_title_prefix(t):
    """Is t the start of (or the whole of) a known position title?"""
    tl = t.lower()
    return any(k.startswith(tl) for k in KNOWN_TITLES)


DANGLING_RE = re.compile(r"\b(?:assistant|senior|team|audit|safety|road|engineering|environmental|quantity|project|"
                         r"design|contracts?|materials|engineer.?s|the|of|and|&)$", re.I)


def _dangling(t):
    """An unknown title fragment that can't end there ("Assistant Contract")."""
    return bool(DANGLING_RE.search(t.strip()))


def describe_minimum(row):
    parts = [row["qualification"] or "no qualification stated"]
    y = row.get("years_text")
    if y:
        if row.get("years_under"):
            parts.append(f"under {row['years_under']} years' relevant experience")
        elif re.search(r"\d", y) and not re.search(r"[A-Za-z]", y):
            parts.append(f"{y} years' relevant experience")
        else:
            parts.append(f"experience: {y}")
    if row.get("other"):
        parts.append(row["other"])
    return ", ".join(parts)


if __name__ == "__main__":
    import json
    import subprocess
    import sys
    for path in sys.argv[1:]:
        txt = open(path, encoding="utf-8", errors="replace").read() if path.endswith(".txt") else \
            subprocess.run(["pdftotext", "-layout", path, "-"], capture_output=True, text=True).stdout
        res = extract_key_person_minimums(txt)
        print(f"== {path}: {res['source']} - {res['reason']}")
        for r in res["rows"]:
            print(f"  {r['position_code'] or r['specialist'] or '-':>28}  {r['position']!r:40} reg={r['registration']!s:14} "
                  f"years={r['years_text']!s:6} min={r['years_min']!s:4} under={r['years_under']!s:4} bodies={r['bodies']}")
            print(f"  {'':>28}  qual={r['qualification']!r}  other={r['other']!r}")
            for a in r["alternatives"]:
                print(f"  {'':>30}alt: {a}")
        if res["unparsed"]:
            print("  UNPARSED:", res["unparsed"])
        if "--json" in sys.argv:
            print(json.dumps(res, indent=1))
