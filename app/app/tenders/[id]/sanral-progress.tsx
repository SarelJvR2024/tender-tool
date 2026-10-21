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
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12, color: "#B45309" }}>
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          border: "2px solid #F5D08A",
          borderTopColor: "#B45309",
          animation: "sanral-spin 0.8s linear infinite",
        }}
      />
      <span>{STEPS[step]}</span>
      <style>{`@keyframes sanral-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
