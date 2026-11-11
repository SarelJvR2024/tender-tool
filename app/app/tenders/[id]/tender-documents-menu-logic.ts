/**
 * Pure logic for tender-documents-menu.tsx, extracted the same way
 * position-cv-jobs-logic.ts sits beside page.tsx - so this is testable
 * without a React renderer (no jsdom/testing-library dependency exists in
 * this repo).
 */

export type PrivateDocEntry = { id: string; title: string; href: string | null };

/**
 * Finding 433: whether a private-document entry has a real, clickable
 * destination. `href` is null whenever its signed URL could not be created
 * (page.tsx's own `createSignedUrl()` call failing is the one real site -
 * a transient Storage/network error, not something the document's own
 * presence or absence decides). Every sibling that renders this exact same
 * `tender_private_documents` data - private-documents.tsx's own list
 * (`signed[d.storage_path] ? <a>... : <span>...`) and this file's own
 * cv-compare.tsx neighbour - already falls back to plain, unlinked text in
 * that case; tender-documents-menu.tsx used to render `href={d.href ?? "#"}`
 * instead, a clickable row that silently does nothing (jumps to the top of
 * the page) with no indication anything is wrong.
 */
export function hasRealHref(d: Pick<PrivateDocEntry, "href">): boolean {
  return !!d.href;
}
