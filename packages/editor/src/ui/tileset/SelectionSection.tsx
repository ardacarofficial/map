import { isEntityLayer, makeStampId, type MapDocument, type Stamp, type TileClip } from "@smap/core";
import { useState, type FormEvent } from "react";

import { activeStampId, defaultStampName, isEmptyStamp, pickStamp } from "../../commands/stampActions";
import { t } from "../../i18n";
import { takenStampIds, useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { registerInspectorSection, type InspectorContext } from "../layout/inspector/registry";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { toast } from "../toast/toastStore";
import { boundsOf } from "./selectionModel";
import { useTilesetView } from "./tilesetViewStore";

/**
 * Saves a clip on the brush (tileset selection or map pick) as a library
 * stamp. Clip layers named after map layers that still exist take those
 * names, so placing the stamp later lands on the same layers.
 */
export function saveClipAsStamp(doc: MapDocument, clip: TileClip, name: string): Stamp | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  const library = useProjectLibrary.getState();
  const layers = clip.layers.map((l) => {
    const target = doc.getLayer(l.layerId);
    return target && !isEntityLayer(target) ? Object.freeze({ ...l, name: target.name }) : l;
  });
  const stamp: Stamp = Object.freeze({
    id: makeStampId(trimmed, takenStampIds(library)),
    name: trimmed,
    width: clip.width,
    height: clip.height,
    palette: clip.palette,
    layers: Object.freeze(layers),
  });
  if (isEmptyStamp(stamp)) {
    toast.warning(t("toast.stampEmpty"));
    return null;
  }
  library.addStamp(stamp);
  pickStamp(stamp.id);
  // Already on the brush: no "Fırçaya al" action.
  toast.success(t("toast.stampSaved", { name: stamp.name }));
  return stamp;
}

/** Inspector: the unsaved multi-tile clip on the brush ("3 × 2 tile · overworld-32") and "Stamp olarak kaydet". */
function SelectionSection({ ctx }: { ctx: InspectorContext }) {
  const stamp = useEditorStore((s) => s.stamp);
  const panel = useTilesetView((s) => s.selection);
  const [naming, setNaming] = useState<TileClip | null>(null);
  if (!stamp || activeStampId(stamp) !== null) return null;
  const fromPanel = panel && panel.clip === stamp ? panel : null;
  const tileset = fromPanel ? ctx.doc.getTileset(fromPanel.tilesetId) : undefined;
  const bounds = fromPanel && tileset ? boundsOf(tileset, fromPanel.ids) : null;
  const holes = bounds ? bounds.width * bounds.height !== fromPanel!.ids.length : false;
  const source = tileset?.name ?? stamp.layers.map((l) => l.name).join(", ");
  const label = holes
    ? t("tilesetPanel.selectionCount", { count: fromPanel!.ids.length, tileset: source })
    : t("tilesetPanel.selectionSize", { width: stamp.width, height: stamp.height, tileset: source });

  return (
    <div className="mx-3 mt-2 flex flex-col gap-2 rounded-md border border-line-subtle bg-raised/50 p-2" data-inspector-selection>
      <div className="flex items-center gap-2 text-sm">
        <Icon name="select" size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate font-mono text-text tabular" data-selection-label>
          {label}
        </span>
      </div>
      {naming === stamp ? (
        <StampNameForm doc={ctx.doc} clip={stamp} onDone={() => setNaming(null)} />
      ) : (
        <Button className="h-7 w-full text-sm" onClick={() => setNaming(stamp)} data-save-selection-stamp>
          <Icon name="stamp" size={14} />
          {t("tilesetPanel.saveStamp")}
        </Button>
      )}
    </div>
  );
}

function StampNameForm({ doc, clip, onDone }: { doc: MapDocument; clip: TileClip; onDone(): void }) {
  const [name, setName] = useState(() => defaultStampName(useProjectLibrary.getState().stamps));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (saveClipAsStamp(doc, clip, name)) onDone();
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        aria-label={t("tilesetPanel.stampName")}
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
        spellCheck={false}
        autoComplete="off"
        maxLength={64}
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel px-2 text-md text-text focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:outline-none"
      />
      <Button type="submit" variant="primary" className="h-7 px-2.5 text-sm" disabled={name.trim().length === 0}>
        {t("common.save")}
      </Button>
    </form>
  );
}

let registered = false;

/** Adds the section under "Fırça" (idempotent). */
export function registerSelectionSection(): void {
  if (registered) return;
  registered = true;
  registerInspectorSection({
    id: "tileset.selection",
    order: 21,
    when: (c) => c.entity === undefined && !isEntityLayer(c.layer),
    Component: SelectionSection,
  });
}
