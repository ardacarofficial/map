/**
 * The bulk import card: several PNGs dropped / picked / pasted at once →
 * ONE card listing every file with its guessed tile size (editable in the
 * row), the grid it gives and ✓ / ⚠ with the reason. A click on a row
 * opens the detailed card for that file. One group for all, the
 * "add without asking when the guess is safe" preference, and
 * "Hepsini ekle (N)".
 */
import { Dialog } from "../primitives/Overlays";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { t } from "../../i18n";
import { backdropClass, popupClass, dialogWidthL } from "../dialogs/styles";
import { DialogHeader, DialogBody, DialogFooter, FormField, dialogLayoutClass } from "../dialogs/DialogFrame";
import { TextField } from "../primitives/TextField";
import { DialogToggle as Toggle } from "../dialogs/DialogFrame";
import { Button, IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { inputBad, inputClass, inputOk, NativeSelect } from "../primitives/NativeSelect";
import { Tooltip } from "../primitives/Tooltip";
import { addableRows, makeRow, readAutoAdd, rowVerdict, setRowSize, setRowSpec, writeAutoAdd, type BulkRow } from "./bulkModel";
import { draftFromSpec } from "./importModel";
import { useBulkCard, type BulkFile, type BulkRequest, type CardRequest } from "./importStore";
import { TilesetCard } from "./TilesetImportDialog";
import { selectAll } from "../primitives/selectAll";

const NEW_GROUP = "\u0000new";

export function BulkImportDialog() {
  const popupRef = useRef<HTMLDivElement>(null);
  const request = useBulkCard((s) => s.request);
  const close = useBulkCard((s) => s.close);
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && close(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          ref={popupRef}
          initialFocus={() => popupRef.current?.querySelector<HTMLElement>("[data-bulk-size]:not(:disabled), [data-bulk-group]:not(:disabled), footer button:not(:disabled)") ?? popupRef.current}
          data-testid="bulk-import-card"
          className={`${popupClass} ${dialogWidthL} ${dialogLayoutClass}`}
        >
          {request && <BulkCard request={request} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BulkCard({ request }: { request: BulkRequest }) {
  const close = useBulkCard((s) => s.close);
  const [rows, setRows] = useState<BulkRow[]>(() =>
    request.files.map((f, i) =>
      makeRow({ key: String(i), fileName: f.fileName, name: f.name, width: f.width, height: f.height, suggestions: f.suggestions, fallback: request.fallback }),
    ),
  );
  const [groupChoice, setGroupChoice] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [autoAdd, setAutoAdd] = useState(readAutoAdd);
  const [detail, setDetail] = useState<string | null>(null);
  // "new": the first row's tile size becomes the project's; rows are compared with it.
  const mapTile = request.mapTile ?? (rows[0]?.spec ? { tileWidth: rows[0].spec.tileWidth, tileHeight: rows[0].spec.tileHeight } : null);
  const addable = addableRows(rows, mapTile);
  const group = groupChoice === NEW_GROUP ? newGroup.trim() || null : groupChoice || null;
  const groupOk = groupChoice !== NEW_GROUP || newGroup.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (addable.length === 0 || !groupOk) return;
    close({ items: addable.map((r) => ({ file: Number(r.key), name: r.name.trim() || r.fileName, spec: r.spec! })), group });
  };
  const update = (key: string, fn: (row: BulkRow) => BulkRow) => setRows((list) => list.map((r) => (r.key === key ? fn(r) : r)));
  const detailRow = rows.find((r) => r.key === detail);
  const detailFile = detailRow ? request.files[Number(detailRow.key)] : undefined;

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title={request.mode.kind === "new" ? t("bulkImport.titleNew", { count: rows.length }) : t("bulkImport.title", { count: rows.length })} subtitle={t("bulkImport.description")} onClose={() => close(null)} />
      <DialogBody className="flex flex-col gap-3">
      <div role="list" aria-label={t("bulkImport.files")}>
        {rows.map((row) => (
          <BulkRowView
            key={row.key}
            row={row}
            file={request.files[Number(row.key)]!}
            mapTile={mapTile}
            onSize={(text) => update(row.key, (r) => setRowSize(r, text))}
            onOpen={() => setDetail(row.key)}
            onRemove={rows.length > 1 ? () => setRows((list) => list.filter((r) => r.key !== row.key)) : undefined}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t("bulkImport.group")}>
          <NativeSelect aria-label={t("bulkImport.group")} className="w-40" value={groupChoice} onChange={(e) => setGroupChoice(e.target.value)} data-bulk-group>
            <option value="">{t("tilesetLib.ungrouped")}</option>
            {request.groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value={NEW_GROUP}>{t("tilesetLib.newGroupOption")}</option>
          </NativeSelect>
        </FormField>
        {groupChoice === NEW_GROUP && (
          <TextField size="md"
            autoFocus
            value={newGroup}
            {...selectAll}
            onChange={(e) => setNewGroup(e.target.value)}
            aria-label={t("tilesetLib.groupName")}
            placeholder={t("tilesetLib.groupName")}
            maxLength={64}
            className={`w-40 ${groupOk ? "" : "[&>input]:border-danger"}`}
          />
        )}
        <label className="flex items-center gap-2 text-sm text-muted select-none">
          <Toggle checked={autoAdd} label={t("bulkImport.autoAdd")} data-bulk-autoadd onChange={next => { setAutoAdd(next); writeAutoAdd(next); }} />
          {t("bulkImport.autoAdd")}
        </label>
      </div>

      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => close(null)}>{t("common.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={addable.length === 0 || !groupOk} data-bulk-submit>
          {request.mode.kind === "new" ? t("bulkImport.create", { count: addable.length }) : t("bulkImport.addAll", { count: addable.length })}
        </Button>
      </DialogFooter>

      {detailRow && detailFile && (
        <DetailCard
          row={detailRow}
          file={detailFile}
          mapTile={request.mapTile}
          onClose={(result) => {
            setDetail(null);
            if (result) update(detailRow.key, (r) => setRowSpec(r, result.name, result.spec));
          }}
        />
      )}
    </form>
  );
}

function BulkRowView({
  row,
  file,
  mapTile,
  onSize,
  onOpen,
  onRemove,
}: {
  row: BulkRow;
  file: BulkFile;
  mapTile: { tileWidth: number; tileHeight: number } | null;
  onSize(text: string): void;
  onOpen(): void;
  onRemove: (() => void) | undefined;
}) {
  const verdict = rowVerdict(row, mapTile);
  const tone = verdict.kind === "ok" ? "text-success" : verdict.kind === "warn" ? "text-warning" : "text-danger";
  return (
    <div
      role="listitem"
      data-bulk-row={row.fileName}
      data-verdict={verdict.kind}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("input,button")) return;
        onOpen();
      }}
      className="group flex h-control-md cursor-pointer items-center gap-3 border-b border-line-subtle last:border-b-0 hover:bg-hover-popup"
    >
      <Thumb bitmap={file.bitmap} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2" title={`${row.fileName} · ${file.width}×${file.height}`}>
        <span className="truncate text-sm text-text">{row.name}</span>
        <span className="truncate text-xs text-muted">
          {file.width}×{file.height}
        </span>
      </div>
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
        <input
          value={row.sizeText}
          onChange={(e) => onSize(e.target.value)}
          aria-label={t("bulkImport.sizeLabel", { name: row.name })}
          inputMode="numeric"
          spellCheck={false}
          autoComplete="off"
          data-bulk-size
          {...selectAll}
          className={`${inputClass.replace("w-full ", "")} w-16 tabular ${row.spec ? inputOk : inputBad}`}
        />
        {t("newProject.pxUnit")}
      </label>
      <span className="w-14 shrink-0 text-right text-xs text-muted tabular" data-bulk-grid>
        {verdict.kind === "invalid" ? "—" : `${verdict.columns}×${verdict.rows}`}
      </span>
      <span className={`flex w-48 min-w-0 shrink-0 items-center gap-1.5 text-xs ${tone}`} title={verdict.reason}>
        <Icon name={verdict.kind === "ok" ? "check" : "warning"} size={16} className="shrink-0" />
        <span className="truncate">{verdict.reason}</span>
      </span>
      {onRemove ? (
        <Tooltip label={t("bulkImport.removeRow")}>
          <IconButton aria-label={t("bulkImport.removeRow")} size="sm" className="opacity-60 group-hover:opacity-100" onClick={onRemove} data-bulk-remove>
            <Icon name="x" size={16} />
          </IconButton>
        </Tooltip>
      ) : (
        <span className="size-6 shrink-0" />
      )}
    </div>
  );
}

function Thumb({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const size = Math.round(32 * (window.devicePixelRatio || 1));
    canvas.width = size;
    canvas.height = size;
    try {
      const scale = Math.min(size / bitmap.width, size / bitmap.height);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      ctx.imageSmoothingEnabled = scale < 1;
      ctx.drawImage(bitmap, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    } catch {
      // A closed bitmap draws nothing.
    }
  }, [bitmap]);
  return <canvas ref={ref} aria-hidden className="checker size-control-sm shrink-0 rounded-xs border border-line-subtle pixelated" />;
}

/** The detailed card for one row, nested in the bulk card. */
function DetailCard({
  row,
  file,
  mapTile,
  onClose,
}: {
  row: BulkRow;
  file: BulkFile;
  mapTile: { tileWidth: number; tileHeight: number } | null;
  onClose(result: { name: string; spec: NonNullable<BulkRow["spec"]> } | null): void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const request = useMemo(
    (): CardRequest => ({
      mode: { kind: "add" },
      fileName: file.fileName,
      bitmap: file.bitmap,
      width: file.width,
      height: file.height,
      alpha: file.alpha,
      initial: draftFromSpec(row.name, row.spec ?? { tileWidth: 32, tileHeight: 32, margin: 0, spacing: 0 }),
      suggestions: file.suggestions,
      mapTile,
    }),
    // The card keeps its own draft once open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file],
  );
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup ref={popupRef} initialFocus={() => popupRef.current?.querySelector<HTMLElement>("input:not(:disabled)") ?? popupRef.current} data-testid="tileset-card" className={`${popupClass} ${dialogWidthL} ${dialogLayoutClass} h-[min(640px,calc(100vh-32px))]`}>
          <TilesetCard
            request={request}
            confirmLabel={t("bulkImport.detailApply")}
            onClose={(result) => onClose(result?.kind === "confirm" ? { name: result.name, spec: result.spec } : null)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
