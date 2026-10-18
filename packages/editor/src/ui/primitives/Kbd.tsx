/** Kbd renders boxed shortcut keys; KbdText renders an unboxed menu shortcut. */
import type { HTMLAttributes } from "react";

import { chordLabels, isMac } from "../../commands/keymap";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";

type KbdProps = HTMLAttributes<HTMLSpanElement> & { keys: string };
export function Kbd({ keys, className = "", ...rest }: KbdProps) {
  return (
    <span {...rest} className={`inline-flex items-center gap-0.5 ${className}`}>
      {chordLabels(keys, isMac()).map((label, i) => (
        <kbd key={i} className="inline-grid h-4 min-w-4 place-items-center rounded-xs border border-line-strong px-1 font-mono text-xs font-normal text-muted">
          {label}
        </kbd>
      ))}
    </span>
  );
}

export function KbdText({ keys, className = "", ...rest }: KbdProps) {
  return <span {...rest} className={`font-mono text-xs text-muted ${className}`}>{chordLabels(keys, isMac()).join(" ")}</span>;
}

/** First shortcut of a command, or nothing if it has none. */
export function CommandKbd({ command, className }: { command: CommandId; className?: string }) {
  const keys = keysFor(command)[0];
  return keys ? <Kbd keys={keys} {...(className ? { className } : {})} /> : null;
}
