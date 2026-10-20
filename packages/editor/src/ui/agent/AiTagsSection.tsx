import { useEffect, useState } from "react";
import type { TagRecord } from "@smap/agent";
import { t } from "../../i18n";
import { useEditorStore } from "../../state/editorStore";
import type { InspectorContext } from "../inspector/registry";
import { Button } from "../primitives/Button";
import { SectionHeader } from "../primitives/SectionHeader";
import { useStampLibrary } from "../stamps/stampLibraryStore";
import { useAgentUi } from "./agentUiAdapter";
import { openAiTags, selectedAiTagTarget, tagTargetId } from "./tagsSelection";

export function AiTagsSection({ ctx }: { ctx: InspectorContext }) {
  const selection = useEditorStore(s => s.selection);
  const selectedStamp = useStampLibrary(s => s.selectedId);
  const source = useAgentUi(s => s.source);
  const revision = useAgentUi(s => s.tagsRevision);
  const [record, setRecord] = useState<TagRecord | null>(null);
  const target = selectedAiTagTarget();
  const id = target ? tagTargetId(target) : null;
  useEffect(() => {
    let alive = true;
    setRecord(null);
    const target = selectedAiTagTarget();
    if (target && source?.tags) void source.tags.read(target).then(record => { if (alive) setRecord(record); }).catch(() => {});
    return () => { alive = false; };
  }, [source, id, revision, selection, selectedStamp]);
  if (!target || (ctx.mode !== "brush" && ctx.mode !== "stamp")) return null;
  return <section data-inspector-section="ai-tags" className="shrink-0 border-t border-line-subtle">
    <SectionHeader padding={12} title={t("ai.tags.title")} />
    <div className="flex flex-col gap-2 px-3 pb-3 text-sm">
      <p className="text-muted">{record ? t(`ai.tags.${record.status}`) : t("ai.tags.unavailable")}</p>
      {!!record?.tags.length && <p className="truncate text-text" title={record.tags.join(", ")}>{record.tags.join(", ")}</p>}
      <Button size="sm" className="self-start" onClick={openAiTags}>{t("ai.action.editTags")}</Button>
    </div>
  </section>;
}
