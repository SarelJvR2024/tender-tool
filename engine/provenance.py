"""
Shared helper so every fill_*.py script records field-level provenance the
same way, instead of each one inventing its own ad-hoc way to say "I'm not
sure about this" (until now: scattered across module docstrings, inline
"PENDING -" strings, and separate ACTIONS_TO_SIGN.md lines). Backs Supabase's
field_provenance table (app/supabase/migrations/0002_field_provenance.sql) -
see spec item 29, docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md.

This module writes a local JSON log next to a tender's generated output,
same pattern as pack.yaml/financial_capture.yaml being local files that a
separate bridge script (seed_supabase_company.py) later loads into Supabase.

Four statuses, matching the database's check constraint exactly:
  confirmed        - a human entered or approved this value for this company.
  computed         - derived mechanically from confirmed values, no judgment call.
  assumed_default  - best available answer; nothing on file contradicts it, but
                      not independently re-verified for this specific submission.
  missing          - genuinely not available; nothing was written into the document.

assumed_default and missing REQUIRE a reason, enforced here in code (not just
in the DB column comment) - recording either status without saying why is
exactly the silent-guess problem this module exists to prevent.
"""
import json


class ProvenanceLog:
    def __init__(self, source):
        self.source = source
        self.entries = []

    def confirmed(self, field_key, value):
        self.entries.append(self._entry(field_key, "confirmed", value, None))

    def computed(self, field_key, value, reason):
        self.entries.append(self._entry(field_key, "computed", value, reason))

    def assumed_default(self, field_key, value, reason):
        if not reason:
            raise ValueError(f"assumed_default for '{field_key}' needs a reason - never record one without it")
        self.entries.append(self._entry(field_key, "assumed_default", value, reason))

    def missing(self, field_key, reason):
        if not reason:
            raise ValueError(f"missing for '{field_key}' needs a reason - never record one without it")
        self.entries.append(self._entry(field_key, "missing", None, reason))

    def _entry(self, field_key, status, value, reason):
        return {
            "field_key": field_key,
            "status": status,
            "value": None if value is None else str(value),
            "reason": reason,
            "source": self.source,
        }

    def summary(self):
        counts = {}
        for e in self.entries:
            counts[e["status"]] = counts.get(e["status"], 0) + 1
        return counts

    def save(self, path):
        with open(path, "w") as f:
            json.dump(self.entries, f, indent=2)
        return path


def merge_and_save(out_path, *logs):
    """Combines several scripts' logs (fill_a_forms + fill_docx_forms +
    fill_financial_hours, all run for the same tender) into the one file
    generate_action_checklist.py and the eventual Supabase bridge both read."""
    entries = []
    for log in logs:
        entries.extend(log.entries)
    with open(out_path, "w") as f:
        json.dump(entries, f, indent=2)
    return out_path


def load(path):
    with open(path) as f:
        return json.load(f)
