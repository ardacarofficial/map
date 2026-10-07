import { chordLabels, isMac } from "../../commands/keymap";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";

/** Renders one key string ("Ctrl+K") as separate key caps. */
export function Kbd({ keys, className = "" }: { keys: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {chordLabels(keys, isMac()).map((label, i) => (
        <kbd
          key={i}
          className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-xs border border-line bg-panel px-1 font-sans text-2xs font-medium text-muted"
        >
          {label}
        </kbd>
      ))}
    </span>
  );
}

/** First shortcut of a command, or nothing if it has none. */
export function CommandKbd({ command, className }: { command: CommandId; className?: string }) {
  const keys = keysFor(command)[0];
  return keys ? <Kbd keys={keys} {...(className ? { className } : {})} /> : null;
}
