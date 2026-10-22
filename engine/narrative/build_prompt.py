"""
Pure prompt-construction for the cover-letter/methodology generator. No
network, no DB - takes a plain dict (the same "pre-assembled context" shape
process_narrative_jobs.py builds from Supabase rows) and returns the exact
strings sent to the model, plus the structured-output JSON schema.

This is the file doing the actual work of the anti-genericness promise
(Sarel, 2026-10-22: "it may NEVER generate the same or similar versions for
two companies"). The mechanical safeguard is uniqueness.py; this module is
the FIRST line of defence - grounding every section in facts that are
different for every company by construction (its own people, its own
projects, its own words), and explicitly forbidding the generic filler
language that is exactly what would make two drafts converge.
"""
import json

DEFAULT_MODEL = "claude-opus-5-5"

LENGTH_GUIDANCE = {
    "concise": "Keep it tight - roughly 300-500 words in total across all sections. Every sentence has to earn its place.",
    "standard": "A normal, complete submission document - roughly 600-1000 words in total across all sections.",
    "thorough": "A thorough, comprehensive document - roughly 1200-1800 words in total across all sections, covering the tender's requirements in real depth.",
}

DETAIL_GUIDANCE = {
    "high_level": "Keep the technical content high-level and accessible - this is about demonstrating capability and fit, not a detailed engineering specification.",
    "detailed": "Go into real detail on the approach, referencing specific methods, sequencing and the specific people/projects provided - a technical evaluator should see genuine substance, not just confidence.",
    "highly_technical": "Be highly technical and specific - name actual methods, standards, sequencing logic and risk factors relevant to this exact scope of work, as a technical specialist would write it for a technical evaluation panel.",
}

VISUAL_GUIDANCE = {
    "plain": "Write as running prose, in clearly headed sections. Bullet lists only where the content is genuinely a list (e.g. names of key people).",
    "structured": "Use clear section headings and bullet lists wherever a list of items (people, deliverables, project examples) reads better as one than as prose.",
    "visual_rich": "Use clear section headings, bullet lists for any list-shaped content, and short, punchy lead sentences at the start of each section that could work as pull-quotes or callouts.",
}


def _required_fact_lines(context):
    """The exact facts the model is given to work with - listed explicitly
    so the system prompt can forbid inventing anything beyond this list."""
    company = context["company"]
    tender = context["tender"]
    lines = [
        f"Company legal name: {company.get('legal_name') or 'not provided'}",
        f"Trading name: {company.get('csd_trading_name') or 'not provided'}",
        f"CIDB grading: {company.get('cidb_grading') or 'not provided'}",
        f"B-BBEE level: {company.get('bee_level') or 'not provided'}",
        f"Total employees: {company.get('total_employees') or 'not provided'}",
        f"ECSA-registered staff: {company.get('ecsa_registered_staff_count') or 'not provided'}",
        "",
        f"Tender: {tender.get('contract_no') or 'not provided'} - {tender.get('title') or 'not provided'}",
        f"Buyer: {tender.get('buyer') or 'not provided'}",
        f"Closing date: {tender.get('closing_date') or 'not provided'}",
    ]
    if tender.get("scope_summary"):
        lines.append(f"Scope summary: {tender['scope_summary']}")
    return "\n".join(lines)


def _key_people_lines(context):
    people = context.get("key_people") or []
    if not people:
        return "No key people were supplied for this submission - do not invent any names, qualifications or roles."
    lines = []
    for p in people:
        bits = [p.get("name") or "unnamed"]
        if p.get("role"):
            bits.append(p["role"])
        if p.get("ecsa_level") and p["ecsa_level"] != "Unregistered":
            bits.append(p["ecsa_level"])
        if p.get("highest_description"):
            bits.append(p["highest_description"])
        if p.get("years_experience") is not None:
            bits.append(f"{p['years_experience']} years' experience")
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def _experience_lines(context):
    experience = context.get("experience") or []
    if not experience:
        return "No past-project experience was supplied for this submission - do not invent or imply any past projects."
    lines = []
    for e in experience:
        bits = [e.get("project_name") or "unnamed project"]
        if e.get("client_name"):
            bits.append(f"for {e['client_name']}")
        if e.get("scope_summary"):
            bits.append(e["scope_summary"])
        if e.get("value_rm"):
            bits.append(f"R{e['value_rm']}m")
        if e.get("completion_date"):
            bits.append(f"completed {e['completion_date']}")
        if e.get("performance_rating"):
            bits.append(f"rated {e['performance_rating']}")
        lines.append("- " + ", ".join(bits))
    return "\n".join(lines)


def build_system_prompt(kind, style):
    doc_name = "cover letter" if kind == "cover_letter" else "technical methodology statement"
    length = LENGTH_GUIDANCE[style["length"]]
    detail = DETAIL_GUIDANCE[style["detail"]]
    visual = VISUAL_GUIDANCE[style["visual"]]
    return f"""You write a {doc_name} for a South African company submitting a public-sector tender. This document will be read by the buyer's own evaluation panel, and may be compared side by side against other bidders' submissions for the SAME tender.

THE SINGLE MOST IMPORTANT RULE: this document must be genuinely, verifiably specific to THIS company. Two different companies bidding on the same tender must never receive drafts that a reader could mistake for each other, or that read like the same template with names swapped. You are given this company's own real facts below - its own people, its own past projects, its own CIDB grade and B-BBEE level, and (critically) its own description of how it works in its own words. Build the document FROM those facts, not around them.

Hard rules:
- Never invent a project, a person, a qualification, a certification or a number that was not given to you. If something relevant is genuinely not provided, write around its absence rather than inventing it - do not pad the document with unfounded claims that may be checked.
- Where the company's own "how we work" text is provided, treat it as the company's own authentic voice on its approach - draw on its actual content and phrasing rather than writing a generic substitute "approach" section. Do not reduce it to a single throwaway line; let it meaningfully shape the approach/methodology section.
- Avoid generic, interchangeable filler that could apply to any company bidding on any tender ("we are committed to excellence", "our team of dedicated professionals", "we pride ourselves on quality service" and anything in that register). Every sentence should be traceable to a specific fact you were given about this company or this tender.
- Address the requester's own stated guidance for this document directly and visibly - do not ignore it in favour of a generic structure.
- {length}
- {detail}
- {visual}

Output structured JSON only: a list of sections, each with a heading and either paragraphs of prose or a bullet list (never both in the same section) - this becomes a real Word document, so keep headings short and each section focused on one idea."""


def build_user_message(context):
    kind_label = "cover letter" if context["kind"] == "cover_letter" else "technical methodology statement"
    parts = [
        f"Write the {kind_label} for this submission.",
        "",
        "=== FACTS (use these, invent nothing beyond them) ===",
        _required_fact_lines(context),
        "",
        "Key people available for this submission:",
        _key_people_lines(context),
        "",
        "Relevant past project experience:",
        _experience_lines(context),
    ]
    how_we_work = context["company"].get("how_we_work")
    if how_we_work:
        parts += [
            "",
            "The company's own description of how it works, in its own words (draw on this for the approach/voice - do not discard or trivialise it):",
            f'"""{how_we_work}"""',
        ]
    guidance = context.get("user_guidance")
    if guidance:
        parts += [
            "",
            "What the requester specifically asked to be included or emphasised in this document:",
            f'"""{guidance}"""',
        ]
    return "\n".join(parts)


def output_schema():
    return {
        "type": "object",
        "properties": {
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "kind": {"type": "string", "enum": ["prose", "bullet_list"]},
                        "paragraphs": {"type": "array", "items": {"type": "string"}},
                        "bullets": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["heading", "kind", "paragraphs", "bullets"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["sections"],
        "additionalProperties": False,
    }


def sections_to_plain_text(sections):
    """The flattened plain-text form stored as narrative_documents.generated_text
    for the uniqueness check (uniqueness.py) - headings included, since a
    near-duplicate's section structure is itself part of the signal."""
    lines = []
    for s in sections:
        lines.append(s["heading"])
        if s["kind"] == "bullet_list":
            lines.extend(f"- {b}" for b in s.get("bullets") or [])
        else:
            lines.extend(s.get("paragraphs") or [])
    return "\n".join(lines)


def build_distinctness_retry_user_message(context, previous_text):
    """Used for the one automatic regeneration pass when the first draft
    scored too similar to another company's (uniqueness.py). Deliberately
    does NOT show the model the other company's text (that would be
    leaking one tenant's content into another's generation) - only that
    its OWN first attempt read too generically and must be rewritten with
    more of its own specific facts."""
    base = build_user_message(context)
    return (base + "\n\n=== IMPORTANT ===\nYour previous draft for this exact request read too generically - "
            "too similar, in structure and phrasing, to something else written for this same tender. Rewrite it "
            "from scratch, leaning more heavily and more specifically on this company's own distinguishing facts "
            "above (its own named people, its own named projects, its own exact words in \"how we work\") so the "
            "result is unmistakably about this company and no other.\n\nYour previous draft (for reference only - "
            f"do not reuse its phrasing):\n{json.dumps(previous_text)[:4000]}")
