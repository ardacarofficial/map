/** Small line glyphs of the stamp library that the shared icon set does not have (24×24 grid, `currentColor`). */

const common = {
  viewBox: "0 0 24 24",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** ★ — filled when `on`. */
export function StarGlyph({ on = false, size = 14, className }: { on?: boolean; size?: number; className?: string }) {
  return (
    <svg {...common} width={size} height={size} fill={on ? "currentColor" : "none"} className={className}>
      <path d="M11.5 2.8a.6.6 0 0 1 1 0l2.6 5.3 5.8.8a.6.6 0 0 1 .3 1l-4.2 4.1 1 5.8a.6.6 0 0 1-.8.6L12 17.7l-5.2 2.7a.6.6 0 0 1-.8-.6l1-5.8-4.2-4.1a.6.6 0 0 1 .3-1l5.8-.8z" />
    </svg>
  );
}

export function TagGlyph({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg {...common} width={size} height={size} fill="none" className={className}>
      <path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function ListGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg {...common} width={size} height={size} fill="none" className={className}>
      <rect x="3" y="4" width="5" height="5" rx="1" />
      <rect x="3" y="15" width="5" height="5" rx="1" />
      <path d="M11 6.5h10M11 17.5h10" />
    </svg>
  );
}

export function TilesGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg {...common} width={size} height={size} fill="none" className={className}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.2" />
    </svg>
  );
}
