import type { TagTarget } from "@smap/agent";
import { create } from "zustand";
import { useEditorStore } from "../../state/editorStore";
import { useProjectLibrary } from "../../io/projectLibrary";
import { useStampLibrary } from "../stamps/stampLibraryStore";

export const useAiTagsDialog = create(() => ({ target: null as TagTarget | null }));
export function selectedAiTagTarget(): TagTarget | null {
  const id = useStampLibrary.getState().selectedId;
  if (id && useProjectLibrary.getState().stamps.some(stamp => stamp.id === id)) return { kind: "stamp", stampId: id };
  const tile = useEditorStore.getState().selection;
  return tile ? { kind: "tile", ...tile } : null;
}
export function openAiTags(): void { useAiTagsDialog.setState({ target: selectedAiTagTarget() }); }
export function tagTargetId(target: TagTarget): string { return target.kind === "stamp" ? target.stampId : `${target.tilesetId}:${target.tileId}`; }
