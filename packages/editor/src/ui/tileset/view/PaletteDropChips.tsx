import type { Collection } from "@smap/core";

import { Tooltip } from "../../primitives/Tooltip";

import { showPalette } from "../../palettes/paletteActions";
import { usePaletteStore } from "../../palettes/paletteStore";

export function PaletteDropChips({ palettes }: { palettes: readonly Collection[] }) {
  const drag = usePaletteStore((s) => s.drag);
  if (!drag || !palettes.length) return null;
  return <div data-header-flexible className="flex min-w-0 items-center gap-1 overflow-x-auto">
    {palettes.map((p) => <Tooltip key={p.id} label={p.name}><button type="button" data-palette-drop={p.id} data-palette-card={p.id} onClick={() => showPalette(p.id)}
      className={`h-control-sm max-w-30 shrink-0 truncate rounded-sm border border-dashed px-2 text-sm text-text hover:border-accent-line hover:bg-accent-soft ${drag.target?.paletteId === p.id ? "border-accent-line bg-accent-soft" : "border-line"}`}>{p.name}</button></Tooltip>)}
  </div>;
}
