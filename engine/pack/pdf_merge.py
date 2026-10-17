"""
Merges an ordered list of section PDFs into one submission-pack PDF with a
contents page, a "Page X of N" stamp on every page, and PDF bookmarks.

Checked before building this (2026-10-16): nothing under engine/ merged or
ordered PDFs - print_reports.py writes one PDF per Form B report,
generate_cv.py / make_envelope_covers.py / fill_authority_letter.py each
write their own .docx (converted one at a time by soffice), and the real
completed submissions in templates/incoming/completed_sample were assembled
by hand. So this is a real gap, built here.

Libraries: only what the repo already relies on.
  - pypdf (already used to inspect SBD forms - General-Tender-Engine-Findings.md)
    for reading, merging, bookmarks and the page-number stamp. The stamp is
    a few raw PDF text operators with the built-in Helvetica font, so no new
    PDF-drawing dependency (reportlab etc.) is needed.
  - python-docx + soffice for the contents page itself, the same docx->PDF
    route every other document in this engine already takes
    (engine/cv/generate_cv.py's _convert_to_pdf, reused, not copied).

A section is a dict:
  {"title": str, "envelope": str, "pdf": path-or-None, "omitted_reason": str-or-None,
   "warning": str-or-None}
A section with no pdf is never silently dropped: it is listed on the
contents page as NOT INCLUDED with its reason.

The contents page is also the pack's CHECKLIST (Sarel, 2026-10-17: "With each
tender pack you need to create a check of whats included and the status"):
one numbered row per document the pack is meant to hold, in submission order,
each with its status -
  included          in the PDF, nothing to flag
  included_warning  in the PDF, but must be fixed before submission (e.g. the
                    vault copy has EXPIRED - it is still included, because it is
                    the copy on file and leaving it out would hide the problem,
                    but the row says so in red; see expiry_warning())
  not_included      not in the PDF, with the reason
The same rows are returned as manifest["checklist"], which the Tender
Workspace renders next to the download (app/app/tenders/[id]/pack-checklist.tsx).
"""
import os
import sys
import datetime

import docx
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from pypdf import PdfReader, PdfWriter, PageObject

RED = RGBColor(0xB9, 0x1C, 0x1C)    # Civic Navy danger
AMBER = RGBColor(0xB4, 0x53, 0x09)  # Civic Navy warning
from pypdf.generic import (
    DecodedStreamObject, DictionaryObject, NameObject, ArrayObject,
)

ENGINE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ENGINE_DIR, "cv"))
sys.path.insert(0, os.path.join(ENGINE_DIR, "pack_generator"))
sys.path.insert(0, ENGINE_DIR)
from generate_cv import _convert_to_pdf  # noqa: E402


# ---------------------------------------------------------------------------
# Page-number stamp
# ---------------------------------------------------------------------------

def _pdf_text(s):
    s = s.encode("latin-1", "replace").decode("latin-1")
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _stamp(page, text, size=8):
    """Draws `text` centred at the bottom of `page`, on a small white box so it
    stays legible over a scanned vault document."""
    page.transfer_rotation_to_content()  # normalise rotated scans so "bottom" is the visual bottom
    box = page.mediabox
    left, bottom = float(box.left), float(box.bottom)
    width = float(box.width)
    est_w = len(text) * size * 0.52  # Helvetica average glyph width; only used to centre the box
    x = left + (width - est_w) / 2
    y = bottom + 10
    ops = (
        f"q 1 g {x - 4:.2f} {y - 3:.2f} {est_w + 8:.2f} {size + 5:.2f} re f "
        f"0 g BT /PackPN {size} Tf {x:.2f} {y:.2f} Td ({_pdf_text(text)}) Tj ET Q"
    ).encode("latin-1")

    overlay = PageObject.create_blank_page(width=float(box.right), height=float(box.top))
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    })
    overlay[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/PackPN"): font}),
        NameObject("/ProcSet"): ArrayObject([NameObject("/PDF"), NameObject("/Text")]),
    })
    stream = DecodedStreamObject()
    stream.set_data(ops)
    overlay[NameObject("/Contents")] = stream
    page.merge_page(overlay)


# ---------------------------------------------------------------------------
# Expired-document warning (shared by the SANRAL and general pack builders)
# ---------------------------------------------------------------------------

def expiry_warning(expiry, closing, today=None):
    """Warning text for a dated document that is NOT valid on the closing date
    (or, with no closing date, already lapsed) - None when it is valid or the
    date is unknown. Same rule as app/lib/tenderCompliance.ts
    validityAtClosing(): valid ON the closing day counts."""
    if not expiry:
        return None
    try:
        exp = datetime.date.fromisoformat(str(expiry)[:10])
    except ValueError:
        return None
    today = today or datetime.date.today()
    try:
        close = datetime.date.fromisoformat(str(closing)[:10]) if closing else None
    except ValueError:
        close = None
    if exp < today:
        return f"EXPIRED {exp.isoformat()} - replace it with a current copy before submitting"
    if close and exp < close:
        return (f"EXPIRES {exp.isoformat()}, before the closing date ({close.isoformat()}) - "
                "replace it with a current copy before submitting")
    return None


def checklist_status(section):
    if not section.get("pdf"):
        return "not_included"
    return "included_warning" if section.get("warning") else "included"


STATUS_TEXT = {"included": "Included", "included_warning": "INCLUDED - WARNING", "not_included": "NOT INCLUDED"}


# ---------------------------------------------------------------------------
# Contents page (python-docx -> soffice, same route as every other document)
# ---------------------------------------------------------------------------

def _set_widths(table, inches):
    """LibreOffice lays a python-docx table out from its grid columns, not
    per-cell widths alone - set both, with autofit off, or the columns come
    out equal-width."""
    table.autofit = False
    for col, w in zip(table.columns, inches):
        col.width = Inches(w)
    for row in table.rows:
        for cell, w in zip(row.cells, inches):
            cell.width = Inches(w)


def _contents_docx(path, heading_lines, rows, notes, title="SUBMISSION PACK - CONTENTS AND CHECKLIST"):
    """rows: every checklist row in submission order (included and not)."""
    d = docx.Document()
    s = d.sections[0]
    s.top_margin = s.bottom_margin = Inches(0.7)
    s.left_margin = s.right_margin = Inches(0.8)

    p = d.add_paragraph(title)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True
    p.runs[0].font.size = Pt(15)
    for line in heading_lines:
        p = d.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)

    counts = {k: sum(1 for r in rows if r["status"] == k) for k in STATUS_TEXT}
    p = d.add_paragraph(
        f"Pack checklist: {len(rows)} documents - {counts['included']} included, "
        f"{counts['included_warning']} included with a WARNING, {counts['not_included']} NOT included. "
        "Every warning and every document not included must be dealt with before submission.")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.runs[0].bold = True
    p.runs[0].font.size = Pt(9)

    t = d.add_table(rows=1, cols=4)
    t.style = "Table Grid"
    hdr = t.rows[0].cells
    for c, label in zip(hdr, ("No.", "Document", "Pages", "Status")):
        c.text = label
        c.paragraphs[0].runs[0].bold = True
    current_env = None
    flagged = []  # (row cells) to colour after the font pass
    for n, r in enumerate(rows, start=1):
        if r["envelope"] != current_env:
            current_env = r["envelope"]
            row = t.add_row().cells
            merged = row[0].merge(row[3])
            merged.text = current_env
            merged.paragraphs[0].runs[0].bold = True
        row = t.add_row().cells
        row[0].text = str(n)
        row[1].text = r["title"]
        if r["status"] == "not_included":
            row[2].text = "-"
            row[3].text = f"NOT INCLUDED: {r['note']}"
        else:
            row[2].text = (f"{r['start']}" if r["start"] == r["end"] else f"{r['start']}-{r['end']}")
            row[3].text = f"INCLUDED - WARNING: {r['note']}" if r["status"] == "included_warning" else "Included"
        if r["status"] != "included":
            flagged.append((row[3], r["status"]))
    _set_widths(t, (0.4, 3.9, 0.7, 1.9))
    for row in t.rows:
        for c in row.cells:
            for para in c.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(8.5)
    for cell, status in flagged:
        for para in cell.paragraphs:
            for run in para.runs:
                run.bold = True
                run.font.color.rgb = RED if status == "included_warning" else AMBER

    if notes:
        d.add_paragraph()
    for note in notes:
        p = d.add_paragraph(note)
        p.runs[0].font.size = Pt(8.5)
        p.runs[0].italic = True
    d.save(path)


def _page_count(path):
    return len(PdfReader(path).pages)


def merge_with_contents(sections, out_pdf, work_dir, heading_lines, notes=(),
                        front_count=1, stamp_label="", title="SUBMISSION PACK - CONTENTS AND CHECKLIST",
                        pdf_title=None):
    """sections: ordered list (see module docstring). The first `front_count`
    included sections (the outer envelope cover) go before the contents page;
    everything else after it. `title` heads the contents page; one call per
    PDF, so a two-envelope submission calls this once per envelope with its
    own work_dir. Returns a manifest dict."""
    os.makedirs(work_dir, exist_ok=True)
    included = [s for s in sections if s.get("pdf")]
    omitted = [s for s in sections if not s.get("pdf")]
    for s in included:
        s["page_count"] = _page_count(s["pdf"])

    front, body = included[:front_count], included[front_count:]
    front_pages = sum(s["page_count"] for s in front)
    front_ids = {id(s) for s in front}
    # Checklist order = submission order: every section except the front
    # cover(s) printed before the contents page, omitted ones in place.
    listed = [s for s in sections if id(s) not in front_ids]

    # The contents page lists page numbers that depend on its own length -
    # render, count, re-render until stable (normally 1 or 2 passes).
    contents_pages = 1
    contents_pdf = None
    # The front cover(s) sit before the contents page but are still part of
    # the pack, so they are on the checklist too (pages 1..front_pages).
    front_rows, fpage = [], 1
    for s in front:
        front_rows.append({"envelope": s["envelope"], "title": s["title"], "status": checklist_status(s),
                           "note": s.get("warning"), "start": fpage, "end": fpage + s["page_count"] - 1})
        fpage += s["page_count"]
    for _ in range(4):
        rows, page = list(front_rows), front_pages + contents_pages + 1
        for s in listed:
            status = checklist_status(s)
            row = {"envelope": s["envelope"], "title": s["title"], "status": status,
                   "note": s.get("omitted_reason") if status == "not_included" else s.get("warning"),
                   "start": None, "end": None}
            if s.get("pdf"):
                row["start"], row["end"] = page, page + s["page_count"] - 1
                page += s["page_count"]
            rows.append(row)
        docx_path = os.path.join(work_dir, "00a_Contents.docx")
        _contents_docx(docx_path, heading_lines, rows, notes, title)
        contents_pdf = _convert_to_pdf(docx_path, work_dir)
        if not contents_pdf:
            raise RuntimeError("could not render the contents page to PDF (soffice failed)")
        actual = _page_count(contents_pdf)
        if actual == contents_pages:
            break
        contents_pages = actual
    else:
        raise RuntimeError("contents page length did not stabilise")

    writer = PdfWriter()
    manifest_sections = []
    ordered = front + [{"title": "Contents", "envelope": "Pack", "pdf": contents_pdf,
                        "page_count": contents_pages}] + body
    env_bookmarks = {}
    for s in ordered:
        start = len(writer.pages) + 1
        for pg in PdfReader(s["pdf"]).pages:
            writer.add_page(pg)
        end = len(writer.pages)
        parent = None
        if s["envelope"] not in ("Pack",):
            if s["envelope"] not in env_bookmarks:
                env_bookmarks[s["envelope"]] = writer.add_outline_item(s["envelope"], start - 1)
            parent = env_bookmarks[s["envelope"]]
        writer.add_outline_item(s["title"], start - 1, parent=parent)
        manifest_sections.append({"title": s["title"], "envelope": s["envelope"],
                                  "start_page": start, "end_page": end,
                                  "source": os.path.basename(s["pdf"]),
                                  "warning": s.get("warning")})

    total = len(writer.pages)
    prefix = f"{stamp_label} - " if stamp_label else ""
    for i, pg in enumerate(writer.pages, start=1):
        _stamp(pg, f"{prefix}Page {i} of {total}")

    writer.add_metadata({"/Title": pdf_title or f"Submission pack {stamp_label}".strip(),
                         "/Producer": "Tender Tool engine/pack",
                         "/CreationDate": datetime.datetime.now().strftime("D:%Y%m%d%H%M%S")})
    with open(out_pdf, "wb") as f:
        writer.write(f)

    # The contents rows as printed - kept in the manifest so a reader (and the
    # harness) can check the contents page against the real section offsets.
    checklist = [{"no": i, "title": r["title"], "envelope": r["envelope"], "status": r["status"],
                  "pages": (None if r["start"] is None else
                            (f"{r['start']}" if r["start"] == r["end"] else f"{r['start']}-{r['end']}")),
                  "note": r["note"]}
                 for i, r in enumerate(rows, start=1)]
    return {
        "page_count": total,
        "contents_pages": contents_pages,
        "sections": manifest_sections,
        "omitted": [{"title": s["title"], "envelope": s["envelope"], "reason": s["omitted_reason"]}
                    for s in omitted],
        # Every document the pack is meant to hold, in order, with its status -
        # numbered exactly as the printed checklist on the contents page.
        "checklist": checklist,
        "checklist_summary": {k: sum(1 for c in checklist if c["status"] == k) for k in STATUS_TEXT},
    }


def verify_pack(pdf_path, manifest):
    """Reads the merged PDF back and checks it is what the manifest says -
    not just that the merge ran without crashing. Returns a list of problems
    (empty = verified). Used by process_pack_jobs.py before a job is marked
    ready, and by admin_harness.py --pack."""
    problems = []
    reader = PdfReader(pdf_path)
    total = len(reader.pages)
    if total != manifest["page_count"]:
        problems.append(f"page count {total} != manifest {manifest['page_count']}")
    covered = sum(s["end_page"] - s["start_page"] + 1 for s in manifest["sections"])
    if covered != total:
        problems.append(f"sections cover {covered} pages, PDF has {total}")
    for i in sorted({0, total // 2, total - 1}):
        text = reader.pages[i].extract_text() or ""
        if f"Page {i + 1} of {total}" not in text:
            problems.append(f"page {i + 1}: page-number stamp not found")
    contents = next((s for s in manifest["sections"] if s["title"] == "Contents"), None)
    if not contents:
        problems.append("no contents section")
    else:
        text = " ".join((reader.pages[p - 1].extract_text() or "")
                        for p in range(contents["start_page"], contents["end_page"] + 1))
        flat = " ".join(text.split())
        for s in manifest["sections"]:
            if s["start_page"] <= contents["end_page"]:
                continue  # outer cover / the contents page itself aren't listed
            pages = (f"{s['start_page']}" if s["start_page"] == s["end_page"]
                     else f"{s['start_page']}-{s['end_page']}")
            # Long titles wrap inside the table cell; check the first words + the page range.
            head = " ".join(s["title"].split()[:3])
            if head not in flat or pages not in flat:
                problems.append(f"contents entry missing or wrong for '{s['title']}' (expected pages {pages})")
        for o in manifest["omitted"]:
            if " ".join(o["title"].split()[:3]) not in flat:
                problems.append(f"omitted item '{o['title']}' not listed on the contents page")
        checklist = manifest.get("checklist")
        if checklist is not None:
            if "Pack checklist:" not in flat:
                problems.append("checklist summary line not found on the contents page")
            n_warn = sum(1 for c in checklist if c["status"] == "included_warning")
            n_out = sum(1 for c in checklist if c["status"] == "not_included")
            if flat.count("INCLUDED - WARNING:") != n_warn:
                problems.append(f"contents page shows {flat.count('INCLUDED - WARNING:')} warning rows, "
                                f"checklist has {n_warn}")
            if flat.count("NOT INCLUDED:") != n_out:
                problems.append(f"contents page shows {flat.count('NOT INCLUDED:')} not-included rows, "
                                f"checklist has {n_out}")
    outline_titles = [o.title for o in _flatten(reader.outline)]
    for s in manifest["sections"]:
        if s["title"] not in outline_titles:
            problems.append(f"no bookmark for '{s['title']}'")
    return problems


def _flatten(outline):
    for item in outline:
        if isinstance(item, list):
            yield from _flatten(item)
        else:
            yield item
