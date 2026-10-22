"use client";

import { useId } from "react";

/**
 * Right-edge fade + "Scroll for more" hint for a horizontally-scrolling
 * element (a board, a row of filter chips) whose overflow would otherwise
 * go unmarked. Place inside a `position: relative` wrapper around the
 * scrolling element. Hides itself once `minWidthToHide` is reached, i.e.
 * once the content actually fits without scrolling.
 *
 * `fadeColor` is an rgb triplet (e.g. "246, 245, 241") matching whatever
 * background the fade sits on top of, so the gradient reads as a fade to
 * that background rather than a mismatched box.
 *
 * `hint` (default true) also renders the "Scroll for more" text line below
 * the fade. Pass false when the wrapper has no room to grow - e.g. inside a
 * sticky bar, where adding a permanent text row would add height to
 * something pinned on screen for the whole page scroll; the fade alone
 * still gives the edge-overlay cue.
 */
export function ScrollFade({
  fadeColor,
  minWidthToHide,
  hint = true,
}: {
  fadeColor: string;
  minWidthToHide: number;
  hint?: boolean;
}) {
  const cls = `scroll-fade-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <>
      <style>{`
        @media (min-width: ${minWidthToHide}px) {
          .${cls} { display: none; }
        }
      `}</style>
      <div
        className={cls}
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 8,
          width: 36,
          pointerEvents: "none",
          background: `linear-gradient(to right, rgba(${fadeColor}, 0), rgba(${fadeColor}, 0.95))`,
        }}
      />
      {hint && (
        <div className={`${cls} mt-1 text-right text-[11px] text-muted-foreground`}>
          Scroll for more &rarr;
        </div>
      )}
    </>
  );
}
