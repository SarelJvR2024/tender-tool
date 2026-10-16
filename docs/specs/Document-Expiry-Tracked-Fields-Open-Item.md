# Open item: which documents actually have a tracked expiry date (2026-10-16)

Raised while building `engine/compliance/watch_deadlines.py` (document expiry
reminders + tender task timeline, per
`Tender-Tool-Competitor-Feature-Deep-Dive.md`'s "Document expiry reminders,
and a tender task/deadline timeline" section).

The spec text for that task names "COID, B-BBEE, insurance, CSD etc." as the
tracked documents. I read the actual schema
(`app/supabase/migrations/0001_init_schema.sql`) rather than assume all of
those exist as real columns, and found only one:

- `companies.coid_letter_of_good_standing_expiry` (date) - real, already
  surfaced on the Document Vault (`app/app/company/page.tsx`) with its own
  expiry badge.

There is no B-BBEE certificate expiry column, no insurance expiry column, and
no CSD-registration-validity column anywhere in `companies` or any other
table as of migration `0009`. (`bee_level`, `black_ownership_pct`,
`bee_procurement_recognition_pct`, `csd_supplier_number`, `csd_trading_name`
exist, but none of them is a date.)

So `engine/compliance/watch_deadlines.py`'s `TRACKED_EXPIRY_FIELDS` list
currently has exactly one entry, not guessed-at columns for the others. This
is not a bug in the reminder script - it is reporting honestly on what the
schema actually holds. It does mean the document-expiry reminder is
currently COID-only in practice, not the full "COID, B-BBEE, insurance, CSD"
set the spec names.

**Open question for Sarel:** do B-BBEE certificates, insurance, and CSD
registration actually have a renewal/expiry date in the real world that's
worth capturing (most do - B-BBEE certificates and CSD registration both
expire annually in practice), and if so, which fields should be added to
`companies` (or a per-document-type table, if more than one certificate per
type can exist over time - same shape question already open for CV uploads,
see `System-Status.md`) to capture them? Once that's answered and a
migration adds the real column(s), adding them to `TRACKED_EXPIRY_FIELDS` is
a one-line change, not a rewrite.
