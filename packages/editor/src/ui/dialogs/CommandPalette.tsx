import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { fuzzyFilter, type FuzzyMatch } from "../../commands/fuzzy";
import { allCommands, isEnabled, paletteEntries, paletteEntriesVersion, subscribePaletteEntries, runCommand, type Command } from "../../commands/registry";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { getLocale, t } from "../../i18n";
import { KbdText } from "../primitives/Kbd";
import { Icon } from "../primitives/Icon";
import { useUiStore } from "../uiStore";
import { readPaletteRecents, rememberPaletteCommand } from "./paletteRecents";
import { backdropClass, popupTopClass, dialogWidthM } from "./styles";

/** One row: a registered command or a dynamic entry (e.g. "Level'a git: Zindan"). */
interface PaletteItem {
  id: string;
  label: string;
  /** Length of the quieter prefix ("Görünüm: "). */
  split: number;
  command?: CommandId;
  run(): void;
}

function commandItem(command: Command): PaletteItem {
  const prefix = t(`categories.${command.category}`);
  return {
    id: command.id,
    label: `${prefix}: ${t(command.title)}`,
    split: prefix.length + 2,
    command: command.id,
    run: () => runCommand(command.id),
  };
}

const label = (item: PaletteItem) => item.label;

/** Ctrl+K / Ctrl+Shift+P — fuzzy search over every enabled command. */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropClass} />
        <Dialog.Popup
          className={`${popupTopClass} ${dialogWidthM} max-w-[calc(100vw-32px)] max-h-[calc(88vh-16px)] overflow-hidden`}
        >
          <Dialog.Title className="sr-only">{t("palette.title")}</Dialog.Title>
          {open && <PaletteBody onClose={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose(): void }) {
  const locale = getLocale();
  const providersRevision = useSyncExternalStore(subscribePaletteEntries, paletteEntriesVersion);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Snapshot of the commands available right now (enabled state is read once per open).
  const commands = useMemo<PaletteItem[]>(
    () => [
      ...allCommands()
        .filter((c) => c.inPalette !== false && isEnabled(c))
        .map(commandItem),
      ...paletteEntries().map((e) => ({ id: e.key, label: `${e.prefix}: ${e.title}`, split: e.prefix.length + 2, run: e.run })),
    ],
    // commandItem/paletteEntries translate through t(), which reads the external locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, providersRevision],
  );
  const [recents] = useState(readPaletteRecents);
  const results = useMemo(() => {
    const filtered = fuzzyFilter(commands, query, label);
    if (query.trim()) return filtered;
    const recent = recents.flatMap(id => filtered.filter(result => result.item.id === id));
    const remaining = filtered.filter(result => !recents.includes(result.item.id));
    const collator = new Intl.Collator(getLocale());
    remaining.sort((a, b) => {
      const x = a.item;
      const y = b.item;
      return collator.compare(x.label.slice(0, x.split - 2), y.label.slice(0, y.split - 2))
        || collator.compare(x.label.slice(x.split), y.label.slice(y.split))
        || x.id.localeCompare(y.id);
    });
    return [...recent, ...remaining];
  }, [commands, query, recents]);
  const recentCount = query.trim() ? 0 : results.filter(result => recents.includes(result.item.id)).length;
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    rememberPaletteCommand(item.id);
    onClose();
    // Run synchronously so pickers keep the user's key/click activation.
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = results.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (count) setActive((current + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (count) setActive((current - 1 + count) % count);
    } else if (event.key === "PageDown" || event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, count - 1));
    } else if (event.key === "PageUp" || event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(results[current]?.item);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center gap-3 border-b border-line-subtle px-4">
        <Icon name="search" size={16} className="shrink-0 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("palette.placeholder")}
          aria-label={t("palette.placeholder")}
          aria-controls="command-list"
          aria-activedescendant={results[current] ? `command-${results[current].item.id}` : undefined}
          role="combobox"
          aria-expanded="true"
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent text-md text-text placeholder:text-muted focus-visible:outline-none"
        />
      </div>

      <div ref={listRef} id="command-list" role="listbox" className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <div className="px-3 py-4 text-sm text-muted">{t("palette.empty")}</div>
        ) : (
          results.map(({ item, match }, index) => (
            <div key={item.id}>
              {!query.trim() && (index === 0 || index === recentCount) && <div className="flex h-row items-center px-3 text-xs font-semibold tracking-section text-muted uppercase">
                {index === 0 && recentCount > 0 ? t("palette.recent") : t("palette.all")}
              </div>}
              <div id={`command-${item.id}`} data-index={index} role="option" aria-selected={index === current}
                onPointerMove={() => index !== current && setActive(index)} onClick={() => run(item)}
                className={`flex h-control-rail cursor-default items-center gap-3 rounded-sm px-3 text-sm text-text ${index === current ? "bg-hover-popup" : ""}`}>
                <Highlighted text={item.label} match={match} split={item.split} />
                {item.command && keysFor(item.command)[0] && <KbdText keys={keysFor(item.command)[0]!} className="ml-auto shrink-0 !text-muted" />}
              </div>
            </div>
          ))
        )}
      </div>

    </div>
  );
}

/** Retain fuzzy match indices while displaying the category after the command. */
function Highlighted({ text, match, split }: { text: string; match: FuzzyMatch; split: number }) {
  const hits = new Set(match.indices);
  const chars = [...text];
  return <span className="flex min-w-0 items-baseline gap-2">
    <span className="truncate">{chars.slice(split).map((ch, i) => <span key={i} className={hits.has(i + split) ? "font-medium text-title" : undefined}>{ch}</span>)}</span>
    <span className="shrink-0 text-xs text-muted">{text.slice(0, split - 2)}</span>
  </span>;
}
