/**
 * Minimal stroke-icon renderer matching the TANVIONROYALE inline-SVG icon
 * style used across the user-facing UI (see components/navigation/bottom-nav,
 * components/home/*). Icons are 24x24 viewBox stroke paths rendered with
 * currentColor so they inherit hover/active text colours automatically.
 */
export function NavIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}