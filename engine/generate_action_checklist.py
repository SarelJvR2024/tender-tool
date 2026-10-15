"""
Writes ACTIONS_TO_SIGN.md: the one place every remaining human action for a
tender lives, now that the filled documents themselves carry no "[DRAFT]" /
"[PENDING]" / "requires signature" hedge text (see fill_a_forms.py and
fill_docx_forms.py). Nothing here is guessed - each line maps to a specific
field this pipeline deliberately left blank and why.

Usage: python3 generate_action_checklist.py <profile.json> <out_dir> <contract_label> <extra_actions_json>

<extra_actions_json> is a JSON list of additional action strings gathered while
filling the docx forms (e.g. missing telephone/email) - passed in by run_tender.py
rather than recomputed here, so this file and the forms it describes never drift
apart.
"""
import sys
import json

STANDING_ACTIONS = [
    ("Sign every returnable schedule (A2-A23) where a Signed:/Date: line was left blank - "
     "these need a real signature, never typed text."),
    ("Form A2 (Certificate of Authority for Signatory): attach a real, signed and dated board "
     "resolution on Klipcorp's own letterhead - this form's own notes say completing the example "
     "page itself is not accepted as authorisation."),
    ("Authority letter (forms/A2_Authority_Letter.docx): get Krisun Naidoo to review and sign a "
     "printed copy - not valid until he does. Confirm whether Klipcorp's actual letterhead paper/"
     "stamp is needed, or the digital logo used here is sufficient."),
    ("Form A5 (DPIP/FPPO/FIN declaration): the identification table and known-business-interests "
     "table were left blank - the checkbox layout isn't safely automatable. Fill and sign by hand."),
    ("Form A9 (Tax Compliance): look up and insert Klipcorp's current SARS TCS PIN - none on file."),
    ("Form A12 (B-BBEE): attach a current, valid B-BBEE verification certificate or affidavit. "
     "The profile flags that the 2026 affidavit and the 2021 CSD report disagree on some details - "
     "get a fresh one rather than relying on either as-is."),
    ("Form A16 (Addenda): no addenda were found locally for this contract - re-check SANRAL's "
     "eTenders portal for anything issued after these documents were prepared, right up to closing."),
    ("Form A17 (Insurance): insert the actual Professional Indemnity, Public Liability and Third "
     "Party Liability policy numbers and cover values - none on file."),
    ("Form A18 (Bank Details): insert the real account number from the bank confirmation letter - "
     "deliberately never stored in this codebase - and attach that letter (dated within 3 months "
     "of tender closing)."),
    ("Form A19 (Current Commitments): confirm Henning's actual current project commitments with him "
     "directly - the company profile only tracks past reference projects for CV purposes, not a "
     "live commitments list, and none of the three on file are still open as of today."),
    ("Form A20 (COID): Klipcorp's COID Letter of Good Standing (no. 2020043243) expired 2022-04-30 - "
     "renew it before attaching, or the tender may be declared non-responsive."),
    ("Form A7 (CSD Registration): confirm Klipcorp's current Supplier Commodity code and Delivery "
     "Location against an up-to-date CSD report - only a 2021 report was found on file."),
    ("Forms A4, A8, A11 (debt/litigation/restricted-supplier declarations): filled with the honest "
     "answer based on everything on file (none/no), but these weren't independently re-verified "
     "against the public Treasury registers today - do that before signing, not after."),
    ("Specialism judgment call: Henning is tendered as Design Specialist 1 - Pavement and Materials "
     "on every current contract without a confirmed specialism match on file. This is a real "
     "evaluation risk, not a paperwork gap - decide whether to proceed or find a confirmed specialist "
     "before signing."),
]


def main(profile_path, out_dir, contract_label, extra_actions_json):
    extra = json.loads(extra_actions_json) if extra_actions_json else []
    lines = [
        f"# Actions to complete and sign - {contract_label}",
        "",
        "Everything the documents in this folder could be filled with real data, they were. "
        "This is what's left - things that genuinely need a human: a signature, a sworn oath, "
        "a document that has to be obtained, or a judgment call.",
        "",
    ]
    for a in extra:
        lines.append(f"- [ ] {a}")
    for a in STANDING_ACTIONS:
        lines.append(f"- [ ] {a}")
    out_path = f"{out_dir}/ACTIONS_TO_SIGN.md"
    open(out_path, "w").write("\n".join(lines) + "\n")
    print(f"Wrote {out_path} ({len(extra) + len(STANDING_ACTIONS)} items)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "[]")
