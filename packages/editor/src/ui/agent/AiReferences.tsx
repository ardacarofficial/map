/** Reference pictures for the AI agent: drop, paste or pick; listed for the agent in get_session.references. */
import { useRef, useState, useSyncExternalStore, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { AgentError } from "@smap/agent";
import { t } from "../../i18n";
import { addUserReference, listReferences, removeReference, subscribeReferences } from "../../agent/referenceLibrary";
import { getAgentWorldSessionId } from "../../agent/editGate";
import { IconButton } from "../primitives/Button";
import { Icon } from "../primitives/Icon";
import { SectionHeader } from "../primitives/SectionHeader";
import { Tooltip } from "../primitives/Tooltip";
import { toast } from "../toast/toastStore";
import { useUiStore } from "../uiStore";

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const imageFiles = (list: Iterable<File> | ArrayLike<File> | null | undefined) => [...(list ? Array.from(list) : [])].filter(file => ACCEPT.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));

export async function addReferenceFiles(files: File[]): Promise<void> {
  if (!getAgentWorldSessionId()) { toast.warning(t("aiReference.error.noWorld")); return; }
  for (const file of files) {
    try {
      const added = await addUserReference(file, file.name.replace(/\.[^.]+$/, ""));
      toast.success(t("aiReference.added", { name: added.name }));
    } catch (error) {
      const cause = error instanceof AgentError ? String(error.details.cause ?? "") : "";
      toast.warning(t(cause === "unsupportedType" ? "aiReference.error.unsupportedType" : cause === "fileTooLarge" ? "aiReference.error.fileTooLarge" : cause === "tooManyReferences" || cause === "memory" ? "aiReference.error.tooMany" : "aiReference.error.failed"));
    }
  }
}

/** Drop/paste target for reference pictures; stops the window-wide tileset drop. */
export function useReferenceIntake() {
  const [over, setOver] = useState(false);
  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  return {
    over,
    handlers: {
      onDragEnter(event: DragEvent) { if (!files(event)) return; event.preventDefault(); event.stopPropagation(); useUiStore.getState().setDraggingFiles(false); setOver(true); },
      onDragOver(event: DragEvent) { if (!files(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; },
      onDragLeave(event: DragEvent) { if (!files(event)) return; event.stopPropagation(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); },
      onDrop(event: DragEvent) {
        if (!files(event)) return;
        event.preventDefault(); event.stopPropagation(); setOver(false);
        const images = imageFiles(event.dataTransfer.files);
        if (images.length) void addReferenceFiles(images); else toast.warning(t("aiReference.error.unsupportedType"));
      },
      onPaste(event: ClipboardEvent) {
        const images = imageFiles([...event.clipboardData.items].flatMap(item => item.kind === "file" ? [item.getAsFile()!] : []).filter(Boolean));
        if (!images.length) return;
        event.preventDefault(); event.stopPropagation();
        void addReferenceFiles(images);
      },
    },
  };
}

export function DropHighlight({ over, children }: { over: boolean; children?: ReactNode }) {
  if (!over) return null;
  return <div className="pointer-events-none absolute inset-0 z-(--overlay-chrome) flex items-center justify-center gap-2 rounded-sm border border-accent-line bg-accent-soft text-sm text-title">
    <Icon name="image-up" size={16} className="text-muted" />{children ?? t("aiReference.drop")}
  </div>;
}

export function AiReferences() {
  const references = useSyncExternalStore(subscribeReferences, listReferences);
  const input = useRef<HTMLInputElement>(null);
  return <section data-ai-references aria-label={t("aiReference.title")} className="border-b border-line-subtle">
    <SectionHeader title={t("aiReference.title")} actions={<Tooltip label={t("aiReference.add")}>
      <IconButton size="sm" aria-label={t("aiReference.add")} data-ai-reference-add onClick={() => input.current?.click()}><Icon name="image-up" size={16} /></IconButton>
    </Tooltip>} />
    <input ref={input} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={event => { const files = imageFiles(event.target.files); event.target.value = ""; if (files.length) void addReferenceFiles(files); }} />
    {!references.length ? <p className="px-2 pb-2 text-sm text-muted">{t("aiReference.empty")}</p> : <ul className="pb-1">
      {references.map(reference => <li key={reference.referenceId} data-ai-reference={reference.referenceId} className="group flex h-control-sm items-center gap-2 px-2 text-sm hover:bg-hover">
        <Icon name="image" size={16} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate text-text" title={reference.name}>{reference.name}</span>
        <span className="shrink-0 font-mono text-xs text-faint">{t("aiReference.size", { width: reference.width, height: reference.height })}</span>
        <span className="shrink-0 text-xs text-faint">{t(reference.origin === "user" ? "aiReference.origin.user" : "aiReference.origin.agent")}</span>
        <Tooltip label={t("aiReference.remove")}>
          <IconButton size="sm" aria-label={t("aiReference.remove")} onClick={() => removeReference(reference.referenceId)}><Icon name="x" size={16} /></IconButton>
        </Tooltip>
      </li>)}
    </ul>}
  </section>;
}
