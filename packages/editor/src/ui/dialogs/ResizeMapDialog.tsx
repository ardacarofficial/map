import { Dialog } from "@base-ui/react/dialog";
import { useState, type FormEvent } from "react";
import { t, type MessageKey } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import { Button } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";
import { Field, parseIntInRange } from "./NewProjectDialog";
import { arrowRotation, resizeOffsets, type Anchor } from "./resizeMath";
import { backdropClass, popupClass } from "./styles";

const MAP_MIN = 1;
const MAP_MAX = 4096;
const ANCHORS: Anchor[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** map.resize — new width/height plus the 3×3 anchor; one undoable `resizeMap` op. */
export function ResizeMapDialog() {
  const open = useUiStore((s) => s.resizeOpen);
  const setOpen = useUiStore((s) => s.setResizeOpen);
  const hasProject = useEditorStore((s) => s.project !== null);
  return (
    <Dialog.Root open={open && hasProject} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup className={`${popupClass} w-[440px] max-w-[calc(100vw-32px)]`}>
          {open && hasProject && <ResizeForm onDone={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ResizeForm({ onDone }: { onDone(): void }) {
  const store = useEditorStore.getState().project!.store;
  const map = store.document.map;
  const max = Math.max(MAP_MAX, map.width, map.height);
  const [width, setWidth] = useState(String(map.width));
  const [height, setHeight] = useState(String(map.height));
  const [anchor, setAnchor] = useState<Anchor>(0);
  const w = parseIntInRange(width, MAP_MIN, max);
  const h = parseIntInRange(height, MAP_MIN, max);
  const err = t("newProject.errSize", { min: MAP_MIN, max });
  const valid = w !== null && h !== null;
  const unchanged = valid && w === map.width && h === map.height;
  const crops = valid && (w < map.width || h < map.height);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || unchanged) return;
    const { offsetX, offsetY } = resizeOffsets(map, { width: w, height: h }, anchor);
    store.dispatch({ type: "resizeMap", width: w, height: h, offsetX, offsetY });
    toast.success(t("toast.mapResized", { width: w, height: h }));
    onDone();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <Dialog.Title className="text-lg font-semibold">{t("resize.title")}</Dialog.Title>
        <Dialog.Description className="text-md text-muted">{t("resize.description")}</Dialog.Description>
      </div>
      <div className="flex gap-5 px-5 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Field
            label={t("resize.width")}
            value={width}
            onChange={setWidth}
            unit={t("newProject.cellsUnit")}
            numeric
            autoFocus
            error={w === null ? err : null}
          />
          <Field
            label={t("resize.height")}
            value={height}
            onChange={setHeight}
            unit={t("newProject.cellsUnit")}
            numeric
            error={h === null ? err : null}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-muted">{t("resize.anchor")}</span>
          <div role="radiogroup" aria-label={t("resize.anchor")} className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-panel p-1.5">
            {ANCHORS.map((cell) => {
              const rotation = arrowRotation(cell, anchor);
              const label = t(`resize.pos${cell}` as MessageKey);
              return (
                <button
                  key={cell}
                  type="button"
                  role="radio"
                  aria-checked={cell === anchor}
                  aria-label={t("resize.anchorCell", { position: label })}
                  title={label}
                  onClick={() => setAnchor(cell)}
                  className={`grid size-8 place-items-center rounded-sm transition-colors ${
                    cell === anchor ? "bg-accent-soft text-accent" : "text-faint hover:bg-hover hover:text-muted"
                  }`}
                >
                  {cell === anchor ? (
                    <span className="size-3 rounded-xs bg-accent" />
                  ) : rotation !== null ? (
                    <span style={{ transform: `rotate(${rotation}deg)` }} className="grid place-items-center">
                      <Icon name="arrowUp" size={14} />
                    </span>
                  ) : (
                    <span className="size-1 rounded-full bg-line-strong" />
                  )}
                </button>
              );
            })}
          </div>
          <span className="max-w-[124px] text-xs text-faint">{t("resize.anchorHint")}</span>
        </div>
      </div>
      {crops && (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          <Icon name="warning" size={14} className="mt-px shrink-0" />
          {t("resize.cropWarning")}
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <span className="font-mono text-xs text-faint tabular">
          {valid
            ? t("resize.summary", { fromWidth: map.width, fromHeight: map.height, toWidth: w, toHeight: h })
            : " "}
        </span>
        <div className="ml-auto flex gap-2">
          <Dialog.Close render={<Button variant="ghost">{t("common.cancel")}</Button>} />
          <Button type="submit" variant="primary" disabled={!valid || unchanged}>
            {t("resize.apply")}
          </Button>
        </div>
      </div>
    </form>
  );
}
