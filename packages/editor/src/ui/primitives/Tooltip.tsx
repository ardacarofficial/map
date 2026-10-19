/** Tooltip around a ref-capable child; label, command/keys, side, offset and disabled. */
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { useId, useState, type ComponentPropsWithRef, type ReactElement, type ReactNode } from "react";

import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { Kbd } from "./Kbd";

/** Shared 500ms warm-up, immediate close, and 400ms instant-follow window. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={500} closeDelay={0} timeout={400}>{children}</BaseTooltip.Provider>;
}

export type TooltipProps = Omit<ComponentPropsWithRef<typeof BaseTooltip.Trigger>, "children" | "render" | "disabled"> & {
  label: string;
  command?: CommandId;
  keys?: string;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  disabled?: boolean;
  children: ReactElement;
};
export function Tooltip({ label, command, keys: keysOverride, side = "bottom", sideOffset = 6, disabled = false, children, ...rest }: TooltipProps) {
  const tooltipId = useId();
  const [open,setOpen]=useState(false);
  const describedBy = [rest["aria-describedby"], (children.props as { "aria-describedby"?: string })["aria-describedby"], disabled ? undefined : tooltipId].filter(Boolean).join(" ") || undefined;
  const keys = keysOverride ?? (command ? keysFor(command)[0] : undefined);
  return (
    <BaseTooltip.Root disabled={disabled} open={open} onOpenChange={setOpen}>
      <BaseTooltip.Trigger {...rest} onClick={event=>{setOpen(false);rest.onClick?.(event);}} aria-describedby={describedBy} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="z-50">
          <BaseTooltip.Popup id={tooltipId} role="tooltip" className="flex items-center gap-2 rounded-sm border border-line-strong bg-popup px-2 py-1 text-sm text-text shadow-popup transition-[opacity,translate] duration-(--duration-ui) ease-out data-ending-style:translate-y-0.5 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:translate-y-0.5 data-starting-style:opacity-0">
            {label}
            {keys && <Kbd keys={keys} />}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
