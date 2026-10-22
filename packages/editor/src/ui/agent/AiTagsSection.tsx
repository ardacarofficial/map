import { useEffect, useState } from "react";
import type { TagRecord } from "@smap/agent";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import type { InspectorContext } from "../inspector/registry";
import { Button } from "../primitives/Button";
import { SectionHeader } from "../primitives/SectionHeader";
import { useStampLibrary } from "../stamps/stampLibraryStore";
import { useAgentTags } from "../../agent/uiTags";
import { getAgentRuntime, createAgentSignal } from "../../agent/runtime";
import { shareSelectedReference } from "../../agent/editorContext";
import { toast } from "../toast/toastStore";
import { openAiTags, selectedAiTagTarget, tagTargetId } from "./tagsSelection";

export function AiTagsSection({ ctx }: { ctx: InspectorContext }) {
  const selection = useEditorStore(s => s.selection);
  const selectedStamp = useStampLibrary(s => s.selectedId);
  const { tags, revision } = useAgentTags();
  const [record, setRecord] = useState<TagRecord | null>(null);
  const [sharing, setSharing] = useState(false);
  const target = selectedAiTagTarget();
  const id = target ? tagTargetId(target) : null;
  useEffect(() => {
    let alive = true;
    setRecord(null);
    const target = selectedAiTagTarget();
    if (target && tags) void tags.read(target).then(record => { if (alive) setRecord(record); }).catch(() => {});
    return () => { alive = false; };
  }, [tags, id, revision, selection, selectedStamp]);
  if (!target || (ctx.mode !== "brush" && ctx.mode !== "stamp")) return null;
  return <section data-inspector-section="ai-tags" className="shrink-0 border-t border-line-subtle">
    <SectionHeader padding={12} title={t("ai.tags.title")} />
    <div className="flex flex-col gap-2 px-3 pb-3 text-sm">
      <p className="text-muted">{record ? t(`ai.tags.${record.status}`) : t("ai.tags.unavailable")}</p>
      {!!record?.tags.length && <p className="truncate text-text" title={record.tags.join(", ")}>{record.tags.join(", ")}</p>}
      <Button size="sm" className="self-start" onClick={openAiTags}>{t("ai.action.editTags")}</Button>
      {target.kind === "tile" && tags && <Button size="sm" className="self-start" disabled={sharing} onClick={() => {
        const host=getAgentRuntime()?.host;if(!host)return;
        setSharing(true);
        void shareSelectedReference(host.world,createAgentSignal(new AbortController()))
          .then(()=>toast.success(t("ai.action.shareReferenceReady")))
          .catch(()=>toast.warning(t("ai.action.shareReferenceFailed")))
          .finally(()=>setSharing(false));
      }}>{t("ai.action.shareReference")}</Button>}
    </div>
  </section>;
}
