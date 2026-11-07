// Regression test for a real bug found 2026-11-07x (standing solution-
// architect review): founderDailyDigestEmail() used to take `number` for
// newSignupsLast24h/activeSubscriptions/closingWithin48h/scoutBacklogCount,
// so there was no way for its one real caller (scripts/send-founder-digest.ts)
// to tell the template "this count's own read failed" apart from "this
// count is genuinely zero" - both rendered as a plain "0". Now `number |
// null`, with `null` rendered as its own distinct "Couldn't load" value.
import { describe, expect, it } from "vitest";
import { founderDailyDigestEmail } from "./emailTemplatesTier3.ts";

const base = {
  date: "07 Nov 2026",
  workerJobSuccessRate: { succeeded: 47, total: 49 },
  newSignupsLast24h: 2,
  activeSubscriptions: 18,
  closingWithin48h: 3,
  scoutBacklogCount: 1,
  appUrl: "https://app.example",
};

describe("founderDailyDigestEmail", () => {
  it("renders a genuine zero as \"0\", not as a failure", () => {
    const email = founderDailyDigestEmail({ ...base, newSignupsLast24h: 0, activeSubscriptions: 0 });
    expect(email.text).toContain("New signups (24h): 0");
    expect(email.text).toContain("Active subscriptions: 0");
    expect(email.html).not.toContain("Couldn't load");
  });

  it("renders a failed read as \"Couldn't load\", never as \"0\"", () => {
    const email = founderDailyDigestEmail({ ...base, newSignupsLast24h: null });
    expect(email.text).toContain("New signups (24h): Couldn't load");
    expect(email.text).not.toContain("New signups (24h): 0");
    expect(email.html).toContain("Couldn't load");
  });

  it("flags every one of the 4 counts independently when null", () => {
    const email = founderDailyDigestEmail({
      ...base,
      newSignupsLast24h: null,
      activeSubscriptions: null,
      closingWithin48h: null,
      scoutBacklogCount: null,
    });
    expect(email.text).toContain("New signups (24h): Couldn't load");
    expect(email.text).toContain("Active subscriptions: Couldn't load");
    expect(email.text).toContain("Closing within 48h: Couldn't load");
    expect(email.text).toContain("Scout backlog: Couldn't load");
  });

  it("falls back the subject line when the metrics it quotes directly failed to load", () => {
    const ok = founderDailyDigestEmail(base);
    expect(ok.subject).toContain("3 closing in 48h, 1 flagged");

    const failed = founderDailyDigestEmail({ ...base, closingWithin48h: null });
    expect(failed.subject).not.toContain("null closing in 48h");
    expect(failed.subject).toContain("some metrics couldn't load");
  });

  it("adds a visible admin-console warning when any metric failed, and omits it when all succeeded", () => {
    const ok = founderDailyDigestEmail(base);
    expect(ok.html).not.toContain("couldn't be read this run");

    const failed = founderDailyDigestEmail({ ...base, scoutBacklogCount: null });
    expect(failed.html).toContain("couldn't be read this run");
  });
});
