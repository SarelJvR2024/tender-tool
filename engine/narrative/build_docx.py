"""
Renders the model's structured sections (build_prompt.output_schema()'s
shape) into a real, editable Word document - the "export to Word for
hand-editing" path Sarel asked for directly needs this to actually produce
a normal, well-formed .docx a person can open and edit, not a locked or
image-based rendering.

Color/visual preferences are applied to real paragraph/heading styles
(python-docx), never to a hardcoded template, so the same builder works for
every style combination.
"""
import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

# A small, curated set of professional theme colors - not an arbitrary
# color picker. Each is a (accent, heading_text) RGB pair; heading text is
# the accent itself (headings are bold+colored, not on a colored
# background, so there is no contrast pairing to get wrong).
COLOR_THEMES = {
    "navy": RGBColor(0x1A, 0x2E, 0x4C),
    "charcoal": RGBColor(0x33, 0x33, 0x33),
    "forest": RGBColor(0x1E, 0x4D, 0x2B),
    "burgundy": RGBColor(0x6B, 0x1E, 0x2B),
    "slate": RGBColor(0x3C, 0x4A, 0x5C),
}

DEFAULT_THEME = "navy"


def _apply_heading_style(document, color):
    style = document.styles["Heading 1"]
    style.font.color.rgb = color
    style.font.size = Pt(15)
    style.font.bold = True


def _apply_title_style(document, color):
    style = document.styles["Title"]
    style.font.color.rgb = color
    style.font.size = Pt(22)


def build_docx(
    sections,
    out_path,
    title,
    subtitle=None,
    color_theme=DEFAULT_THEME,
    visual_style="structured",
):
    """sections: list of {"heading", "kind", "paragraphs", "bullets"} dicts
    (build_prompt.output_schema()'s shape). Writes a .docx to out_path and
    returns it."""
    color = COLOR_THEMES.get(color_theme, COLOR_THEMES[DEFAULT_THEME])
    document = docx.Document()
    _apply_title_style(document, color)
    _apply_heading_style(document, color)

    title_paragraph = document.add_paragraph(title, style="Title")
    title_paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    if visual_style == "visual_rich":
        # A simple colored rule under the title - the one "visual" flourish
        # that reads as intentional design rather than clip-art, and is
        # trivial for a person to delete in Word if they don't want it.
        rule = document.add_paragraph()
        rule_run = rule.add_run("━" * 40)
        rule_run.font.color.rgb = color
        rule_run.font.size = Pt(8)
    if subtitle:
        subtitle_paragraph = document.add_paragraph(subtitle)
        subtitle_paragraph.runs[0].italic = True
        subtitle_paragraph.runs[0].font.size = Pt(11)

    for section in sections:
        document.add_heading(section["heading"], level=1)
        if section["kind"] == "bullet_list":
            for bullet in section.get("bullets") or []:
                document.add_paragraph(bullet, style="List Bullet")
        else:
            for paragraph_text in section.get("paragraphs") or []:
                document.add_paragraph(paragraph_text)

    document.save(out_path)
    return out_path
