"""
Step 2b: turns a human-confirmed pack_selections.yaml into the actual pack.yaml that
fill_conventional.py / fill_tender.py consume. Refuses to run - loudly, not silently - if
any position lacks an explicit confirmation. This is the one gate in the whole generator:
suggest_pack.py can propose anything, but nothing reaches the fill engine without a named
human saying "yes, this person, for this position."

Usage:
    python3 confirm_pack.py <pack_suggestions.json> <pack_selections.yaml> <profile.json> <out_pack.yaml>
"""
import sys
import json
import yaml
import datetime


def confirm(suggestions_path, selections_path, profile_path, out_path):
    suggestions = json.load(open(suggestions_path))
    selections = yaml.safe_load(open(selections_path))
    profile = json.load(open(profile_path))
    people = {f"person_{i}": p for i, p in enumerate(profile["key_people"])}

    if not selections.get("confirmed_by"):
        raise ValueError("pack_selections.yaml: confirmed_by is not set. A named human must "
                          "confirm this pack - refusing to generate one anonymously.")
    if not selections.get("confirmed_date"):
        raise ValueError("pack_selections.yaml: confirmed_date is not set.")

    closing_date = datetime.date.fromisoformat(suggestions["closing_date"])
    key_persons = []
    pack_people = {}
    overrides = []

    for code, sel in selections["selections"].items():
        person_id = sel.get("confirmed_person")
        if not person_id:
            raise ValueError(f"Position {code}: confirmed_person is not set in "
                              f"pack_selections.yaml. Every required position must be "
                              f"explicitly confirmed - refusing to guess.")
        if person_id not in people:
            raise ValueError(f"Position {code}: confirmed_person '{person_id}' does not "
                              f"exist in {profile_path}'s key_people.")
        if sel.get("suggested_person") and person_id != sel["suggested_person"]:
            overrides.append((code, sel["suggested_person"], person_id))

        person = people[person_id]
        qual = dict(person["qualifications"])
        grad = qual.get("initial_graduated")
        qual["years_experience"] = (
            round((closing_date - datetime.date.fromisoformat(grad)).days / 365.25)
            if grad else None
        )
        if qual["years_experience"] is None:
            raise ValueError(f"{person['name']}: no initial_graduated date on file - "
                              f"years_experience cannot be computed, refusing to guess one.")

        projects = []
        for proj in person.get("projects", [])[:3]:
            proj = dict(proj)
            # fill_conventional.py/fill_tender.py expect "contact_number" (a single cell on
            # the Form B1.1 project row); the profile stores the richer "contact_phone"
            # (mobile + office, as actually sourced) - map it here rather than renaming the
            # profile's own field, since the profile's name is the more accurate one.
            if "contact_number" not in proj and "contact_phone" in proj:
                proj["contact_number"] = proj["contact_phone"]
            for required in ("client_type", "project_type", "position_code", "contact_number"):
                if required not in proj:
                    raise ValueError(f"{person['name']}: project '{proj.get('client_and_number')}' "
                                      f"is missing '{required}' - add it to the profile before "
                                      f"this project can be cited in a real pack.")
            projects.append(proj)

        pack_people[person_id] = {
            "name": person["name"],
            "id_number": person["id_number"],
            "description": person.get("description", ""),
            "employment": "Key Person is a full time employee of the tenderer",
            "projects": projects,
            "qualifications": qual,
        }
        key_persons.append({"position": code, "person": person_id})

    comp = profile["company"]
    pack = {
        "_provenance": {
            "generated_by": "engine/pack_generator (suggest_pack.py + confirm_pack.py)",
            "generated_date": datetime.date.today().isoformat(),
            "confirmed_by": selections["confirmed_by"],
            "confirmed_date": selections["confirmed_date"],
            "overrides": [f"{code}: suggested {s}, confirmed {c} instead" for code, s, c in overrides]
                         or "none - every position was assigned its top-suggested candidate",
        },
        "company": {
            "name": comp["legal_name"],
            "bee_level": comp["bee_level"],
            "black_ownership_pct": comp["black_ownership_pct"],
            "status": comp["status"],
            "head_office": comp.get("head_office_per_form_b3", "CHECK PROFILE - head_office not set"),
            "other_offices": comp["other_offices"],
            "ecsa_registered": comp["ecsa_registered_staff_count"],
            "sacpcmp_registered": comp["sacpcmp_registered_staff_count"],
            "total_employees": comp["total_employees"],
            "jv_share_pct": comp["typical_jv_share_pct"],
        },
        "tender": {},
        "people": pack_people,
        "key_persons": key_persons,
    }

    with open(out_path, "w") as f:
        f.write(f"# Generated {pack['_provenance']['generated_date']} by the data-pack generator.\n")
        f.write(f"# Confirmed by {pack['_provenance']['confirmed_by']} on "
                f"{pack['_provenance']['confirmed_date']}. Contract {suggestions['contract_no']}.\n")
        yaml.safe_dump(pack, f, sort_keys=False, allow_unicode=True)

    print(f"Wrote {out_path} - {len(key_persons)} position(s) confirmed by {selections['confirmed_by']}")
    if overrides:
        print(f"{len(overrides)} override(s) from the AI's suggestion:")
        for code, s, c in overrides:
            print(f"  {code}: suggested {s}, human confirmed {c} instead")


if __name__ == "__main__":
    confirm(*sys.argv[1:5])
