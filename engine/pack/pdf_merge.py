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
  {"title": str, "envelope": str, "pdf": path-or-None, "omitted_reason": str-or-None}
A section with no pdf is never silently dropped: it is listed on the
contents page under "Not included" with its reason.
"""
import os
import sys
import datetime

import docx
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from pypdf import PdfReader, PdfWriter, PageObject
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


def _contents_docx(path, heading_lines, rows, omitted, notes, title="SUBMISSION PACK - CONTENTS"):
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

    d.add_paragraph()
    t = d.add_table(rows=1, cols=3)
    t.style = "Table Grid"
    hdr = t.rows[0].cells
    for c, label in zip(hdr, ("No.", "Document", "Pages")):
        c.text = label
        c.paragraphs[0].runs[0].bold = True
    current_env = None
    n = 0
    for r in rows:
        if r["envelope"] != current_env:
            current_env = r["envelope"]
            row = t.add_row().cells
            merged = row[0].merge(row[2])
            merged.text = current_env
            merged.paragraphs[0].runs[0].bold = True
        n += 1
        row = t.add_row().cells
        row[0].text = str(n)
        row[1].text = r["title"]
        row[2].text = (f"{r['start']}" if r["start"] == r["end"] else f"{r['start']}-{r['end']}")
    _set_widths(t, (0.5, 5.4, 0.9))
    for row in t.rows:
        for c in row.cells:
            for para in c.paragraphs:
                for run in para.runs:
                    run.font.size = Pt(9)

    if omitted:
        d.add_paragraph()
        p = d.add_paragraph("NOT INCLUDED IN THIS PACK - must be added before submission")
        p.runs[0].bold = True
        t2 = d.add_table(rows=1, cols=2)
        t2.style = "Table Grid"
        for c, label in zip(t2.rows[0].cells, ("Document", "Why it is missing")):
            c.text = label
            c.paragraphs[0].runs[0].bold = True
        for o in omitted:
            row = t2.add_row().cells
            row[0].text = f"{o['envelope']}: {o['title']}"
            row[1].text = o["omitted_reason"]
        _set_widths(t2, (2.8, 4.0))
        for row in t2.rows:
            for c in row.cells:
                for para in c.paragraphs:
                    for run in para.runs:
                        run.font.size = Pt(8.5)

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
                        front_count=1, stamp_label="", title="SUBMISSION PACK - CONTENTS",
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

    # The contents page lists page numbers that depend on its own length -
    # render, count, re-render until stable (normally 1 or 2 passes).
    contents_pages = 1
    contents_pdf = None
    for _ in range(4):
        rows, page = [], front_pages + contents_pages + 1
        for s in body:
            rows.append({"envelope": s["envelope"], "title": s["title"],
                         "start": page, "end": page + s["page_count"] - 1})
            page += s["page_count"]
        docx_path = os.path.join(work_dir, "00a_Contents.docx")
        _contents_docx(docx_path, heading_lines, rows, omitted, notes, title)
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
                                  "source": os.path.basename(s["pdf"])})

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
    return {
        "page_count": total,
        "contents_pages": contents_pages,
        "sections": manifest_sections,
        "omitted": [{"title": s["title"], "envelope": s["envelope"], "reason": s["omitted_reason"]}
                    for s in omitted],
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
