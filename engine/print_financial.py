"""
Print a filled SANRAL Financial Submission workbook to PDF without Excel.

    python3 print_financial.py <filled financial .xlsm> <output.pdf> [<form C2.4 FIN only .pdf>]

What gets printed - the tender's own convention, not a choice made here:
Klipcorp's real completed SANRAL submission (templates/incoming/
completed_sample/"Completed tender"/"Pricing Schedule") prints each pricing
workbook as one Excel "group" PDF, and that PDF is exactly the workbook's
VISIBLE sheets in workbook order, each on its own print setup (checked on
N.007-046-2026/1F: TENDERER INPUT DATA p1-2, RRM Pricing Schedule p3-10,
CE & Other Hours p11-12, FORM C2.4 FIN p13-14 - the 23 hidden sheets are
SANRAL's own calculation sheets and are not in it).

Why not plain `soffice --convert-to pdf`: LibreOffice also prints a HIDDEN
sheet whenever it has its own print range defined, so the Conventional
workbook came out at 73 pages with SANRAL's hidden F1 Forecast / payment /
C3.9-C3.10 / ADJ-1..5 calculation sheets mixed in. Here, through the same
LibreOffice session print_reports.py already uses (its Office() and locale
profile, reused - not copied), the hidden sheets' print ranges are cleared
in memory before export; the visible sheets keep the page setup SANRAL
shipped. The workbook is opened read-only and never saved.

Form C2.4 FIN can also be written to its own PDF (`c24_pdf`): SANRAL's own
note on that sheet says it must be "printed and included in the tenderer's
technical proposal as a PDF copy" (zero points for workplan appropriateness
otherwise), and it carries hours only, no rand amounts - so the technical
pack can carry it without breaking the two-envelope pricing rule.

Same caveat as print_reports.py: LibreOffice layout is not Excel-exact and
has never been compared side by side with Excel's own print of this
workbook.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import print_reports  # noqa: E402  (needs the `uno` bridge - a LibreOffice host)


C24_SHEET = "FORM C2.4 FIN"


def export(src, out_pdf, c24_pdf=None):
    """Returns the list of sheet names printed, in order. Raises if nothing
    visible was found or LibreOffice wrote no file. With c24_pdf, also writes
    the FORM C2.4 FIN sheet alone there (left unwritten if the workbook has
    no visible sheet of that name)."""
    os.makedirs(os.path.dirname(os.path.abspath(out_pdf)), exist_ok=True)
    printed = []
    with print_reports.Office() as o:
        doc = o.desk.loadComponentFromURL("file://" + os.path.abspath(src), "_blank", 0,
                                          (print_reports.pv("Hidden", True), print_reports.pv("ReadOnly", True)))
        try:
            doc.calculateAll()
            for i in range(doc.Sheets.Count):
                sh = doc.Sheets.getByIndex(i)
                if sh.IsVisible:
                    printed.append(sh.Name)
                else:
                    sh.setPrintAreas(())  # in memory only - the file is read-only and never saved
            if not printed:
                raise RuntimeError("workbook has no visible sheet to print")
            print_reports.uno.invoke(doc, "storeToURL", (
                "file://" + os.path.abspath(out_pdf),
                (print_reports.pv("FilterName", "calc_pdf_Export"),)))
            if c24_pdf and C24_SHEET in printed:
                # Same in-memory trick, narrowed to the one sheet: every other
                # sheet hidden, with no print range of its own.
                c24 = doc.Sheets.getByName(C24_SHEET)
                doc.CurrentController.setActiveSheet(c24)
                for name in printed:
                    if name != C24_SHEET:
                        other = doc.Sheets.getByName(name)
                        other.setPrintAreas(())
                        other.IsVisible = False
                os.makedirs(os.path.dirname(os.path.abspath(c24_pdf)), exist_ok=True)
                print_reports.uno.invoke(doc, "storeToURL", (
                    "file://" + os.path.abspath(c24_pdf),
                    (print_reports.pv("FilterName", "calc_pdf_Export"),)))
        finally:
            doc.close(True)
    if not os.path.exists(out_pdf) or os.path.getsize(out_pdf) == 0:
        raise RuntimeError("LibreOffice wrote no PDF for the Financial workbook")
    return printed


if __name__ == "__main__":
    sheets = export(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
    from pypdf import PdfReader
    print(f"{len(PdfReader(sys.argv[2]).pages)} pages from {len(sheets)} visible sheets: {', '.join(sheets)}")
