/**
 * Pre-filled WhatsApp message text, shared between a Server Component
 * (app/page.tsx's own footer link) and a Client Component
 * (components/public/whatsapp-contact-button.tsx). Deliberately NOT
 * defined inside whatsapp-contact-button.tsx itself (where it previously
 * lived, as a named export) - a Server Component importing a named,
 * non-component export from a "use client" module crosses the RSC
 * client-boundary in a way the server bundle can't safely resolve: the
 * footer's own href ended up containing the literal text of the thrown
 * "Attempted to call HOME_MESSAGE() from the server" client-reference
 * error instead of the real message, a crash discovered in the pre-demo
 * production audit (2026-10-26). This file has no "use client" directive
 * and exports nothing but plain strings, so either side can import it
 * directly with no boundary to cross.
 */
export const HOME_MESSAGE = "Hi Sarel, I'd like to find out more about Tender Ready.";
export const DEMO_MESSAGE = "Hi Sarel, I'm reviewing the Tender Ready demo and have a question.";
export const PRICING_MESSAGE = "Hi Sarel, I'd like to find out more about Tender Ready subscription pricing.";
