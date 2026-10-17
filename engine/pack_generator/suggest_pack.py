"""
Step 2 of the pipeline (see docs/specs/tender-compilation-playbook.md), automated: reads a
downloaded SANRAL template's own SETUP sheet to find out which key positions this tender
needs, and suggests which person on file to put in each - with alternates and a plain-English
reason for every suggestion, never a silent pick.

This script NEVER decides who gets assigned. It only produces candidates for a human to
choose from. See confirm_pack.py for the step that actually builds a usable pack.yaml, which
refuses to run until a human has written a confirmed choice for every position.

Scoring is deliberately simple and fully explainable (keyword overlap + a few plain rules) -
not a black box. Every suggestion's rationale is printed in the output, including when a
candidate is a weak match, so the human reviewing it can see exactly why.

Usage:
    python3 suggest_pack.py <template.xlsm> <profile.json> <out_dir>

Writes to <out_dir>:
    pack_suggestions.json   - machine-readable, consumed by confirm_pack.py
    pack_suggestions.md     - human-readable summary to actually review
    pack_selections.yaml    - blank selection form, one confirmed_person: null per position
"""
import sys
import re
import json
import datetime
import yaml

sys.path.insert(0, __file__.rsplit("/engine/", 1)[0] + "/engine")
from sanral_fill import Workbook, n2col  # noqa: E402

STOPWORDS = {"and", "the", "of", "a", "an", "for", "to", "in", "on", "1", "2", "3"}


def _keywords(text):
    return {w for w in re.findall(r"[a-zA-Z]+", (text or "").lower()) if len(w) > 2 and w not in STOPWORDS}


def _excel_date(serial):
    return datetime.date(1899, 12, 30) + datetime.timedelta(days=int(serial))


def read_required_positions(wb):
    """SETUP row 5 = ALT marker, row 6 = position code, row 7 = description, row 8 = Man/Non-Man.
    Returns the PRIMARY (non-ALT) slots only, deduplicated by code, each with its alternate
    slot(s) noted separately - alternates are a fallback the human can also staff, not a
    second mandatory position."""
    primary, alternates = {}, {}
    for p in range(20):
        col = n2col(2 + p)
        code = wb.cached("SETUP", f"{col}6")
        if not code:
            continue
        code = str(code).strip()
        entry = {
            "code": code,
            "description": wb.cached("SETUP", f"{col}7"),
            "managerial": wb.cached("SETUP", f"{col}8"),
        }
        if str(wb.cached("SETUP", f"{col}5") or "").strip().upper() == "ALT":
            alternates.setdefault(code, []).append(entry)
        else:
            primary.setdefault(code, entry)
    return list(primary.values()), alternates


def years_experience_at(person, closing_date):
    grad = person.get("qualifications", {}).get("initial_graduated")
    if not grad:
        return None
    grad = datetime.date.fromisoformat(grad)
    return round((closing_date - grad).days / 365.25)


def candidate_person_text(person):
    """Everything about a candidate worth matching keywords against: quals + every project's
    own text fields. Deliberately excludes name/contact fields - those aren't evidence of
    relevant experience."""
    q = person.get("qualifications", {})
    parts = [q.get("highest_description", ""), q.get("initial_description", ""),
             person.get("description", "")]
    for proj in person.get("projects", []):
        parts.append(proj.get("position_held", ""))
        parts.append(proj.get("client_and_number", ""))
    return " ".join(parts)


def score_candidate(person_id, person, position, closing_date):
    pos_kw = _keywords(position["description"])
    cand_kw = _keywords(candidate_person_text(person))
    overlap = pos_kw & cand_kw
    # Words that are generic to almost every SANRAL position and don't actually discriminate
    # a specialism match (e.g. every position says "Specialist" or "Engineer").
    generic = {"specialist", "engineer", "leader", "manager", "design", "project"}
    specific_overlap = overlap - generic
    specific_miss = (pos_kw - generic) - cand_kw

    score = len(specific_overlap) * 3 + (1 if overlap & generic else 0)
    years = years_experience_at(person, closing_date)

    reasons = []
    if specific_overlap:
        reasons.append(f"matches on: {', '.join(sorted(specific_overlap))}")
    if specific_miss:
        reasons.append(f"NO evidence found of: {', '.join(sorted(specific_miss))}")
    if years is not None:
        reasons.append(f"{years} years' experience as of this tender's closing date "
                        f"(computed from {person['qualifications']['initial_graduated']}, not a stored number)")
    ecsa = person.get("qualifications", {}).get("ecsa_level")
    if ecsa:
        reasons.append(f"ECSA level on file: {ecsa}")

    return {
        "person_id": person_id,
        "name": person["name"],
        "score": score,
        "years_experience": years,
        "rationale": "; ".join(reasons) if reasons else "no matching or conflicting evidence found",
        "specialism_warning": bool(specific_miss) and not specific_overlap,
        # The same evidence as the rationale, structured, so the Tender
        # Workspace can say briefly why a person is suggested
        # (engine/pack/process_pack_jobs.py sync_position_suggestions).
        "matched": sorted(specific_overlap),
        "missing": sorted(specific_miss),
        "ecsa_level": ecsa or None,
    }


def suggest(template_path, profile_path, out_dir):
    wb = Workbook(template_path)
    profile = json.load(open(profile_path))
    people = {f"person_{i}": p for i, p in enumerate(profile["key_people"])}

    contract_no = wb.cached("SETUP", "C2")
    closing_date = _excel_date(wb.cached("SETUP", "C3"))
    positions, alternates = read_required_positions(wb)

    suggestions = {}
    for pos in positions:
        ranked = sorted(
            (score_candidate(pid, p, pos, closing_date) for pid, p in people.items()),
            key=lambda c: c["score"], reverse=True,
        )
        suggestions[pos["code"]] = {"position": pos, "candidates": ranked}

    out = {
        "contract_no": contract_no,
        "closing_date": closing_date.isoformat(),
        "generated": datetime.date.today().isoformat(),
        "positions": suggestions,
        "alternate_slots": alternates,
    }

    with open(f"{out_dir}/pack_suggestions.json", "w") as f:
        json.dump(out, f, indent=2)

    _write_markdown(out, f"{out_dir}/pack_suggestions.md")
    _write_selection_template(out, f"{out_dir}/pack_selections.yaml")
    print(f"Contract {contract_no} | closes {closing_date} | {len(positions)} position(s) to staff")
    print(f"Wrote pack_suggestions.json, pack_suggestions.md, pack_selections.yaml to {out_dir}")
    print("Nothing has been decided. A human must fill in pack_selections.yaml and run "
          "confirm_pack.py before any pack.yaml is produced.")


def _write_markdown(out, path):
    lines = [f"# Position suggestions - contract {out['contract_no']}",
             f"Closing {out['closing_date']}. Generated {out['generated']}.",
             "",
             "**Nothing here is decided.** Every candidate is a suggestion with alternates "
             "shown - a human confirms the actual choice in `pack_selections.yaml`.", ""]
    for code, data in out["positions"].items():
        pos = data["position"]
        lines.append(f"## {code} - {pos['description']} ({pos['managerial']})")
        if not data["candidates"]:
            lines.append("No candidates on file at all for this position. Cannot proceed "
                          "without at least one CV.")
        for i, c in enumerate(data["candidates"]):
            tag = "SUGGESTED" if i == 0 else f"alternate #{i}"
            warn = " ⚠ SPECIALISM NOT EVIDENCED ON FILE" if c["specialism_warning"] else ""
            lines.append(f"- **[{tag}]** {c['name']} (score {c['score']}){warn}")
            lines.append(f"  - {c['rationale']}")
        if len(data["candidates"]) <= 1:
            lines.append("  - *Only one candidate on file - this is not a real choice, "
                          "just the only option. Get another CV before treating this as settled.*")
        lines.append("")
    if out["alternate_slots"]:
        lines.append("## Alternate slots (optional, not required to staff)")
        for code, slots in out["alternate_slots"].items():
            lines.append(f"- {code}: {len(slots)} alternate slot(s) available on the template")
    with open(path, "w") as f:
        f.write("\n".join(lines))


def _write_selection_template(out, path):
    doc = {
        "contract_no": out["contract_no"],
        "confirmed_by": None,  # REQUIRED: the human's name, filled in before confirm_pack.py will run
        "confirmed_date": None,  # REQUIRED
        "selections": {
            code: {
                "suggested_person": data["candidates"][0]["person_id"] if data["candidates"] else None,
                "confirmed_person": None,  # REQUIRED: must be set to a person_id from pack_suggestions.json
            }
            for code, data in out["positions"].items()
        },
    }
    with open(path, "w") as f:
        f.write("# Fill in confirmed_by, confirmed_date, and confirmed_person for every position below.\n")
        f.write("# confirmed_person does not have to match suggested_person - override it if the\n")
        f.write("# suggestion is wrong. See pack_suggestions.md for the full rationale and alternates.\n")
        yaml.safe_dump(doc, f, sort_keys=False)


if __name__ == "__main__":
    suggest(*sys.argv[1:4])
