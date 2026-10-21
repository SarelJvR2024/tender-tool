"""
CV engine: generates a tender-specific or standard CV for one person, in one of two real
template families, with an honest requirement-matching cover page.

See docs/specs/CV-Engine-Findings.md for the evidence behind these choices - this script
does not invent a CV layout, it reproduces two real, confirmed shapes:

  sanral_keyperson - mirrors SANRAL's own real Form B1.1 (Technical/Managerial Record -
      most recent relevant projects, tabular) + Form B2.1 (Qualification and Registration
      Record), read from a real completed Klipcorp tender
      (templates/incoming/completed_sample/.../01 Forms B1-B2 Position 1.pdf).
  world_bank - the donor-funded consultant CV structure confirmed via WebSearch (see the
      findings doc for sourcing and its caveat): personal/registration header, education,
      narrative employment record, languages/countries-of-experience/other-memberships
      shown as MISSING where the people/projects schema has no such field yet - never
      fabricated.

Two independent choices, not three templates:
  --detail {summary, detailed}   - summary caps at the 3 most relevant projects (matching
                                    SANRAL's own form exactly); detailed lists every project.
  --tender <pack_suggestions.json> --position <CODE>
                                  - if given, adds the cover page: this position's stated
                                    requirements, which this CV evidences and which it
                                    doesn't, straight from suggest_pack.py's own scoring
                                    (never a new matching engine). If omitted, a standard
                                    (generic, non-tender-specific) CV is produced.

Every value placed in the document is also logged through ProvenanceLog - confirmed,
computed, assumed_default, or missing (with a reason) - same discipline as fill_a_forms.py.

Usage:
    python3 generate_cv.py <profile.json> <person_index> <out_dir> \\
        --format sanral_keyperson|world_bank --detail summary|detailed \\
        [--tender <pack_suggestions.json> --position <CODE>] \\
        [--logo <path/to/logo.png>]

<person_index> is the index into profile["key_people"], matching suggest_pack.py's own
"person_{i}" id convention, so a --position lookup lines up with the same person.
"""
import sys
import os
import re
import json
import shutil
import argparse
import datetime
import subprocess

import docx
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pack_generator"))
from provenance import ProvenanceLog  # noqa: E402
from suggest_pack import score_candidate, years_experience_at  # noqa: E402

SANRAL_MAX_PROJECTS_SUMMARY = 3  # matches Form B1.1's own stated cap exactly

# Same constant/pattern as engine/compliance/watch_deadlines.py's own SAST
# (that file's own comment has the full reasoning): a bridge worker container
# has no TZ set and runs in UTC by default, so a naive datetime.date.today()
# is one calendar day behind the real SAST date for the whole 00:00-01:59
# SAST window every day. Here that feeds years_experience_at()'s rounded
# years-of-experience figure printed on a generated CV (suggest_pack.py:
# round((closing_date - grad).days / 365.25)) - a one-day shift flips the
# rounded year count whenever a person's initial_graduated date sits near
# the rounding boundary, confirmed 2026-10-20 (same bug class as Finding 37).
SAST = datetime.timezone(datetime.timedelta(hours=2))


_XML_INVALID_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")


def _safe_text(value):
    """python-docx (via lxml) raises ValueError("All strings must be XML
    compatible...") on a control character/NULL byte - confirmed reachable
    from a realistic source: OCR'd profile text (this project's own OCR
    warnings already flag OCR as capable of misreading characters) or a
    paste with embedded control bytes. Strips them rather than letting one
    bad character fail the whole document; never called on None (every call
    site already has its own "" fallback for that)."""
    return _XML_INVALID_RE.sub("", value)


def _safe_name(raw):
    """A person's name is free text any company member can set - used almost
    raw in an output filename, `/`, `..` etc pass straight through into an
    os.path.join(out_dir, ...) call. Confirmed live 2026-10-20: a name like
    "../../../../tmp/x" writes outside out_dir entirely (CWE-22). Same
    sanitizer convention already used for uploaded filenames elsewhere in
    this project (e.g. the app's own upload actions)."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", raw.replace(" ", "_"))


# ============================================================================
# Shared helpers
# ============================================================================

def _letterhead(d, logo_path):
    if logo_path and os.path.exists(logo_path):
        p = d.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run().add_picture(logo_path, width=Inches(1.6))
        d.add_paragraph()


def _heading(d, text, size=15):
    p = d.add_paragraph(text)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True
    p.runs[0].font.size = Pt(size)
    return p


def _sub_heading(d, text):
    p = d.add_paragraph()
    r = p.add_run(text)
    r.bold = True
    r.underline = True
    return p


def _kv_table(d, rows):
    """rows: list of (label, value) pairs -> a two-column table, no borders styling fuss."""
    t = d.add_table(rows=len(rows), cols=2)
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    t.autofit = True
    for i, (label, value) in enumerate(rows):
        c0, c1 = t.rows[i].cells
        c0.text = _safe_text(label)
        c0.paragraphs[0].runs[0].bold = True
        c1.text = "" if value is None else _safe_text(str(value))
    return t


def load_person(profile_path, person_index):
    profile = json.load(open(profile_path))
    people = profile["key_people"]
    if person_index >= len(people):
        raise ValueError(f"profile only has {len(people)} key_people - index {person_index} out of range")
    return profile, people[person_index], f"person_{person_index}"


def load_tender_context(pack_suggestions_path, position_code, person_id):
    """Reuses suggest_pack.py's own stored output - never recomputes matching with new
    logic. Returns None candidate_entry (with specialism_warning True and a clear rationale)
    if this person wasn't even scored for the position, rather than silently matching the
    highest-scoring stranger."""
    data = json.load(open(pack_suggestions_path))
    if position_code not in data["positions"]:
        raise ValueError(f"Position '{position_code}' not found in {pack_suggestions_path}. "
                          f"Known positions: {list(data['positions'].keys())}")
    pos_data = data["positions"][position_code]
    candidate = next((c for c in pos_data["candidates"] if c["person_id"] == person_id), None)
    return {
        "contract_no": data["contract_no"],
        "closing_date": data["closing_date"],
        "position": pos_data["position"],
        "candidate": candidate,
    }


# ============================================================================
# Cover page (built on suggest_pack.py's own scoring - never a new matcher)
# ============================================================================

def add_cover_page(d, person, person_id, tender_ctx, log):
    pos = tender_ctx["position"]
    cand = tender_ctx["candidate"]

    _heading(d, "TENDER-SPECIFIC CV COVER PAGE", 16)
    d.add_paragraph()
    _kv_table(d, [
        ("Contract / Tender No.:", tender_ctx["contract_no"]),
        ("Closing date:", tender_ctx["closing_date"]),
        ("Position applied for:", f"{pos['code']} - {pos['description']}"),
        ("Candidate:", person["name"]),
    ])
    log.confirmed("cv_cover.contract_no", tender_ctx["contract_no"])
    log.confirmed("cv_cover.position_code", pos["code"])

    d.add_paragraph()
    _sub_heading(d, "Relevant experience for this position")
    d.add_paragraph(_safe_text(
        f"This CV highlights {person['name']}'s qualifications and project experience "
        f"relevant to the {pos['code']} - {pos['description']} position."
    ))

    if cand is None:
        # Nothing buyer-appropriate to add without a stored match for this position -
        # the generic sentence above already covers it. Full detail stays internal.
        # `cand` (= tender_ctx["candidate"]) is None in this branch by definition - the
        # reason used to interpolate `tender_ctx['candidate']!r` here, which is always
        # literally "None", rendering as the nonsensical "not present in None candidates
        # list" on every single occurrence (QA-Edge-Case-Findings.md, 2026-10-19).
        log.missing("cv_cover.position_match",
                    reason=f"{person['name']} ({person_id}) was not among the candidates "
                           f"suggest_pack.py scored for position {pos['code']} when "
                           "pack_suggestions.json was last generated.")
        d.add_paragraph()
        d.add_page_break()
        return

    if cand["specialism_warning"]:
        p = d.add_paragraph(
            "Note: this candidate's CV does not show direct evidence of this position's "
            "specific specialism requirement."
        )
        p.runs[0].bold = True
        log.assumed_default(
            "cv_cover.specialism_warning", True,
            reason="suggest_pack.py's own scoring found no specific-keyword overlap between "
                   "this position's description and this person's recorded qualifications/"
                   "projects - flagged, not hidden.",
        )
    # The underlying match score/rationale from suggest_pack.py's scoring is kept in the
    # provenance log (and remains visible to internal reviewers via the Tender Workspace and
    # pack_suggestions.json) but is never printed into this document - this file is the one
    # that goes into the actual submitted pack, and there is no internal/submission
    # distinction in the data model today to gate it behind, so it is left out entirely here.
    log.computed("cv_cover.match_rationale", cand["rationale"],
                 reason="Taken verbatim from suggest_pack.py's own stored pack_suggestions.json "
                        "for this tender and position - not recomputed here. Kept in provenance "
                        "only; not printed on the buyer-facing cover page.")
    log.confirmed("cv_cover.match_score", cand["score"])
    d.add_paragraph()
    d.add_page_break()


# ============================================================================
# Format 1: SANRAL key-person CV (Form B1.1 / B2.1 shape)
# ============================================================================

def build_sanral_keyperson(profile, person, person_id, detail, tender_ctx, logo_path, log):
    comp = profile["company"]
    d = docx.Document()
    _letterhead(d, logo_path)
    _heading(d, "KEY PERSONNEL - TECHNICAL/MANAGERIAL & QUALIFICATION RECORD")
    d.add_paragraph(
        "Candidate's Technical/Managerial Record and Qualification and Registration Record."
    ).alignment = WD_ALIGN_PARAGRAPH.CENTER

    if tender_ctx:
        add_cover_page(d, person, person_id, tender_ctx, log)

    # ---- Form B1.1 shape: personal details + project table ----
    _sub_heading(d, "FORM B1.1 - Candidate's Technical/Managerial Record")
    position_desc = (tender_ctx["position"]["description"] if tender_ctx else person.get("role", ""))
    _kv_table(d, [
        ("Name:", person["name"]),
        ("ID Number:", person.get("id_number") or "MISSING"),
        ("Position in team:", position_desc),
    ])
    log.confirmed("cv.b11.name", person["name"])
    if person.get("id_number"):
        log.confirmed("cv.b11.id_number", person["id_number"])
    else:
        log.missing("cv.b11.id_number", reason="No id_number on file for this person.")

    d.add_paragraph()
    # `person.get(key, default)` only substitutes default when the key is
    # ABSENT - a row with an explicit `"projects": null` (a real possible
    # shape, not just missing) sails through and crashes `sorted()` below.
    # `or` treats null the same as missing, matching this engine's own
    # "never guess, degrade honestly" rule rather than crashing on it.
    projects = person.get("projects") or []
    sorted_projects = sorted(projects, key=lambda p: p.get("end", "") or "", reverse=True)
    shown = sorted_projects[:SANRAL_MAX_PROJECTS_SUMMARY] if detail == "summary" else sorted_projects
    log.computed(
        "cv.b11.projects_shown", len(shown),
        reason=(f"detail=summary caps at SANRAL Form B1.1's own stated limit of "
                f"{SANRAL_MAX_PROJECTS_SUMMARY} most recent relevant projects"
                if detail == "summary" else
                f"detail=detailed lists all {len(shown)} project(s) on file, not capped"),
    )

    t = d.add_table(rows=1, cols=7)
    t.style = "Light Grid Accent 1" if "Light Grid Accent 1" in [s.name for s in d.styles] else None
    hdr = t.rows[0].cells
    for i, h in enumerate(["Client & Project No.", "Value (Rm)", "Position Held",
                            "Start", "End", "Referee", "Contact"]):
        hdr[i].text = h
        hdr[i].paragraphs[0].runs[0].bold = True
    for proj in shown:
        row = t.add_row().cells
        row[0].text = _safe_text(proj.get("client_and_number", ""))
        row[1].text = _safe_text(str(proj.get("value_rm", "")) if proj.get("value_rm") is not None else "")
        row[2].text = _safe_text(proj.get("position_held", ""))
        row[3].text = _safe_text(proj.get("start", "") or "")
        row[4].text = _safe_text(proj.get("end", "") or "")
        row[5].text = _safe_text(proj.get("contact", "") or "")
        row[6].text = _safe_text(proj.get("contact_phone", "") or "")
        # contact_match_confidence on file is free text in this profile (e.g. "CORRECTED
        # 2026-10-15 ...", "PARTIALLY CONFIRMED (updated ...) ..."), not just the DB's four
        # enum values - treat anything starting with "confirmed" (case-insensitive) as
        # confirmed, everything else as assumed_default with the real note as the reason,
        # never silently normalised into a false "confirmed".
        confidence = str(proj.get("contact_match_confidence") or "unconfirmed")
        field_key = f"cv.b11.project.{proj.get('client_and_number', '?')}"
        if confidence.strip().lower().startswith("confirmed"):
            log.confirmed(field_key, proj.get("client_and_number"))
        else:
            log.assumed_default(field_key, proj.get("client_and_number"),
                                 reason=f"contact_match_confidence on file: {confidence}")
    if not shown:
        d.add_paragraph("No project history on file for this person yet.")
        log.missing("cv.b11.projects_shown", reason="person has no projects recorded in the profile")

    d.add_paragraph()
    _sub_heading(d, "FORM B2.1 - Candidate's Qualification and Registration Record")
    q = person.get("qualifications") or {}  # None (not just missing) degrades the same way
    # A tender with no closing date on file (build_tender_ctx_from_assignment
    # passes None) or an unreadable one raised TypeError/ValueError here and
    # failed the whole CV; count experience to today instead, like a
    # standard CV, and say so in the field log.
    closing_date, as_of = datetime.datetime.now(SAST).date(), "today"
    if tender_ctx and tender_ctx.get("closing_date"):
        try:
            closing_date = datetime.date.fromisoformat(str(tender_ctx["closing_date"])[:10])
            as_of = f"the tender closing date {closing_date.isoformat()}"
        except ValueError:
            log.assumed_default("cv.b21.years_experience_as_of", closing_date.isoformat(),
                                reason=f"tender closing date on file ('{tender_ctx['closing_date']}') is not a "
                                       "valid date - years of experience counted to today")
    years = years_experience_at(person, closing_date)
    rows = [
        ("Professional registration body / level:", q.get("ecsa_level") or "MISSING"),
        ("ECSA number:", q.get("ecsa_number") or "MISSING"),
        ("ECSA registration date:", q.get("ecsa_date") or "MISSING"),
        ("SACPCMP number:", q.get("sacpcmp_number") or "Not registered / not on file"),
        # Other councils (0040), only when the person holds them - the form
        # used to show ECSA/SACPCMP only, an engineering firm's view.
        *[(f"{body} registration:", " ".join(x for x in (q.get(f"{key}_category"), q.get(f"{key}_number")) if x))
          for body, key in (("SACNASP", "sacnasp"), ("SAGC", "sagc")) if q.get(f"{key}_number")],
        ("Highest qualification:", q.get("highest_description") or "MISSING"),
        ("Highest qualification institution:", q.get("highest_institution") or "MISSING"),
        ("Highest qualification graduated:", q.get("highest_graduated") or "MISSING"),
        ("Initial qualification:", q.get("initial_description") or "MISSING"),
        ("Initial qualification institution:", q.get("initial_institution") or "MISSING"),
        ("Initial qualification graduated:", q.get("initial_graduated") or "MISSING"),
        ("Years of relevant experience:",
         f"{years} (computed as of {as_of} "
         f"from initial_graduated - never a stored static number)" if years is not None else "MISSING"),
    ]
    _kv_table(d, rows)
    for label, value in rows:
        key = "cv.b21." + label.lower().strip(":").replace(" ", "_").replace("/", "_")
        if value in ("MISSING", "Not registered / not on file"):
            log.missing(key, reason=f"No value on file for '{label.strip(':')}'")
        elif "computed as of" in str(value):
            log.computed(key, years, reason="years of experience computed from qualifications."
                         "initial_graduated relative to the tender's own closing date, per "
                         "suggest_pack.py's years_experience_at() - never stored as a static figure")
        else:
            log.confirmed(key, value)

    d.add_paragraph()
    d.add_paragraph(
        "I declare that the information provided above is true, and that the position "
        "occupied, the projects reported and the corresponding responsibilities are truly "
        "the candidate's own experience."
    )
    d.add_paragraph()
    d.add_paragraph("Signature: _____________________________        Date: _______________")
    _footer(d, comp)
    return d


# ============================================================================
# Format 2: World Bank donor-funded CV
# ============================================================================

def build_world_bank(profile, person, person_id, detail, tender_ctx, logo_path, log):
    comp = profile["company"]
    d = docx.Document()
    _letterhead(d, logo_path)
    _heading(d, "CURRICULUM VITAE (WORLD BANK FORMAT)")

    if tender_ctx:
        add_cover_page(d, person, person_id, tender_ctx, log)

    position_desc = (tender_ctx["position"]["description"] if tender_ctx else person.get("role", ""))
    rows = [
        ("1. Proposed Position:", position_desc),
        ("2. Name of Staff:", person["name"]),
        ("3. Date of Birth:", "MISSING"),
        ("4. Nationality:", "MISSING"),
        ("5. Country of Residence:", "MISSING"),
    ]
    for label, value in rows:
        if value == "MISSING":
            log.missing("cv.wb." + label.split(".")[0], reason=f"'{label.strip(': ')}' is not a field "
                        "captured in the people/projects schema yet - see findings doc section 5")
    log.confirmed("cv.wb.position", position_desc or "(standard CV - no tender position)")
    log.confirmed("cv.wb.name", person["name"])
    _kv_table(d, rows)

    d.add_paragraph()
    _sub_heading(d, "6. Membership of Professional Associations")
    q = person.get("qualifications") or {}  # None (not just missing) degrades the same way
    assoc_lines = []
    if q.get("ecsa_level"):
        assoc_lines.append(f"Engineering Council of South Africa (ECSA) - {q['ecsa_level']}, "
                            f"registration {q.get('ecsa_number', 'MISSING')}")
        log.confirmed("cv.wb.professional_associations.ecsa", q["ecsa_level"])
    if q.get("sacpcmp_number"):
        assoc_lines.append(f"SACPCMP - registration {q['sacpcmp_number']}")
        log.confirmed("cv.wb.professional_associations.sacpcmp", q["sacpcmp_number"])
    for body, key in (("SACNASP", "sacnasp"), ("SAGC", "sagc")):
        if q.get(f"{key}_number"):
            assoc_lines.append(f"{body} - {q.get(f'{key}_category') or 'registered'}, registration {q[f'{key}_number']}")
            log.confirmed(f"cv.wb.professional_associations.{key}", q[f"{key}_number"])
    if not assoc_lines:
        assoc_lines.append("MISSING")
        log.missing("cv.wb.professional_associations", reason="No ECSA/SACPCMP/SACNASP/SAGC or other "
                    "professional-body registration on file for this person.")
    d.add_paragraph(_safe_text("\n".join(assoc_lines)))

    d.add_paragraph()
    _sub_heading(d, "7. Other Training")
    d.add_paragraph("Not currently on file for this candidate.")
    log.missing("cv.wb.other_training", reason="No 'other training' field exists on the "
                "people record yet.")

    d.add_paragraph()
    _sub_heading(d, "8. Countries of Work Experience")
    d.add_paragraph("Not currently on file for this candidate.")
    log.missing("cv.wb.countries_of_experience", reason="projects table has no country field.")

    d.add_paragraph()
    _sub_heading(d, "9. Languages")
    d.add_paragraph("Not currently on file for this candidate.")
    log.missing("cv.wb.languages", reason="No language-proficiency field on the people record yet.")

    d.add_paragraph()
    _sub_heading(d, "10. Education")
    edu_rows = [
        (q.get("highest_description"), q.get("highest_institution"), q.get("highest_graduated")),
        (q.get("initial_description"), q.get("initial_institution"), q.get("initial_graduated")),
    ]
    edu_rows = [r for r in edu_rows if r[0]]
    if edu_rows:
        t = d.add_table(rows=1, cols=3)
        hdr = t.rows[0].cells
        for i, h in enumerate(["Qualification", "Institution", "Date Graduated"]):
            hdr[i].text = h
            hdr[i].paragraphs[0].runs[0].bold = True
        for desc, inst, date in edu_rows:
            row = t.add_row().cells
            row[0].text = _safe_text(desc or "")
            row[1].text = _safe_text(inst or "")
            row[2].text = _safe_text(date or "")
            log.confirmed(f"cv.wb.education.{desc}", f"{inst}, {date}")
    else:
        d.add_paragraph("MISSING")
        log.missing("cv.wb.education", reason="No qualifications on file for this person.")
    d.add_paragraph("(Diplomas/certificates to be attached as an annex, per the standard - "
                     "not retyped here.)").runs[0].italic = True

    d.add_paragraph()
    _sub_heading(d, "11. Employment Record (most recent first; relevant work only)")
    # `person.get(key, default)` only substitutes default when the key is
    # ABSENT - a row with an explicit `"projects": null` (a real possible
    # shape, not just missing) sails through and crashes `sorted()` below.
    # `or` treats null the same as missing, matching this engine's own
    # "never guess, degrade honestly" rule rather than crashing on it.
    projects = person.get("projects") or []
    sorted_projects = sorted(projects, key=lambda p: p.get("end", "") or "", reverse=True)
    shown = sorted_projects[:SANRAL_MAX_PROJECTS_SUMMARY] if detail == "summary" else sorted_projects
    log.computed("cv.wb.employment_record_count", len(shown),
                 reason=f"detail={detail}: {'capped at 3 most relevant entries' if detail == 'summary' else 'all entries on file shown'}")
    if shown:
        for proj in shown:
            d.add_paragraph(_safe_text(
                f"{proj.get('start', '?')} to {proj.get('end', '?')}  —  {proj.get('client_and_number', '')}\n"
                f"Position: {proj.get('position_held', '')}    Value: R{proj.get('value_rm', '?')}m\n"
                f"Referee: {proj.get('contact', 'MISSING')}  {proj.get('contact_phone', '')}"
            ))
    else:
        d.add_paragraph("MISSING")
        log.missing("cv.wb.employment_record", reason="No project/employment history on file.")

    d.add_paragraph()
    d.add_paragraph(
        "Certification: I, the undersigned, certify that to the best of my knowledge and "
        "belief, this CV correctly describes myself, my qualifications, and my experience."
    )
    d.add_paragraph()
    d.add_paragraph("Signature of staff member: _________________________  Date: ____________")
    d.add_paragraph(f"Day/month/year.  Full name of authorized representative of {comp['legal_name']}: "
                     f"_________________________")
    _footer(d, comp)
    return d


def _footer(d, comp):
    d.add_paragraph()
    p = d.add_paragraph(comp.get("legal_name", ""))
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].italic = True


# ============================================================================
# CLI
# ============================================================================

def generate(profile_path, person_index, out_dir, fmt, detail, tender_path=None,
             position_code=None, logo_path=None):
    os.makedirs(out_dir, exist_ok=True)
    profile, person, person_id = load_person(profile_path, int(person_index))

    tender_ctx = None
    if tender_path:
        if not position_code:
            raise ValueError("--position is required when --tender is given")
        tender_ctx = load_tender_context(tender_path, position_code, person_id)

    log = ProvenanceLog(source="engine/cv/generate_cv.py")
    builder = {"sanral_keyperson": build_sanral_keyperson, "world_bank": build_world_bank}[fmt]
    doc = builder(profile, person, person_id, detail, tender_ctx, logo_path, log)

    mode = "customized" if tender_ctx else "standard"
    base_name = f"{_safe_name(person['name'])}_{fmt}_{detail}_{mode}"
    docx_path = os.path.join(out_dir, base_name + ".docx")
    doc.save(docx_path)

    prov_path = os.path.join(out_dir, base_name + ".provenance.json")
    log.save(prov_path)

    pdf_path = _convert_to_pdf(docx_path, out_dir)

    print(f"Wrote {docx_path}")
    if pdf_path:
        print(f"Wrote {pdf_path}")
    print(f"Wrote {prov_path} - provenance summary: {log.summary()}")
    return docx_path, pdf_path, prov_path


def generate_as_is(source_path, out_dir, person_name):
    """
    The "use as-is" path (docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md,
    "Use as-is option"): a company can upload a CV and have it used exactly as
    uploaded, with zero AI interference - no re-extraction, no reformatting, not
    run through build_sanral_keyperson/build_world_bank at all. There is
    genuinely nothing to "generate" here; what this function does is the one
    real thing left to do honestly: copy the file through untouched (never
    mutate the original upload in place) and record via ProvenanceLog that this
    document was attached as-is, so the as-is path leaves the same kind of audit
    trail every other document in this project does, rather than being the one
    silent, unlogged exception.

    Returns (copied_path, provenance_path), matching generate()'s own return
    shape closely enough that a caller (process_cv_jobs.py) can treat both the
    same way.
    """
    os.makedirs(out_dir, exist_ok=True)
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"as-is source file does not exist: {source_path}")

    base_name = f"{_safe_name(person_name)}_as_is{os.path.splitext(source_path)[1]}"
    copied_path = os.path.join(out_dir, base_name)
    shutil.copyfile(source_path, copied_path)

    log = ProvenanceLog(source="engine/cv/generate_cv.py:generate_as_is")
    log.confirmed("cv.as_is.source_file", os.path.basename(source_path))
    log.confirmed("cv.as_is.mode", "as_is - uploaded file attached untouched, no AI extraction or reformatting applied")

    prov_path = os.path.join(out_dir, base_name + ".provenance.json")
    log.save(prov_path)

    print(f"Wrote {copied_path} (as-is copy, no reformatting)")
    print(f"Wrote {prov_path} - provenance summary: {log.summary()}")
    return copied_path, prov_path


def _convert_to_pdf(docx_path, out_dir):
    try:
        subprocess.run(
            ["soffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
            check=True, capture_output=True, timeout=60,
        )
        pdf_path = os.path.splitext(docx_path)[0] + ".pdf"
        return pdf_path if os.path.exists(pdf_path) else None
    except Exception as e:
        print(f"WARNING: PDF conversion failed ({e}) - .docx was still written.")
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("profile_path", nargs="?",
                     help="not used with --as-is-source (which needs only a person's name, "
                          "not their profile record - nothing is read from it)")
    ap.add_argument("person_index", type=int, nargs="?")
    ap.add_argument("out_dir")
    ap.add_argument("--format", choices=["sanral_keyperson", "world_bank"])
    ap.add_argument("--detail", choices=["summary", "detailed"])
    ap.add_argument("--tender", help="path to a pack_suggestions.json to build a "
                     "tender-customized CV with the requirement-matching cover page")
    ap.add_argument("--position", help="position code within --tender's pack_suggestions.json")
    ap.add_argument("--logo", default=None)
    ap.add_argument("--as-is-source", dest="as_is_source", default=None,
                     help="use-as-is path: a file to copy through untouched (with a provenance "
                          "record) instead of generating sanral_keyperson/world_bank at all")
    ap.add_argument("--person-name", dest="person_name", default=None,
                     help="required with --as-is-source, since no profile is read")
    args = ap.parse_args()

    if args.as_is_source:
        if not args.person_name:
            ap.error("--person-name is required with --as-is-source")
        generate_as_is(args.as_is_source, args.out_dir, args.person_name)
        return

    if not args.profile_path or args.person_index is None or not args.format or not args.detail:
        ap.error("profile_path, person_index, --format and --detail are required unless --as-is-source is given")
    generate(args.profile_path, args.person_index, args.out_dir, args.format, args.detail,
              args.tender, args.position, args.logo)


if __name__ == "__main__":
    main()
