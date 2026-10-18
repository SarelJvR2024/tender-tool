"""
SANRAL Form B7 - "Subcontracting to Targeted Enterprises" - when it applies,
what the company must answer, and how it is written into the Technical
Submission workbook (TEND 1X rows 3901-3951, identical in the Conventional
and RRM template families).

Closes Tender-Regulatory-Compliance-Review.md gap G3. Sarel (2026-10-17):
"B7 must be answered by the company" - so nothing here ever invents a
Targeted Enterprise, a percentage or a waiver. The plan comes from the
company's own capture on the Tender Workspace (migration
tender_subcontracting_plans); this module only decides whether it is
needed, checks it, and writes it.

WHEN B7 APPLIES (evidence, not assumption)
------------------------------------------
SANRAL's Interim Preferential Procurement Policy (Annexure 3, consultants)
makes 30% subcontracting to Targeted Enterprises a contractual obligation by
contract-value category and the MAIN TENDERER'S size:

    Category 1 (< R6m):     EME no,  QSE yes, Generic yes
    Category 2 (R6m-R25m):  EME no,  QSE no,  Generic yes
    Category 3 (> R25m):    EME yes, QSE yes, Generic yes

The contract value itself is never captured by the product (no column, no
OCDS value used) - and does not need to be: SANRAL writes the CATEGORY into
every Technical Submission workbook it issues (SETUP!L1 "App. D Category of
Tender", 1/2/3), with the policy matrix above as a lookup table on the same
sheet (SETUP!J27:L35) and its own formula (SETUP!K38) applying it to the
tenderer's size (TEND 1X!H34). Verified on all six committed samples
(R.334 category 2; R.343, R.352-020, R.352-030, R.394, R.396 category 3), on
the live N.011-010-2027/1F (category 3, Book 1: "Minimum sub-contracting
requirement for all Entities is 30%") and on Klipcorp's own real RRM
submission (category 1, QSE -> B7 completed with 30%). read_setup() reads the
category AND the matrix from the template itself, so a SANRAL change to the
table is followed, not overridden.

The tender's own Book 1 can still waive it: R.396-010-2025/1F's Book 1
Form B7 page says "No sub-contracting requirement for all Entities and
submission of form B7 is not required for this project" although its
workbook says category 3 / "Subcontracting Compulsary: YES". Book 1 isn't
uploaded to the product (only the submission templates are), so the
company records that waiver itself, quoting the Book 1 text - an explicit,
attributed answer, never a silent skip.

If the category can't be read (workbook not uploaded/read yet) or the
company's size (companies.status) isn't EME/QSE/Generic, the answer is
"unknown" and B7 is treated as REQUIRED until the company answers: ask,
don't skip.
"""

CATEGORY_BANDS = {1: "under R6 million", 2: "R6 million to R25 million", 3: "over R25 million"}
SIZES = ("EME", "QSE", "GENERIC")
TE_SIZES = ("EME", "QSE")  # a Targeted Enterprise is an EME or QSE (BEP) - Books 2&3 Clause 1 Definitions
MAX_TES = 4                # the template's own "Number of Targeted Enterprise" dropdown: None, 1..4
POLICY_MIN_PCT = 30        # Policy Annexure 3 / Contract Data 11.8 ("minimum of 30%")
TBC_NAME = "To be identified after tender award"

SHEET = "TEND 1X"
TE_ROWS = (3906, 3914, 3922, 3930)  # first row of each Targeted Enterprise block (+8 per block)
COUNT_CELL = "D3904"                # form-control dropdown: 'None', '1 Targeted Enterprise', ...
COMMENTS_CELL = "B3940"


def normalise_size(status):
    s = str(status or "").strip().upper()
    return s if s in SIZES else None


def read_setup(wb):
    """{category, compulsory, required_by_size} from the template's own SETUP
    sheet. category None when SETUP!L1 isn't 1/2/3; required_by_size only
    holds the sizes the matrix lists for that category."""
    raw = wb.cached("SETUP", "L1")
    try:
        category = int(raw)
    except (TypeError, ValueError):
        category = None
    if category not in CATEGORY_BANDS:
        category = None
    compulsory = str(wb.cached("SETUP", "L2") or "").strip().upper() or None
    required_by_size = {}
    for r in range(27, 36):
        try:
            cat = int(wb.cached("SETUP", f"J{r}"))
        except (TypeError, ValueError):
            continue
        size = normalise_size(wb.cached("SETUP", f"K{r}"))
        ans = str(wb.cached("SETUP", f"L{r}") or "").strip().upper()
        if cat == category and size and ans in ("YES", "NO"):
            required_by_size[size] = ans == "YES"
    return {"category": category, "compulsory": compulsory, "required_by_size": required_by_size}


def applicability(setup, company_status, plan=None):
    """Whether Form B7 must be answered for this tender and this company.

    Returns {"status", "needs_plan", "reason"}:
      waived        - the company recorded the tender's own Book 1 waiver (quoted)
      not_required  - category + size known, SANRAL's matrix says no subcontracting
      required      - matrix says yes
      unknown       - category or size not known: treated as required (ask)
    """
    if plan and plan.get("mode") == "waived_by_tender":
        quote = " ".join(str(plan.get("waiver_quote") or "").split())
        return {"status": "waived", "needs_plan": False,
                "reason": "this tender's own Book 1 (Form B7 page) says B7 is not required - recorded by your company"
                          + (f": \"{quote}\"" if quote else "")}
    category = (setup or {}).get("category")
    size = normalise_size(company_status)
    if category is None:
        return {"status": "unknown", "needs_plan": True,
                "reason": "the tender's category (contract-value band) hasn't been read from its Technical "
                          "workbook yet, so B7 is treated as required until you answer it"}
    band = CATEGORY_BANDS[category]
    if size is None:
        return {"status": "unknown", "needs_plan": True,
                "reason": f"Category {category} tender ({band}); your company's size (EME / QSE / Generic) isn't "
                          "recorded on the Company page, so B7 is treated as required until you answer it"}
    rule = (setup or {}).get("required_by_size", {}).get(size)
    if rule is None:
        return {"status": "unknown", "needs_plan": True,
                "reason": f"Category {category} tender ({band}); this template's SETUP table has no row for a "
                          f"{size} tenderer, so B7 is treated as required until you answer it"}
    if rule:
        return {"status": "required", "needs_plan": True,
                "reason": f"Category {category} tender ({band}) and your company's size is {size}: SANRAL's policy "
                          f"makes subcontracting at least {POLICY_MIN_PCT}% to Targeted Enterprises a contract "
                          "condition (table on this template's SETUP sheet)"}
    return {"status": "not_required", "needs_plan": False,
            "reason": f"not required - Category {category} tender ({band}) and your company's size is {size}: SANRAL's "
                      "policy asks no subcontracting (table on this template's SETUP sheet)"}


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def check_plan(plan, applies=None):
    """(errors, warnings) for a captured plan. Errors block the pack (the form
    would be filled wrongly); warnings are listed on the pack and the
    Workspace. `applies` is applicability()'s result, for the 30% check."""
    errors, warnings = [], []
    if not plan:
        return ["no subcontracting plan captured"], warnings
    mode = plan.get("mode")
    if mode == "waived_by_tender":
        if not str(plan.get("waiver_quote") or "").strip():
            errors.append("quote the tender's own Book 1 text that says Form B7 is not required")
        return errors, warnings
    if mode != "subcontract":
        return [f"unknown plan type '{mode}'"], warnings
    tes = plan.get("targeted_enterprises") or []
    if not tes:
        errors.append("add at least one Targeted Enterprise")
    if len(tes) > MAX_TES:
        errors.append(f"SANRAL's Form B7 holds at most {MAX_TES} Targeted Enterprises")
    total = local = 0.0
    for i, te in enumerate(tes[:MAX_TES], 1):
        who = (te.get("name") or "").strip() or f"Targeted Enterprise {i}"
        if not te.get("to_be_identified") and not (te.get("name") or "").strip():
            errors.append(f"Targeted Enterprise {i}: give its name, or mark it as to be identified after award")
        if str(te.get("size") or "").upper() not in TE_SIZES:
            errors.append(f"{who}: state whether it is an EME or a QSE")
        for key, label in (("pct_of_contract", "% of contract price"),
                           ("pct_excl_provisional", "% of contract price excluding provisional sums"),
                           ("black_ownership_pct", "% black ownership")):
            v = _num(te.get(key))
            if v is None or v < 0 or v > 100 or (key != "black_ownership_pct" and v == 0):
                errors.append(f"{who}: {label} must be a percentage" + (" above 0" if key != "black_ownership_pct" else ""))
        lvl = te.get("bee_level")
        if isinstance(lvl, float) and lvl.is_integer():
            lvl = int(lvl)
        if not isinstance(lvl, int) or isinstance(lvl, bool) or not 1 <= lvl <= 8:
            errors.append(f"{who}: B-BBEE status level must be 1 to 8")
        pct = _num(te.get("pct_excl_provisional")) or 0.0
        total += pct
        if str(te.get("in_project_province") or "").upper() == "YES":
            local += pct
        bo = _num(te.get("black_ownership_pct"))
        if (bo is not None and bo < 51) or (isinstance(lvl, int) and lvl > 2):
            warnings.append(f"{who}: a Targeted Enterprise must be at least 51% black owned with B-BBEE level 1 or 2 "
                            "(Conditions of Contract, Clause 1 Definitions) - this one doesn't meet that")
        if te.get("to_be_identified"):
            warnings.append(f"Targeted Enterprise {i} is not named yet (\"{TBC_NAME}\") - SANRAL asks for a duplicate "
                            "Form B7 signed by both you and each Targeted Enterprise")
        if not str(te.get("in_project_province") or "").strip():
            warnings.append(f"{who}: \"Is the TE based in the province of the project?\" not answered - the form's "
                            "local sub-target then counts it as 0%")
    if tes and (applies or {}).get("needs_plan") and total < POLICY_MIN_PCT:
        warnings.append(f"Targeted Enterprises total {total:g}% of the contract price (excl. provisional sums) - below "
                        f"SANRAL's {POLICY_MIN_PCT}% minimum; the form will show NOT ACCEPTABLE")
    if tes and total > 0 and local < total / 3:
        warnings.append(f"Local Targeted Enterprises (based in the project's province) carry {local:g}% of {total:g}% - "
                        "SANRAL encourages at least a third")
    return errors, warnings


def fill_b7(wb, plan, log=None):
    """Writes a 'subcontract' plan into Form B7. Percentages are stored as
    fractions (the cells are formatted 0%; Klipcorp's real filled workbook
    holds 0.3 for 30% and 1 for 100% black ownership). Refuses an invalid
    plan rather than writing half a form."""
    errors, _ = check_plan(plan)
    if errors:
        raise ValueError("Form B7 subcontracting plan can't be filled: " + "; ".join(errors))
    if plan.get("mode") != "subcontract":
        return 0
    tes = plan["targeted_enterprises"]
    wb.set_dropdown(SHEET, COUNT_CELL, f"{len(tes)} Targeted Enterprise")
    frac = lambda v: round(float(v) / 100.0, 6)
    yn = lambda v: (str(v).strip().upper() if str(v or "").strip().upper() in ("YES", "NO") else None)
    for te, r in zip(tes, TE_ROWS):
        name = TBC_NAME if te.get("to_be_identified") else te["name"].strip()
        wb.set_value(SHEET, f"C{r}", name)
        wb.set_value(SHEET, f"J{r}", str(te["size"]).upper())
        wb.set_value(SHEET, f"M{r}", frac(te["pct_of_contract"]))
        wb.set_value(SHEET, f"D{r + 2}", frac(te["black_ownership_pct"]))
        wb.set_value(SHEET, f"H{r + 2}", int(te["bee_level"]))
        wb.set_value(SHEET, f"M{r + 2}", frac(te["pct_excl_provisional"]))
        wb.set_value(SHEET, f"C{r + 4}", (te.get("head_office") or "").strip() or None)
        wb.set_value(SHEET, f"G{r + 4}", yn(te.get("in_project_province")))
        wb.set_value(SHEET, f"J{r + 4}", yn(te.get("consulting_engineering_firm")))
        wb.set_value(SHEET, f"M{r + 4}", (te.get("tax_reference") or "").strip() or None)
    if (plan.get("comments") or "").strip():
        wb.set_value(SHEET, COMMENTS_CELL, plan["comments"].strip())
    return len(tes)


if __name__ == "__main__":
    # Self-check of the rules against the policy table (no workbook needed).
    setup3 = {"category": 3, "required_by_size": {"EME": True, "QSE": True, "GENERIC": True}}
    setup2 = {"category": 2, "required_by_size": {"EME": False, "QSE": False, "GENERIC": True}}
    setup1 = {"category": 1, "required_by_size": {"EME": False, "QSE": True, "GENERIC": True}}
    assert applicability(setup3, "EME")["status"] == "required"
    assert applicability(setup2, "QSE")["status"] == "not_required"
    assert applicability(setup2, "Generic")["status"] == "required"
    assert applicability(setup1, "QSE")["status"] == "required"
    assert applicability(setup1, "EME")["status"] == "not_required"
    assert applicability(None, "QSE")["status"] == "unknown"
    assert applicability(setup3, None)["status"] == "unknown"
    assert applicability(setup3, "QSE", {"mode": "waived_by_tender", "waiver_quote": "x"})["status"] == "waived"
    te = {"name": "A", "size": "EME", "pct_of_contract": 30, "pct_excl_provisional": 30,
          "black_ownership_pct": 100, "bee_level": 1, "in_project_province": "YES"}
    assert check_plan({"mode": "subcontract", "targeted_enterprises": [te]}, {"needs_plan": True}) == ([], [])
    e, w = check_plan({"mode": "subcontract", "targeted_enterprises": [dict(te, pct_excl_provisional=20)]},
                      {"needs_plan": True})
    assert not e and any("below" in x for x in w)
    assert check_plan({"mode": "subcontract", "targeted_enterprises": []})[0]
    assert check_plan({"mode": "waived_by_tender", "waiver_quote": " "})[0]
    print("sanral_b7 self-check OK")
