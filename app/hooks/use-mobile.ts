import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

// useSyncExternalStore, not useState+useEffect - matchMedia is an external
// store, and reading it via a plain effect-driven setState after mount
// (shadcn's own default generated code) trips React's
// react-hooks/set-state-in-effect rule, which this repo runs as a real
// lint error, not a style nit.
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
