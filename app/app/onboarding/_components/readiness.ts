export type ReadinessItem = { label: string; done: boolean; href: string };

/**
 * A real, computed score from what's actually on file - not a fixed demo
 * number. Six equally-visible checks, weighted so the heaviest ones (a real
 * office and at least one person on the CV bench - both things a submission
 * pack genuinely can't go out without) count for more than the lighter ones.
 * Weights sum to 100; adjust here if a check's real-world importance changes,
 * not by editing the percentage anywhere else.
 */
export function computeBidReadiness(input: {
  hasCompliance: boolean;
  hasCidb: boolean;
  officeCount: number;
  peopleCount: number;
  digestOptIn: boolean;
}): { percent: number; items: ReadinessItem[] } {
  const items: (ReadinessItem & { weight: number })[] = [
    { label: "Company registered", done: true, href: "/onboarding?step=1", weight: 15 },
    { label: "Compliance basics on file (CSD, tax PIN or B-BBEE)", done: input.hasCompliance, href: "/onboarding?step=2", weight: 20 },
    { label: "CIDB grading on file", done: input.hasCidb, href: "/company#bee-cidb", weight: 15 },
    { label: "At least one office location", done: input.officeCount > 0, href: "/onboarding?step=3", weight: 20 },
    { label: "At least one person on your CV bench", done: input.peopleCount > 0, href: "/onboarding?step=4", weight: 15 },
    { label: "Notification preference set", done: input.digestOptIn, href: "/onboarding?step=5", weight: 15 },
  ];

  const percent = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);
  return { percent, items: items.map(({ label, done, href }) => ({ label, done, href })) };
}
