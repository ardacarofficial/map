import { useEffect, useState } from "react";
import type { TagRecord, TagTarget } from "@smap/agent";
import { t } from "../../i18n";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useEditorStore } from "../../state/editorStore";
import { Dialog } from "../primitives/Overlays";
import { Button } from "../primitives/Button";
import { TextField } from "../primitives/TextField";
import { TileSwatch } from "../primitives/TileSwatch";
import { StampThumb } from "../stamps/StampThumb";
import { DialogBody, DialogFooter, DialogHeader, FormField, dialogLayoutClass } from "../dialogs/DialogFrame";
import { backdropClass, dialogWidthM, popupClass } from "../dialogs/styles";
import { useAgentUi } from "./agentUiAdapter";
import { useAiTagsDialog, tagTargetId } from "./tagsSelection";
import { AiTagBrowser } from "./AiTagBrowser";
import { parseAiTagWords } from "./tagWords";

export function AiTagsEditor() {
  const target = useAiTagsDialog(s => s.target);
  const close = () => useAiTagsDialog.setState({ target: null });
  return <Dialog.Root open={target !== null} onOpenChange={open => { if (!open) close(); }}><Dialog.Portal>
    <Dialog.Backdrop className={backdropClass} />
    <Dialog.Popup className={`${popupClass} ${dialogWidthM} ${dialogLayoutClass}`} data-dialog="ai-tags">
      {target && <TagsForm key={tagTargetId(target)} target={target} close={close} />}
    </Dialog.Popup>
  </Dialog.Portal></Dialog.Root>;
}
function TagsForm({ target, close }: { target: TagTarget; close(): void }) {
  const { source, state } = useAgentUi();
  const [record, setRecord] = useState<TagRecord | null>(null);
  const [words, setWords] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = state.phase !== "ready" && state.phase !== "disabled";
  useEffect(() => {
    let alive = true;
    if (source?.tags) void source.tags.read(target).then(record => {
      if (alive) { setRecord(record); setWords(record.tags.join(", ")); setNote(record.note); setError(null); }
    }).catch(() => { if (alive) setError(t("ai.tags.unavailable")); });
    return () => { alive = false; };
  }, [source, target]);
  const tags = parseAiTagWords(words);
  const submit = async () => {
    if (!source?.tags || !record?.currentFingerprint || tags === null || locked || busy) return;
    setBusy(true); setError(null);
    try { await source.tags.write({ target, expectedFingerprint: record.currentFingerprint, tags, note }); close(); }
    catch (error) { setError(t(typeof error === "object" && error !== null && "code" in error && error.code === "TAG_FINGERPRINT_CHANGED" ? "ai.tags.sourceChanged" : "ai.tags.saveFailed")); }
    finally { setBusy(false); }
  };
  return <form onSubmit={event => { event.preventDefault(); void submit(); }} className="flex min-h-0 flex-col">
    <DialogHeader title={t("ai.tags.title")} onClose={close} />
    <DialogBody className="flex flex-col gap-3 pt-2">
      <TargetPreview target={target} />
      <FormField label={t("ai.tags.target")}><p className="break-all font-mono text-sm text-text">{tagTargetId(target)}</p></FormField>
      <p role="status" className="text-sm text-muted">{record ? t(`ai.tags.${record.status}`) : t("ai.tags.unavailable")}</p>
      {locked && <p className="text-sm text-muted">{t("ai.blocked.editing")}</p>}
      <FormField label={t("ai.tags.tags")} htmlFor="ai-tag-words" error={tags === null ? t("ai.tags.invalid") : undefined}>
        <TextField id="ai-tag-words" value={words} onChange={event => setWords(event.target.value)} disabled={locked || busy || !record} aria-invalid={tags === null} aria-describedby="ai-tag-help" />
        <p id="ai-tag-help" className="text-sm text-muted">{t("ai.tags.help")}</p>
      </FormField>
      <FormField label={t("ai.tags.note")} htmlFor="ai-tag-note"><TextField id="ai-tag-note" value={note} maxLength={256} onChange={event => setNote(event.target.value)} disabled={locked || busy || !record} /></FormField>
      {source?.tags && <AiTagBrowser tags={source.tags} target={target} />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </DialogBody>
    <DialogFooter><Button onClick={close}>{t("common.cancel")}</Button><Button variant="primary" type="submit" disabled={locked || busy || !record?.currentFingerprint || tags === null}>{t("common.save")}</Button></DialogFooter>
  </form>;
}
function TargetPreview({ target }: { target: TagTarget }) {
  const store = useEditorStore(s => s.project?.store);
  const stamp = useProjectLibrary(s => target.kind === "stamp" ? s.stamps.find(stamp => stamp.id === target.stampId) : undefined);
  if (stamp) return <StampThumb stamp={stamp} height={80} pad={0} />;
  const tileset = target.kind === "tile" ? store?.document.getTileset(target.tilesetId) : null;
  return tileset && target.kind === "tile" ? <TileSwatch tileset={tileset} tileId={target.tileId} size={Math.max(tileset.tileWidth, tileset.tileHeight)} /> : null;
}
