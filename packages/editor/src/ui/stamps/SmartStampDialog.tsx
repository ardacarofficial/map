import { Dialog } from "@base-ui/react/dialog";
import { buildLayout1RoadProfile, createDocument, MapStore, planSmartStampArea, planSmartStampRoad, nineSliceProblem, type NineSliceInnerCorner, type Stamp } from "@smap/core";
import { useEffect, useRef, useState } from "react";
import { acceptSmartStamp, discardSmartStamp, prepareSmartStamp, useSmartStampDialog, type PreparedSmartStamp } from "../../commands/smartStampCommands";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { AdvancedDisclosure, DialogBody, DialogFooter, DialogHeader, dialogLayoutClass } from "../dialogs/DialogFrame";
import { backdropClass, popupClass, dialogWidthM } from "../dialogs/styles";
import { Button } from "../primitives/Button";
import { TextField } from "../primitives/TextField";
import { MenuSelect } from "../primitives/MenuSelect";

const SHAPES = [
  [[1, 2], [2, 2], [3, 2]], [[2, 1], [2, 2]], [[2, 1], [2, 2], [3, 2]],
  [[1, 2], [2, 2], [3, 2], [2, 3]], [[1, 2], [2, 1], [2, 2], [3, 2], [2, 3]],
];
const NAMES = ["straight", "end", "turn", "tee", "cross"] as const;
function BakePreview({ prepared, index }: { prepared: PreparedSmartStamp; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, asset = prepared.assets[0];
    if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const ts = asset?.tileset, map = useEditorStore.getState().project!.store.document.map, w = ts?.tileWidth ?? map.tileWidth, h = ts?.tileHeight ?? map.tileHeight;
    canvas.width = 5 * w; canvas.height = 5 * h; ctx.imageSmoothingEnabled = false;
    const store = new MapStore(createDocument({ width: 5, height: 5, tileWidth: w, tileHeight: h }));
    for (const a of prepared.assets) store.dispatch({ type: "addTileset", tileset: a.tileset });
    for (const layer of prepared.stamp.layers) store.dispatch({ type: "addLayer", layer: layer.grid ? { name: layer.name, type: "grid", role: layer.role ?? "collision" } : { name: layer.name } });
    const layerId = store.document.layers[0]!.id;
    const road = { tilesetId: ts?.id ?? "", profile: ts?.roadProfile ?? buildLayout1RoadProfile(prepared.stamp.width, prepared.stamp.height) };
    const sourceLayer = prepared.stamp.layers.find(l => l.layerId === ts?.generated?.layerId)!;
    const stamp = { ...prepared.stamp, layers: sourceLayer ? [sourceLayer] : [], nineSlice: { border: 1 as const, tileLayers: [{ layerId: sourceLayer?.layerId ?? "", tilesetId: ts?.id ?? "" }], road } };
    const points = SHAPES[index]!;
    try {
      const areaOnly = !sourceLayer || prepared.stamp.layers.length !== 1 || !!nineSliceProblem(stamp, { roadLayerId: sourceLayer.layerId });
      const plan = areaOnly ? planSmartStampArea(store.document, prepared.stamp, { x: 1, y: 1, width: [3, 1, 2, 3, 3][index]!, height: [1, 1, 2, 2, 3][index]! }, { revision: store.revision }) : planSmartStampRoad(store.document, stamp, layerId, { bounds: { x: 0, y: 0, width: 5, height: 5 }, contains: (x, y) => points.some(p => p[0] === x && p[1] === y) }, { revision: store.revision });
      for (const l of plan.layers) for (const cell of l.writes) if ("value" in cell && cell.value) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(l.role === "collision" ? "--color-collision" : "--color-accent").trim();
        ctx.fillRect(cell.x * w, cell.y * h, w, h);
      } else if ("tile" in cell && cell.tile) {
        const id = cell.tile.tileId, drawn = prepared.assets.find(a => a.tileset.id === cell.tile!.tilesetId)!;
        ctx.drawImage(drawn.image.bitmap, (id % drawn.tileset.columns) * w, Math.floor(id / drawn.tileset.columns) * h, w, h, cell.x * w, cell.y * h, w, h);
      }
    } catch (error) { console.warn("[smart stamp] preview failed", error); }
  }, [prepared, index]);
  const first = prepared.assets[0];
  const areaOnly = !first || prepared.stamp.layers.length !== 1 || !!nineSliceProblem(prepared.stamp, { roadLayerId: first.tileset.generated!.layerId });
  return <figure className="flex min-w-0 flex-col gap-1"><canvas ref={ref} className="aspect-square w-full checker rounded-sm border border-line-subtle [image-rendering:pixelated]" data-smart-stamp-preview={NAMES[index]} /><figcaption className="text-sm text-muted">{areaOnly ? `${[3, 1, 2, 3, 3][index]} × ${[1, 1, 2, 2, 3][index]}` : t(`smartStamp.${NAMES[index]!}`)}</figcaption></figure>;
}
export function SmartStampDialog() {
  const id = useSmartStampDialog(s => s.stampId);
  const stamp = useProjectLibrary(s => s.stamps.find(x => x.id === id));
  const close = () => useSmartStampDialog.getState().open(null);
  return <Dialog.Root open={!!stamp} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal><Dialog.Backdrop className={backdropClass} /><Dialog.Popup className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`} data-smart-stamp-dialog="">{stamp && <Conversion key={stamp.id} stamp={stamp} close={close} />}</Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
function Conversion({ stamp, close }: { stamp: Stamp; close(): void }) {
  const [advanced, setAdvanced] = useState(false), [inner, setInner] = useState<NineSliceInnerCorner | null | undefined>(undefined);
  const [prepared, setPrepared] = useState<PreparedSmartStamp | null>(null), [error, setError] = useState<string | null>(null);
  const retained = useRef<PreparedSmartStamp | null>(null), accepted = useRef(false);
  const tilesets = useEditorStore.getState().project!.store.document.tilesets.filter(t => !t.generated);
  const choice = inner?.tile ?? useEditorStore.getState().selection ?? stamp.palette[0] ?? { tilesetId: tilesets[0]?.id ?? "", tileId: 0 };
  useEffect(() => {
    let alive = true;
    setPrepared(null); setError(null);
    void prepareSmartStamp(stamp, inner).then(p => { if (!alive) { discardSmartStamp(p); return; } retained.current = p; setPrepared(p); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; if (retained.current && !accepted.current) discardSmartStamp(retained.current); retained.current = null; };
  }, [stamp, inner]);
  const submit = () => {
    if (!prepared) return;
    try { acceptSmartStamp(prepared); accepted.current = true; close(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return <>
    <DialogHeader title={t("smartStamp.dialogTitle")} subtitle={stamp.name} onClose={close} />
    <DialogBody className="flex flex-col gap-3">
      <p className="text-sm text-text">{t("smartStamp.facts", { width: stamp.width, height: stamp.height, count: stamp.layers.length })}</p>
      <p className="text-sm text-muted">{t("smartStamp.composition")}</p>
      {prepared && <div className="grid grid-cols-5 gap-2">{NAMES.map((name, index) => <BakePreview key={name} prepared={prepared} index={index} />)}</div>}
      {!prepared && !error && <p className="text-sm text-muted" role="status">{t("smartStamp.preparing")}</p>}
      {error && <p className="text-sm text-danger" role="alert">{t("smartStamp.failed", { detail: error })}</p>}
      {prepared?.assets.length !== 0 && <AdvancedDisclosure label={t("smartStamp.advanced")} open={advanced} onChange={setAdvanced}>
        <div className="flex flex-wrap items-center gap-2" data-smart-stamp-inner="">
          <span className="text-sm text-muted">{t("smartStamp.innerCorner")}</span>
          <MenuSelect label={t("smartStamp.source")} value={choice.tilesetId} options={tilesets.map(ts => ({ value: ts.id, label: ts.name }))} onChange={tilesetId => setInner({ tile: { tilesetId, tileId: 0 } })} />
          <TextField size="md" className="w-16" type="number" min={0} max={(tilesets.find(t => t.id === choice.tilesetId)?.columns ?? 1) * (tilesets.find(t => t.id === choice.tilesetId)?.rows ?? 1) - 1} aria-label={t("smartStamp.innerCorner")} value={inner?.tile.tileId ?? ""} placeholder="—" onChange={e => setInner(e.target.value === "" ? null : { tile: { tilesetId: choice.tilesetId, tileId: Number(e.target.value) } })} />
          <Button variant="secondary" onClick={() => setInner(null)}>{t("smartStamp.squareJoins")}</Button>
        </div>
      </AdvancedDisclosure>}
    </DialogBody>
    <DialogFooter><Button variant="secondary" onClick={close}>{t("common.cancel")}</Button><Button variant="primary" disabled={!prepared || !!error} onClick={submit}>{t("smartStamp.prepare")}</Button></DialogFooter>
  </>;
}
