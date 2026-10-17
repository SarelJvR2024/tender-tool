"""
Runs the full docx-forms pipeline for one tender: C.1.1.1 + C.1.2.3
(fill_docx_forms), the full A-Forms bundle A2-A23 (fill_a_forms), and the
ACTIONS_TO_SIGN.md checklist that carries everything those two scripts left
blank on purpose. One call, one place the outputs stay in sync - including
the field_provenance.json both fillers write to, merged here into one file
(see provenance.py) that the checklist is generated FROM, not alongside.

Usage: python3 run_forms_pipeline.py <forms_templates_dir> <profile.json> <out_dir> <contract_label> <nra_ref> [pack.yaml]
"""
import sys
import json
import fill_docx_forms
import fill_a_forms
import generate_action_checklist
from provenance import merge_and_save


def specialism_note_from_pack(pack_path):
    """specialism_warning lives in pack_suggestions.json (per-candidate, alongside the
    AI's rationale - see suggest_pack.py), not in the confirmed pack.yaml, which only
    records which candidate was picked. Mirrors the Supabase schema's own split:
    tender_pack_assignments.specialism_warning is a per-position suggestion fact,
    separate from confirmed_person_id."""
    import yaml
    pack = yaml.safe_load(open(pack_path))
    suggestions_path = pack_path.replace("pack.yaml", "pack_suggestions.json")
    try:
        suggestions = json.load(open(suggestions_path))
    except FileNotFoundError:
        return None

    confirmed_person = {kp["position"]: kp["person"] for kp in pack.get("key_persons", [])}
    warned = []
    for position, data in suggestions.get("positions", {}).items():
        confirmed = confirmed_person.get(position)
        for cand in data.get("candidates", []):
            if cand["person_id"] == confirmed and cand.get("specialism_warning"):
                warned.append((position, cand["name"]))
    if not warned:
        return None
    detail = "; ".join(f"{pos} ({name})" for pos, name in warned)
    return (f"Specialism judgment call: {detail} assigned without a confirmed specialism match "
            "on file. This is a real evaluation risk, not a paperwork gap - decide whether to "
            "proceed or find a confirmed specialist before signing.")


def main(templates_dir, profile_path, out_dir, contract_label, nra_ref, pack_path=None):
    docx_provenance = f"{out_dir}/_docx_forms_provenance.json"
    a_forms_provenance = f"{out_dir}/_a_forms_provenance.json"
    merged_provenance = f"{out_dir}/field_provenance.json"

    docx_log = fill_docx_forms.main(templates_dir, profile_path, out_dir, docx_provenance, pack_path)
    _, a_forms_log = fill_a_forms.main(
        f"{templates_dir}/A_Forms.docx", profile_path, out_dir, contract_label, nra_ref, a_forms_provenance
    )
    merge_and_save(merged_provenance, docx_log, a_forms_log)

    specialism_note = specialism_note_from_pack(pack_path) if pack_path else None
    generate_action_checklist.main(out_dir, contract_label, merged_provenance, specialism_note)


if __name__ == "__main__":
    main(*sys.argv[1:7])
