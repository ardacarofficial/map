import { useEffect, useRef, useState } from "react";
import type { TagRecord, TagTarget } from "@smap/agent";
import { t } from "../../i18n";
import { Button } from "../primitives/Button";
import { Segmented } from "../primitives/Segmented";
import type { AiTagsAccess } from "../../agent/uiTags";
import { tagTargetId, useAiTagsDialog } from "./tagsSelection";

type Filter = "all" | "missing" | "stale";
/** Browses metadata only; selecting a row never paints or writes tags. */
export function AiTagBrowser({ tags, target }: { tags: AiTagsAccess; target: TagTarget }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("missing");
  const [items, setItems] = useState<readonly TagRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const currentPage = useRef<{ active: boolean } | null>(null);
  const kind = target.kind === "tile" ? "tiles" : "stamps";
  useEffect(() => {
    const pageGuard = { active: true };
    currentPage.current = pageGuard;
    if (open) {
      setBusy(true); setFailed(false); setItems([]); setCursor(null);
      void tags.list({ kind, status: filter }).then(page => {
        if (pageGuard.active) { setItems(page.items); setCursor(page.nextCursor); }
      }).catch(() => { if (pageGuard.active) setFailed(true); }).finally(() => { if (pageGuard.active) setBusy(false); });
    }
    return () => { pageGuard.active = false; };
  }, [tags, kind, filter, open]);
  return <div className="flex flex-col gap-2">
    <Button size="sm" variant="ghost" className="self-start" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t("ai.tags.browse")}</Button>
    {open && <>
      <Segmented<Filter> disabled={busy} value={filter} onValueChange={setFilter} label={t("ai.tags.browse")} items={[{ value: "all", label: t("ai.tags.filterAll") }, { value: "missing", label: t("ai.tags.filterMissing") }, { value: "stale", label: t("ai.tags.filterStale") }]} />
      <ul className="max-h-40 overflow-y-auto text-sm" aria-busy={busy}>{items.map(item => <li key={tagTargetId(item.target)}><Button size="sm" variant="ghost" className="max-w-full" onClick={() => useAiTagsDialog.setState({ target: item.target })}><span className="truncate font-mono">{tagTargetId(item.target)}</span><span className="text-muted">{t(`ai.tags.${item.status}`)}</span></Button></li>)}</ul>
      {cursor && items.length < 500 && <Button size="sm" disabled={busy} className="self-start" onClick={() => {
        const pageGuard = currentPage.current;
        setBusy(true); setFailed(false);
        void tags.list({ kind, status: filter, cursor }).then(page => {
          if (pageGuard?.active) { setItems(current => [...current, ...page.items].slice(0, 500)); setCursor(page.nextCursor); }
        }).catch(() => { if (pageGuard?.active) setFailed(true); }).finally(() => { if (pageGuard?.active) setBusy(false); });
      }}>{t("ai.tags.more")}</Button>}
      {failed && <p role="alert" className="text-sm text-danger">{t("ai.tags.unavailable")}</p>}
    </>}
  </div>;
}
