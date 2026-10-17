import type { ReactNode } from "react";

/** Local Lucide geometry for glyphs not yet included in the shared Icon primitive. */
function Glyph({ size = 16, className, filled = false, children }: { size?: 12 | 16; className?: string; filled?: boolean; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={(1.5 * 24) / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Monochrome favourite star, filled only when enabled. */
export function StarGlyph({ on = false, ...props }: { on?: boolean; size?: 12 | 16; className?: string }) {
  return (
    <Glyph {...props} filled={on}>
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />
    </Glyph>
  );
}

/** Lucide tag geometry for metadata chips. */
export function TagGlyph(props: { size?: 12 | 16; className?: string }) {
  return (
    <Glyph {...props}>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" />
      <path d="M7 7h.01" />
    </Glyph>
  );
}

/** Lucide list geometry for the library view toggle. */
export function ListGlyph(props: { size?: 12 | 16; className?: string }) {
  return (
    <Glyph {...props}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </Glyph>
  );
}
