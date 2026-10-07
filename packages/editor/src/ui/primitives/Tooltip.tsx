import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { Kbd } from "./Kbd";

/** Wrap the app once so tooltips share a warm-up delay (hover one, the next opens instantly). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <BaseTooltip.Provider delay={450} closeDelay={0}>
      {children}
    </BaseTooltip.Provider>
  );
}

/**
 * Tooltip with an optional shortcut hint. `children` must be a single element
 * that accepts a ref and props (it becomes the trigger via `render`).
 */
export function Tooltip({
  label,
  command,
  side = "bottom",
  children,
}: {
  label: string;
  /** Shows this command's shortcut next to the label. */
  command?: CommandId;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  const keys = command ? keysFor(command)[0] : undefined;
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={8} className="z-50">
          <BaseTooltip.Popup className="flex origin-(--transform-origin) items-center gap-2 rounded-md border border-line bg-raised px-2 py-1 text-sm text-text shadow-popup transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-95 data-starting-style:opacity-0">
            {label}
            {keys && <Kbd keys={keys} />}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
