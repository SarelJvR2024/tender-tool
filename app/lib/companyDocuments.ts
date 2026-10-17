// Company-owned letters and documents (migration 0037, company_document_templates).
//
// Each company chooses, per document type, the same two-way choice the CV
// upload already offers (cv_uploads.mode "as_is" | "ai_extract"):
//   uploaded      - its own real document, used as-is every time;
//   ai_guideline  - its own wording with {{field}} marks; the engine fills the
//                   marks and changes nothing else (engine/company_documents.py).
// No row = "not set up": nothing is generated in its place - never another
// company's wording (Hardcoded-Assumptions-Audit Q7).
//
// Same list as engine/company_documents.py DOCUMENT_TYPES - keep in step.

export const DOCUMENT_TEMPLATE_MODES = ["uploaded", "ai_guideline"] as const;
export type DocumentTemplateMode = (typeof DOCUMENT_TEMPLATE_MODES)[number];

export const GUIDELINE_MAX_CHARS = 10000; // company_document_templates_guideline_length

export type CompanyDocumentType = {
  key: string;
  label: string;
  usedFor: string;
  fields: { key: string; label: string }[];
  example: string;
};

export const COMPANY_DOCUMENT_TYPES: CompanyDocumentType[] = [
  {
    key: "authority_to_sign",
    label: "Letter of authority to sign",
    usedFor:
      "SANRAL Form A2 (Certificate of Authority for Signatory), and any buyer that asks for a board resolution or letter authorising the signatory.",
    fields: [
      { key: "company_legal_name", label: "Company legal name" },
      { key: "signatory_name", label: "Signatory's name" },
      { key: "signatory_capacity", label: "Signatory's capacity / position" },
      { key: "director_name", label: "Director's name" },
      { key: "tender_reference", label: "Tender / RFP reference" },
      { key: "tender_description", label: "Tender description" },
      { key: "contract_number", label: "Contract number" },
      { key: "nra_reference", label: "SANRAL NRA reference" },
      { key: "closing_date", label: "Closing date" },
      { key: "date", label: "Today's date" },
    ],
    example: "… {{signatory_name}}, our {{signatory_capacity}}, may sign every document for tender {{tender_reference}} …",
  },
];

export function isCompanyDocumentType(v: unknown): v is string {
  return typeof v === "string" && COMPANY_DOCUMENT_TYPES.some((t) => t.key === v);
}

export function isDocumentTemplateMode(v: unknown): v is DocumentTemplateMode {
  return typeof v === "string" && (DOCUMENT_TEMPLATE_MODES as readonly string[]).includes(v);
}

/** {{field}} marks in a guideline that aren't one of this document type's fields. */
export function unknownGuidelineFields(type: CompanyDocumentType, guideline: string): string[] {
  const known = new Set(type.fields.map((f) => f.key));
  const out = new Set<string>();
  for (const m of guideline.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) {
    if (!known.has(m[1].toLowerCase())) out.add(m[1]);
  }
  return Array.from(out);
}

export type CompanyDocumentTemplateRow = {
  id: string;
  document_type: string;
  mode: DocumentTemplateMode;
  storage_path: string | null;
  original_filename: string | null;
  guideline: string | null;
  updated_at: string;
};
