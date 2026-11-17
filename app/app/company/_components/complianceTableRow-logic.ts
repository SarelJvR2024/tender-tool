/**
 * Pure logic for ComplianceDocumentsView.tsx's own table row - extracted the
 * same way position-cv-jobs-logic.ts sits beside page.tsx, so it's testable
 * without JSX (node --experimental-strip-types, no bundler).
 *
 * Finding 488 (standing review, 2026-11-17): the table row (now the DEFAULT
 * view per Sarel's own live feedback, quoted in ComplianceDocumentsView.tsx's
 * own header comment - "move towards a table row view... Table is the
 * default") only ever rendered entry.detail (lines[0]) plus a separate
 * Expires column. ComplianceDocumentsSection.tsx's own lines arrays carry a
 * THIRD line for four of the seven kinds - cidbLines' "Reg. no. X ·
 * Contractor name on certificate: Y", bankLines' "Bank: X · Account holder:
 * Y", beeLines' "Entity name on certificate: Z", isoLines' "Certified entity
 * on certificate: Z" - and the table row never showed it at all; only card
 * view (DocumentRow, which already renders every line) did. That third line
 * is exactly the fact a reviewer uses this screen to catch: a BEE/CIDB/ISO
 * certificate or bank letter issued to a different legal entity than the one
 * bidding is a real, common disqualification reason, and documentStatus()
 * (the status chip) has no way to flag it - it only knows "on file" and
 * "expiry", not entity-name matching. Switching to table view - the new
 * default - silently dropped the only place that fact was visible, with
 * nothing in the table hinting more detail exists.
 *
 * Every entry's own lines[0] is already shown as entry.detail, and lines[1]
 * is always the date/expiry fact already covered by the table's own Expires
 * column - just phrased differently per kind ("Expires X" for most, but
 * bankLines' own "Usable until X (3 months from its date)"), so matching on
 * an "Expires " prefix alone misses that one and would show it twice. Every
 * kind's own lines array puts the entity/contractor/account-holder name -
 * the only fact genuinely absent from detail+Expires - at index 2 and
 * nowhere else (ComplianceDocumentsSection.tsx's own cidbLines/bankLines/
 * beeLines/isoLines, each `.filter(Boolean)`-trimmed so a kind with no such
 * fact on file simply has no index 2 at all), so lines[2:] - not a text
 * match - is the real, stable cut point.
 */
export function extraTableLines(lines: string[]): string[] {
  return lines.slice(2);
}
