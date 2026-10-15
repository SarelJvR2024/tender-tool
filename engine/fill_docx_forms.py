"""
Fills the mechanical, non-judgment fields of the C.1.1.1 Form of Offer, C.1.2.3 Contract
Data, and the A18 (bank details) section of the A-Forms bundle.

Deliberately does NOT fill:
  - Any price field (PRICE OFFERED on C.1.1.1) - that's the BOQ, a business decision.
  - Any signature, date-of-signing, or witness field - these need a real human signature
    event. Signatory NAME fields are filled as an explicit [DRAFT - pending signature], never
    presented as if actually signed.
  - Witness name fields - confirmed by testing that a naive "fill every NAME (IN CAPITALS)
    field" approach wrongly inserted the signatory's own name into the WITNESS fields too.
    Fixed: only the first such field (the signatory) is filled; witness fields get an
    explicit placeholder instead, since a witness must be a different real person.
  - Form A2 (Authority of Signatory) - the template itself states in its own notes that
    submitting this example page completed "shall not be accepted as authorisation"; it
    needs a real board resolution on the company's letterhead, not this form filled in.
  - Form A12 (B-BBEE) - needs the tenderer's actual verification certificate/affidavit
    attached, not text typed into this template.

Usage:
    python3 fill_docx_forms.py <templates_dir> <profile.json> <output_dir>

<templates_dir> must contain C.1.1.1_Form_of_Offer.docx, C.1.2.3_Contract_Data.docx, and
A_Forms.docx, fetched from the real tender's Drive folder (not reconstructed from memory -
these forms vary per contract, e.g. different NRA reference numbers in the headers).
"""
import sys
import json
import docx


def fill_contract_data(src_dir, out_dir, comp, henning, key_persons):
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
            # first Telephone: is the company's own (not on file); second is the
            # representative's (Henning's mobile, which we have)
            p.add_run(henning.get("phone", "PENDING - not on file")
                      if telephone_seen == 2 else "PENDING - company telephone not on file")
            continue
        if p.text == "E-mail Address: \t":
            p.add_run("PENDING - Henning's email not on file")
            continue
        if p.text in fills:
            p.add_run(fills[p.text])

    kp_table = d.tables[1]
    for row_idx, label_substr in [(1, "Project Leader"), (3, "Design Specialist")]:
        row = kp_table.rows[row_idx]
        assert label_substr in row.cells[0].text, f"row {row_idx} label changed - check mapping"
        person = key_persons.get(row_idx)
        if person:
            row.cells[1].text = person["name"] + (" (stand-in - see note)" if row_idx != 1 else "")
            row.cells[2].text = "Permanent"

    dir_table = d.tables[2]
    dir_table.rows[1].cells[0].text = comp["director"]["name"]
    dir_table.rows[1].cells[2].text = "Director"

    d.save(f"{out_dir}/C.1.2.3_Contract_Data_FILLED.docx")


def fill_form_of_offer(src_dir, out_dir, comp, henning):
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
                p.add_run(f"  [DRAFT - pending signature] {henning['name'].upper()}")
            else:
                p.add_run("  [PENDING - needs a real witness name, not the signatory]")
        if p.text.startswith("CAPACITY: "):
            p.add_run(f"  [DRAFT - pending director authorisation] {henning['signatory_capacity']}")
    d.save(f"{out_dir}/C.1.1.1_Form_of_Offer_FILLED.docx")


def fill_bank_details(src_dir, out_dir, comp):
    d = docx.Document(f"{src_dir}/A_Forms.docx")
    targets = {
        "Name of account holder:": comp["legal_name"],
        "Account number:": "WITHHELD - see Drive source document, never put in this file",
        "Bank name:": comp["bank"]["bank_name"],
        "Branch number:": comp["bank"]["branch_code"],
    }
    for p in d.paragraphs:
        t = p.text.strip()
        if t in targets:
            p.add_run("  " + targets[t])
    d.save(f"{out_dir}/A_Forms_A18_bank_details_FILLED.docx")


def main(src_dir, profile_path, out_dir):
    profile = json.load(open(profile_path))
    comp = profile["company"]
    henning = profile["key_people"][0]
    # block_row -> (table row index) mapping, same convention as fill_conventional.py's
    # key_persons list: 37 = PL = table row 1, 137 = DS1 = table row 3
    key_persons = {1: henning, 3: henning}

    fill_contract_data(src_dir, out_dir, comp, henning, key_persons)
    fill_form_of_offer(src_dir, out_dir, comp, henning)
    fill_bank_details(src_dir, out_dir, comp)
    print(f"Wrote 3 filled docx forms to {out_dir}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
