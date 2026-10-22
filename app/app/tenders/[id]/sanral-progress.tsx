"use client";

import { useEffect, useState } from "react";

/**
 * "SANRAL schedules" premium feature, item 2 of 10: a plain-word progress
 * display while a pack job is requested/generating (Sarel's own spec: "the
 * steps in plain words - reading the file, filling schedules, checking
 * totals"). There is no real per-stage signal anywhere to drive this from -
 * confirmed by reading engine/pack/process_pack_jobs.py in full: the job row
 * only ever carries the same four-value status (requested/generating/ready/
 * failed), nothing finer. So this cycles through the three captions on a
 * timer while the job is in flight - cosmetic reassurance that something is
 * happening, not a readout of the engine's real internal stage. If the
 * engine ever reports a real stage, this should read that instead.
 */
const STEPS = ["Reading the file…", "Filling schedules…", "Checking totals…"];
const STEP_MS = 4000;

export function SanralProgress({ active }: { active: boolean }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <div className="mt-2.5 flex items-center gap-2 text-xs text-warning">
      <span
        className="size-3 rounded-full border-2 border-warning/30 border-t-warning"
        style={{ animation: "sanral-spin 0.8s linear infinite" }}
      />
      <span>{STEPS[step]}</span>
      <style>{`@keyframes sanral-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
