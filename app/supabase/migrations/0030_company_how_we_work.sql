-- Company voice: a "how we work" profile, in the company's own words.
--
-- Spec: docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md, "No AI-drafted
-- narrative sections - and why: company voice, not AI blabber (Sarel,
-- 2026-10-17)". AI-drafted executive summaries/methodology were cut from scope
-- because they make every tenant's submission look the same. What replaces
-- them is this field: the company describes itself and its own approach once,
-- and any engine that produces company-facing prose reads it from here.
--
-- Reproduced verbatim wherever it is used - never paraphrased or regenerated
-- by an LLM. See docs/specs/Company-Voice-Audit.md for where it is (and is
-- not yet) wired in, and why.
--
-- No new RLS: companies already has member select/update policies (0001), and
-- this is one more column on that row.

alter table companies add column how_we_work text;

alter table companies add constraint companies_how_we_work_length
  check (how_we_work is null or char_length(how_we_work) <= 10000);

comment on column companies.how_we_work is
  'The company''s own description of who it is and how it actually approaches a tender/project, in its own words (free text, up to 10 000 characters). Edited on /company. Any engine output that needs company-specific framing uses this text verbatim - never an LLM paraphrase of it. See docs/specs/Company-Voice-Audit.md.';
