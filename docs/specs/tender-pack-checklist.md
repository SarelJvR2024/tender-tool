# Tender pack checklist (confirmed from real 2026 SANRAL submissions)

Generic findings only — no tenant-specific numbers belong in this file, since this repo is
public. Tenant company/CV data lives in `config/*_profile.json` (gitignored) instead.

Reviewed 8 real 2026 SANRAL "Routine Road Maintenance" (RRM) consulting-engineer tender
submissions. Every one followed the same skeleton, which refines what `SANRAL-Tender-
Automation-Specification.md` already documents:

1. **Tender Document** — SANRAL's own book(s): Part T1 (Tendering Procedures, incl. SBD1
   Invitation to Bid, tax/CSD/B-BBEE compliance fields on the cover), Part C1 (Forms of
   Offer/Acceptance incorporating SBD7, Banking Details form, Tax Compliance declaration,
   Contract Data, OHS Act 1993 agreement).
2. **Addendum(s)** — re-issued during the tender period, same book structure.
3. **Tender Advert** — the public notice.
4. **Returnable Schedules** — the tenderer's actual inputs:
   - Authority of Signatory letter (director authorises the person signing, scoped to named
     bid/contract numbers)
   - B-BBEE sworn affidavit
   - Form B1.1 — key person's technical/managerial record (max 3 past projects; matches
     the engine's `max_projects=3` guard)
   - Form B2.1 — qualification/registration record (ECSA/SACPCMP, highest + initial
     qualification, years' experience)
   - Form B3 — tenderer's project structure (HQ city, other offices, ECSA/SACPCMP counts,
     total staff, JV %, organogram)
   - Form B4 — Quality Systems certificate (≤2 pages), backed by a longer in-house QMS
     document
   - Form B5b — programme/Gantt milestones
   - Form B6a/B6c — reference checks ("Interim PSP Performance Report" from past clients)
   - Form B7/B7.1 — Targeted Enterprise/subcontractor details (name, EME/QSE status, % of
     contract, % black ownership, BEE level, SARS tax ref)
   - Form C1.2.3 — contract data for Treasury's award-publication notice (key person names,
     directors/registration numbers)
   - Form C2.4 — key persons' normalised hours, extracted from the pricing sheet
5. **Pricing Schedule / BOQ** — a separate macro-enabled `.xlsm` per contract, with its own
   Addendum/Rev versions.
6. **Technical Submission** — the large `RRM_Consultant_Tender*.xlsm` (a working "FINAL"
   version and a signed "FINAL_FILLED" version) is the master data entry point. The individual
   Form B PDFs are printed/exported from it for the physical bundle (an "Appendices to Tender
   Document (RRM)" folder holds these exports).

## What this confirms about the engine

- Form B1–B7 plus C1.2.3/C2.4 are the real returnable set per tender — matches
  `fill_conventional.py`/`fill_tender.py`'s cell map.
- B4 (QMS) and B5 (programme) need real attached content, not just blank forms — the spec's
  open issue "B4 and B5 attachments not generated" is a genuine gap, not a formality.
- B6 (past-performance / reference checks) draws on real client references — this needs a
  reusable "project + referee" data model, not a one-off per tender.
- Targeted Enterprise (B7) is sometimes genuinely unknown at submission time ("will be
  identified after tender award") — the engine must support leaving this block blank rather
  than requiring it.
