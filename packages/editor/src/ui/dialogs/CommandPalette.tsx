import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { fuzzyFilter, type FuzzyMatch } from "../../commands/fuzzy";
import { allCommands, isEnabled, paletteEntries, runCommand, type Command } from "../../commands/registry";
import type { CommandId } from "../../shortcuts/shortcuts";
import { t } from "../../i18n";
import { CommandKbd } from "../primitives/Kbd";
import { Icon } from "../primitives/Icon";
import { useUiStore } from "../uiStore";
import { backdropClass, popupTopClass } from "./styles";

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
          className={`${popupTopClass} w-[560px] max-w-[calc(100vw-32px)] overflow-hidden`}
        >
          <Dialog.Title className="sr-only">{t("palette.title")}</Dialog.Title>
          {open && <PaletteBody onClose={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteBody({ onClose }: { onClose(): void }) {
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
    [],
  );
  const results = useMemo(() => fuzzyFilter(commands, query, label), [commands, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
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
      <div className="flex h-12 items-center gap-3 border-b border-line px-4">
        <Icon name="search" size={16} className="shrink-0 text-faint" />
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
          className="h-full min-w-0 flex-1 bg-transparent text-lg text-text placeholder:text-faint focus-visible:outline-none"
        />
      </div>

      <div ref={listRef} id="command-list" role="listbox" className="max-h-[min(360px,50vh)] overflow-y-auto p-1.5">
        {results.length === 0 ? (
          <div className="px-3 py-8 text-center text-md text-faint">{t("palette.empty")}</div>
        ) : (
          results.map(({ item, match }, index) => (
            <div
              key={item.id}
              id={`command-${item.id}`}
              data-index={index}
              role="option"
              aria-selected={index === current}
              onPointerMove={() => index !== current && setActive(index)}
              onClick={() => run(item)}
              className={`flex h-9 cursor-default items-center gap-3 rounded-md px-3 text-md ${
                index === current ? "bg-active text-text" : "text-muted"
              }`}
            >
              <Highlighted text={item.label} match={match} split={item.split} />
              {item.command && <CommandKbd command={item.command} className="ml-auto" />}
            </div>
          ))
        )}
      </div>

      <div className="flex h-8 items-center border-t border-line px-4 text-xs text-faint">{t("palette.hint")}</div>
    </div>
  );
}

/** Category prefix in a quieter color; matched characters in the accent color. */
function Highlighted({ text, match, split }: { text: string; match: FuzzyMatch; split: number }) {
  const hits = new Set(match.indices);
  const chars = [...text];
  return (
    <span className="min-w-0 truncate">
      {chars.map((ch, i) => (
        <span
          key={i}
          className={hits.has(i) ? "font-medium text-accent" : i < split ? "text-faint" : undefined}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
