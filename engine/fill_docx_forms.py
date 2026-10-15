"""
Fills the mechanical, non-judgment fields of the C.1.1.1 Form of Offer and the
C.1.2.3 Contract Data form. The A-Forms bundle (A2-A23, including A18 bank
details) is handled separately by fill_a_forms.py.

Every field filled here is filled with a real, final value - never a bracketed
"[DRAFT]"/"[PENDING]" placeholder typed into the document itself (that reads as
the tenderer not having finished their own paperwork, in a document SANRAL will
actually receive). A field we genuinely don't have data for, or that needs a
real human act, is left blank exactly as the template already has it, and
listed instead on the ACTIONS_TO_SIGN.md checklist this pipeline writes
alongside the filled documents - see fill_a_forms.py's module docstring for why
that split exists.

Deliberately does NOT fill:
  - Any price field (PRICE OFFERED on C.1.1.1) - that's the BOQ, a business decision.
  - Any signature, date-of-signing, or witness field - these need a real human signature
    event, never text. Witness fields specifically are left blank rather than filled
    with the signatory's own name (confirmed by testing: a naive "fill every NAME
    (IN CAPITALS) field" approach wrongly duplicated the signatory into the WITNESS
    field too - a witness must be a different real person, never fabricated).
  - Form A2 (Authority of Signatory) - the template itself states in its own notes that
    submitting this example page completed "shall not be accepted as authorisation"; it
    needs a real board resolution on the company's letterhead, not this form filled in.
  - Form A12 (B-BBEE) - needs the tenderer's actual verification certificate/affidavit
    attached, not text typed into this template.

Usage:
    python3 fill_docx_forms.py <templates_dir> <profile.json> <output_dir>

<templates_dir> must contain C.1.1.1_Form_of_Offer.docx and C.1.2.3_Contract_Data.docx,
fetched from the real tender's Drive folder (not reconstructed from memory - these
forms vary per contract, e.g. different NRA reference numbers in the headers).
"""
import sys
import json
import docx


def fill_contract_data(src_dir, out_dir, comp, henning, key_persons, actions):
    d = docx.Document(f"{src_dir}/C.1.2.3_Contract_Data.docx")
    cell = d.tables[0].rows[0].cells[0]

    fills = {
        "The Service Provider is \t": comp["legal_name"],
        "Address: \t": comp["registered_address"],
        "Name: \t": henning["name"] + f" ({henning['signatory_capacity']})",
    }
    telephone_seen = 0
    for p in cell.paragraphs:
        if p.text.startswith("……………"):
            # this dotted line IS the postal-address blank, not a label to append after
            p.runs[0].text = comp["postal_address"]
            for r in p.runs[1:]:
                r.text = ""
            continue
        if p.text == "Telephone: \t":
            telephone_seen += 1
            if telephone_seen == 2 and henning.get("phone"):
                p.add_run(henning["phone"])
            elif telephone_seen == 2:
                actions.append("C.1.2.3 Contract Data: insert Henning's telephone number (none on file)")
            else:
                actions.append("C.1.2.3 Contract Data: insert Klipcorp's company telephone number (none on file)")
            continue
        if p.text == "E-mail Address: \t":
            actions.append("C.1.2.3 Contract Data: insert Henning's email address (none on file)")
            continue
        if p.text in fills:
            p.add_run(fills[p.text])

    kp_table = d.tables[1]
    for row_idx, label_substr in [(1, "Project Leader"), (3, "Design Specialist")]:
        row = kp_table.rows[row_idx]
        assert label_substr in row.cells[0].text, f"row {row_idx} label changed - check mapping"
        person = key_persons.get(row_idx)
        if person:
            row.cells[1].text = person["name"]
            row.cells[2].text = "Permanent"

    dir_table = d.tables[2]
    dir_table.rows[1].cells[0].text = comp["director"]["name"]
    dir_table.rows[1].cells[2].text = "Director"

    d.save(f"{out_dir}/C.1.2.3_Contract_Data_FILLED.docx")


def fill_form_of_offer(src_dir, out_dir, comp, henning, actions):
    d = docx.Document(f"{src_dir}/C.1.1.1_Form_of_Offer.docx")
    name_in_caps_count = 0
    for p in d.paragraphs:
        if p.text.startswith("I/we claim the following B-BBEE contributor status level"):
            for r in p.runs:
                if ".........." in r.text:
                    r.text = r.text.replace("..........", f" {comp['bee_level']} ", 1)
        if p.text.startswith("NAME AND ADDRESS OF ORGANISATION:"):
            p.add_run(f"  {comp['legal_name']}, {comp['registered_address']}")
        if p.text.startswith("NAME (IN CAPITALS): "):
            name_in_caps_count += 1
            if name_in_caps_count == 1:
                p.add_run(f"  {henning['name'].upper()}")
            # witness field (2nd+ occurrence) stays blank - a witness must be a real,
            # different person; see module docstring.
        if p.text.startswith("CAPACITY: "):
            p.add_run(f"  {henning['signatory_capacity']}")
    d.save(f"{out_dir}/C.1.1.1_Form_of_Offer_FILLED.docx")
    actions.append("C.1.1.1 Form of Offer: get a witness to sign and print their name (must be a different person from the signatory)")


def main(src_dir, profile_path, out_dir):
    profile = json.load(open(profile_path))
    comp = profile["company"]
    henning = profile["key_people"][0]
    # block_row -> (table row index) mapping, same convention as fill_conventional.py's
    # key_persons list: 37 = PL = table row 1, 137 = DS1 = table row 3
    key_persons = {1: henning, 3: henning}
    actions = []

    fill_contract_data(src_dir, out_dir, comp, henning, key_persons, actions)
    fill_form_of_offer(src_dir, out_dir, comp, henning, actions)
    print(f"Wrote 2 filled docx forms to {out_dir}")
    return actions


if __name__ == "__main__":
    main(*sys.argv[1:4])
