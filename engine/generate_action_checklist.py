"""
Writes ACTIONS_TO_SIGN.md: the one place every remaining human action for a
tender lives, built from the field_provenance records fill_a_forms.py and
fill_docx_forms.py actually wrote (see provenance.py), not a separate
hand-maintained list. Before this, the same facts ("Henning's email isn't on
file", "the SBD4 answers weren't re-verified today") lived in two places -
this script's own STANDING_ACTIONS list and each filler script's inline
comments - which is exactly the "four different scripts each inventing their
own way to say I'm not sure" problem spec item 29 names. Now there is one.

Every assumed_default and missing provenance entry becomes a checklist line,
using its own `reason` text - nothing here is written twice.

Usage: python3 generate_action_checklist.py <out_dir> <contract_label> <provenance.json> [specialism_note]
"""
import sys
import json
from provenance import load

STANDING_ITEMS = [
    "Sign every returnable schedule (A2-A23) where a Signed:/Date: line was left blank - "
    "these need a real signature, never typed text.",
]


def main(out_dir, contract_label, provenance_path, specialism_note=None):
    entries = load(provenance_path)
    actionable = [e for e in entries if e["status"] in ("assumed_default", "missing")]

    lines = [
        f"# Actions to complete and sign - {contract_label}",
        "",
        "Everything the documents in this folder could be filled with real data, they were. "
        "This is what's left - things that genuinely need a human: a signature, a sworn oath, "
        "a document that has to be obtained, or a judgment call. Generated straight from this "
        "tender's own field_provenance records, not a separate hand-maintained list.",
        "",
    ]
    for e in actionable:
        label = "VERIFY" if e["status"] == "assumed_default" else "MISSING"
        lines.append(f"- [ ] **[{label}]** {e['field_key']}: {e['reason']}")
    for item in STANDING_ITEMS:
        lines.append(f"- [ ] {item}")
    if specialism_note:
        lines.append(f"- [ ] {specialism_note}")

    out_path = f"{out_dir}/ACTIONS_TO_SIGN.md"
    open(out_path, "w").write("\n".join(lines) + "\n")
    total = len(actionable) + len(STANDING_ITEMS) + (1 if specialism_note else 0)
    print(f"Wrote {out_path} ({total} items: {len(actionable)} from provenance, "
          f"{len(STANDING_ITEMS)} standing, {1 if specialism_note else 0} specialism)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
