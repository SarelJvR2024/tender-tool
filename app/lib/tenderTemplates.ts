// A SANRAL tender's blank templates (tender_documents, 0001; uploads 0025;
// each company's upload is its own copy since 0045).
// The categories are tender_documents.doc_type's own check constraint - the
// exact set engine/pack/process_pack_jobs.py downloads (technical_xlsm,
// financial_xlsm, and FORM_FILES' three .docx forms). The general engine's
// requirements.py categories (SBD/MBD forms, buyer forms) don't apply here:
// a SANRAL pack is filled from these five files and nothing else.

export const TENDER_TEMPLATE_BUCKET = "tender-documents";

export const TENDER_TEMPLATES = {
  technical_xlsm: {
    label: "Technical Submission workbook",
    hint: "\"... Technical Submission.xlsm\" - its SETUP sheet lists the key positions",
    extension: "xlsm",
    required: true,
  },
  financial_xlsm: {
    label: "Financial Submission workbook",
    hint: "\"... Financial Submission.xlsm\" - optional; without it Envelope 2 has no workbook print",
    extension: "xlsm",
    required: false,
  },
  a_forms: { label: "A-Forms", hint: "\"... A Forms.docx\"", extension: "docx", required: true },
  c111_form_of_offer: {
    label: "C.1.1.1 Form of Offer and Acceptance",
    hint: "\"... C.1.1.1-Form of Offer.docx\"",
    extension: "docx",
    required: true,
  },
  c123_contract_data: {
    label: "C.1.2.3 Contract Data",
    hint: "\"... C.1.2.3-Contract data.docx\"",
    extension: "docx",
    required: true,
  },
} as const;

export type TenderTemplateType = keyof typeof TENDER_TEMPLATES;

export const TENDER_TEMPLATE_ORDER = Object.keys(TENDER_TEMPLATES) as TenderTemplateType[];

export function isTenderTemplateType(v: string | null): v is TenderTemplateType {
  return !!v && Object.prototype.hasOwnProperty.call(TENDER_TEMPLATES, v);
}
