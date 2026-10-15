"""
Runs the full docx-forms pipeline for one tender: C.1.1.1 + C.1.2.3
(fill_docx_forms), the full A-Forms bundle A2-A23 (fill_a_forms), and the
ACTIONS_TO_SIGN.md checklist that carries everything those two scripts left
blank on purpose. One call, one place the three outputs stay in sync.

Usage: python3 run_forms_pipeline.py <forms_templates_dir> <profile.json> <out_dir> <contract_label> <nra_ref>
"""
import sys
import json
import fill_docx_forms
import fill_a_forms
import generate_action_checklist


def main(templates_dir, profile_path, out_dir, contract_label, nra_ref):
    actions = fill_docx_forms.main(templates_dir, profile_path, out_dir)
    fill_a_forms.main(f"{templates_dir}/A_Forms.docx", profile_path, out_dir, contract_label, nra_ref)
    generate_action_checklist.main(profile_path, out_dir, contract_label, json.dumps(actions))


if __name__ == "__main__":
    main(*sys.argv[1:6])
